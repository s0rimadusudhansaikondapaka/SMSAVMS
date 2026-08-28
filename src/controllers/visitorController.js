const QRCode = require('qrcode');
const db = require('../config/db');
const { broadcastSyncEvent } = require('../sockets/syncServer');

// Helper to check L2 approval toggle status
async function isL2Enabled() {
  const res = await db.query("SELECT value FROM system_settings WHERE key = 'L2_APPROVAL_ENABLED'");
  return res.rows.length > 0 ? res.rows[0].value === 'true' : true;
}

// 1. Create Pre-Registration or Spot Registration
async function createRegistration(req, res) {
  const {
    full_name,
    phone,
    email,
    gender, // Male, Female, Other
    photo_url,
    id_type,
    id_number,
    id_card_number,
    id_card_image_url,
    visitor_category,
    host_id,
    purpose,
    visit_type, // HOME, OFFICE, TOUR, BHAJAN, EVENT
    stay_required,
    priority, // P1, P2, P3
    is_vvip,
    valid_from,
    valid_until,
    adult_men_count,
    adult_women_count,
    children_count,
    vehicles, // Array of { plate_number, vehicle_type, driver_name, driver_phone }
    is_spot_registration,
  } = req.body;

  try {
    await db.query('BEGIN');

    // 1. Insert or update visitor
    let visitorId;
    const existingVisitor = await db.query('SELECT id FROM visitors WHERE phone = $1', [phone]);
    const idCardNo = id_card_number || id_number || '';
    const visitorGender = gender || 'Male';

    if (existingVisitor.rows.length > 0) {
      visitorId = existingVisitor.rows[0].id;
      await db.query(
        `UPDATE visitors 
         SET full_name = $1, email = $2, gender = $3, photo_url = $4, id_type = $5, id_number = $6, id_card_number = $7, id_card_image_url = $8, visitor_category = $9
         WHERE id = $10`,
        [full_name, email || '', visitorGender, photo_url || '', id_type || 'Aadhaar', idCardNo, idCardNo, id_card_image_url || '', visitor_category || 'GENERAL', visitorId]
      );
    } else {
      const newVisitor = await db.query(
        `INSERT INTO visitors (full_name, phone, email, gender, photo_url, id_type, id_number, id_card_number, id_card_image_url, visitor_category) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [full_name, phone, email || '', visitorGender, photo_url || '', id_type || 'Aadhaar', idCardNo, idCardNo, id_card_image_url || '', visitor_category || 'GENERAL']
      );
      visitorId = newVisitor.rows[0].id;
    }

    const validFromTime = valid_from ? new Date(valid_from) : new Date();
    let validUntilTime;
    if (valid_until) {
      validUntilTime = new Date(valid_until);
    } else {
      validUntilTime = new Date(validFromTime);
      validUntilTime.setDate(validUntilTime.getDate() + 1);
      validUntilTime.setHours(21, 0, 0, 0); // Default to Tomorrow 9:00 PM
    }

    // Determine initial status based on approval matrix & L2 setting
    const l2Enabled = await isL2Enabled();
    // Enhanced approval routing with time-based L2 and approvers_config
    let initialStatus = 'PENDING_L1';
    const arrivalHour = validFromTime.getHours();
    const isNightArrival = arrivalHour >= 18 || arrivalHour < 6;
    const arrivalDate = validFromTime.toISOString().slice(0, 10);
    const departureDate = validUntilTime.toISOString().slice(0, 10);
    const isMultiDay = arrivalDate !== departureDate;

    if (is_spot_registration) {
      if (visit_type === 'TOUR') {
        initialStatus = 'PENDING_L1';
      } else if (visit_type === 'BHAJAN' || visit_type === 'EVENT') {
        initialStatus = 'PENDING_L1';
      }
    }

    if (host_id) {
      const hostRes = await db.query('SELECT role FROM users WHERE id = $1', [host_id]);
      if (hostRes.rows.length > 0) {
        const hostRole = hostRes.rows[0].role;
        
        // HOD auto-approves office visits
        if (hostRole === 'HOD' && visit_type === 'OFFICE') {
          initialStatus = 'APPROVED';
        }

        // Check approvers_config for time-based L2 routing
        const configRes = await db.query(
          `SELECT * FROM approvers_config WHERE host_type = $1 AND approval_required = true`,
          [hostRole === 'HOD' ? 'EMPLOYEE' : hostRole]
        );
        if (configRes.rows.length > 0) {
          const config = configRes.rows[0];
          if (config.l2_to_security_head && (isNightArrival || isMultiDay)) {
            if (initialStatus !== 'APPROVED') {
              initialStatus = 'PENDING_L2';
            }
          }
        }
      }
    }

    // Generate unique Pass Code
    const passCodePrefix = is_vvip ? 'VVIP' : 'PASS';
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const passCode = `${passCodePrefix}-${randomNum}`;

    const menCount = parseInt(adult_men_count) || 1;
    const womenCount = parseInt(adult_women_count) || 0;
    const boysCount = parseInt(req.body.boys_count) || 0;
    const girlsCount = parseInt(req.body.girls_count) || 0;
    const kidsCount = children_count !== undefined ? parseInt(children_count) : (boysCount + girlsCount);
    const totalCount = menCount + womenCount + boysCount + girlsCount;

    // Insert Registration
    const regRes = await db.query(
      `INSERT INTO registrations 
       (visitor_id, host_id, purpose, visit_type, stay_required, accommodation_approved, priority, status, pass_code, valid_from, valid_until, adult_men_count, adult_women_count, children_count, boys_count, girls_count, person_count, is_vvip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        visitorId,
        host_id || req.user?.id || null,
        purpose || 'General Visit',
        visit_type || 'OFFICE',
        stay_required || false,
        false,
        priority || (is_vvip ? 'P1' : 'P3'),
        initialStatus,
        passCode,
        validFromTime,
        validUntilTime,
        menCount,
        womenCount,
        kidsCount,
        boysCount,
        girlsCount,
        totalCount,
        is_vvip || false,
      ]
    );

    const registration = regRes.rows[0];

    // Set host notification timestamp for timeout tracking
    if (registration.host_id && initialStatus === 'PENDING_L1') {
      await db.query('UPDATE registrations SET host_notified_at = CURRENT_TIMESTAMP WHERE id = $1', [registration.id]);
    }

    // Insert Multiple Registered Vehicles if provided
    if (Array.isArray(vehicles) && vehicles.length > 0) {
      for (const veh of vehicles) {
        if (veh.plate_number) {
          await db.query(
            `INSERT INTO registration_vehicles (registration_id, plate_number, vehicle_type, driver_name, driver_phone)
             VALUES ($1, $2, $3, $4, $5)`,
            [registration.id, veh.plate_number, veh.vehicle_type || 'Car', veh.driver_name || '', veh.driver_phone || '']
          );
        }
      }
    }

    // Auto-approve QR Code if approved
    if (initialStatus === 'APPROVED') {
      const qrData = JSON.stringify({ passCode, regId: registration.id, isVvip: is_vvip });
      const qrCodeUrl = await QRCode.toDataURL(qrData);
      await db.query(
        'UPDATE registrations SET qr_code_url = $1, approved_by_user_id = $2, approved_by_name = $3, approved_by_role = $4 WHERE id = $5',
        [qrCodeUrl, req.user?.id || null, req.user?.name || 'Referral Host', req.user?.role || 'RESIDENT', registration.id]
      );
      registration.qr_code_url = qrCodeUrl;
      registration.approved_by_name = req.user?.name || 'Referral Host';
      registration.approved_by_role = req.user?.role || 'RESIDENT';
    }

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user?.id || null, 'CREATE_REGISTRATION', 'REGISTRATION', registration.id, `Created pass ${passCode} (Total People: ${totalCount})`]
    );

    await db.query('COMMIT');

    if (is_vvip) {
      broadcastSyncEvent('VVIP_ALERT', {
        message: `High Priority VVIP Registration Created: ${full_name}`,
        registration,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Registration created successfully.',
      registration,
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error creating registration:', err);
    res.status(500).json({ success: false, message: 'Failed to create registration.' });
  }
}

// 2. Host or Approver Process Approval / Rejection
async function updateApproval(req, res) {
  const { registration_id, action, remarks, priority, visit_type, visitor_category, valid_from, valid_until } = req.body;
  if (!registration_id || !action) {
    return res.status(400).json({ success: false, message: 'Registration ID and action required.' });
  }

  try {
    const regRes = await db.query(
      `SELECT r.*, v.full_name as visitor_name, v.phone as visitor_phone 
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       WHERE r.id = $1`,
      [registration_id]
    );

    if (regRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    const reg = regRes.rows[0];
    let newStatus = reg.status;
    const l2Enabled = await isL2Enabled();

    if (action === 'REJECT') {
      newStatus = 'REJECTED';
    } else if (action === 'APPROVE') {
      if (reg.bypassed_by_admin || req.user.role === 'ADMIN') {
        // Super Admin bypass: Directly APPROVED
        newStatus = 'APPROVED';
      } else if (reg.stay_required && !reg.accommodation_approved && req.user.role !== 'ACCOMMODATION_HOD') {
        // Stay Required: Routed to Accommodation Team (department)
        newStatus = 'PENDING_ACCOMMODATION';
      } else if (l2Enabled) {
        const vType = (visit_type || reg.visit_type || 'HOME').toUpperCase();
        
        let isHostResident = false;
        let isHostEmployee = false;
        let hostDeptId = null;
        if (reg.host_id) {
          const hostRes = await db.query('SELECT role, residency_status, department_id FROM users WHERE id = $1', [reg.host_id]);
          if (hostRes.rows.length > 0) {
            const h = hostRes.rows[0];
            isHostResident = h.role === 'RESIDENT' || h.residency_status === 'RESIDENT';
            isHostEmployee = h.role === 'EMPLOYEE' || h.role === 'HOD';
            hostDeptId = h.department_id;
          }
        }

        // Determine host category key: 'BOTH', 'EMPLOYEE', or 'RESIDENT'
        const hostCategoryKey = (isHostResident && isHostEmployee) ? 'BOTH' : isHostEmployee ? 'EMPLOYEE' : 'RESIDENT';
        
        // Determine visit type category key: 'EMPLOYEE_OFFICIAL_VISIT', 'RESIDENT_VISIT', or 'ASHRAM_VISIT'
        let visitTypeCategoryKey = 'RESIDENT_VISIT';
        if (vType === 'OFFICE' || vType === 'OFFICIAL') {
          visitTypeCategoryKey = 'EMPLOYEE_OFFICIAL_VISIT';
        } else if (vType === 'ASHRAM' || vType === 'BHAJAN' || vType === 'TOUR') {
          visitTypeCategoryKey = 'ASHRAM_VISIT';
        }

        // Query active L2 Matrix rule configured by Super Admin
        const ruleRes = await db.query(
          `SELECT approver_type FROM l2_approval_matrix_rules WHERE host_category = $1 AND visit_type_category = $2 AND is_enabled = true`,
          [hostCategoryKey, visitTypeCategoryKey]
        );

        let approverType = 'DEPARTMENT_PRO';
        if (ruleRes.rows.length > 0) {
          approverType = ruleRes.rows[0].approver_type;
        } else {
          // Fallback default matrix
          approverType = (visitTypeCategoryKey === 'EMPLOYEE_OFFICIAL_VISIT') ? 'SAME_DEPARTMENT_HOD' : 'DEPARTMENT_PRO';
        }

        // Evaluate whether current approver satisfies rule
        if (approverType === 'SAME_DEPARTMENT_HOD') {
          // Requires HOD role of host's same department
          if (req.user.role === 'HOD' && (hostDeptId ? req.user.department_id === hostDeptId : true)) {
            newStatus = 'APPROVED';
          } else {
            newStatus = 'PENDING_L2';
          }
        } else if (approverType === 'DEPARTMENT_PRO') {
          // Requires PRO department
          if (req.user.role === 'PRO' || req.user.department_name === 'PRO') {
            newStatus = 'APPROVED';
          } else {
            newStatus = 'PENDING_L2';
          }
        } else {
          newStatus = 'APPROVED';
        }
      } else {
        newStatus = 'APPROVED';
      }
    }

    let qrCodeUrl = reg.qr_code_url;
    if (newStatus === 'APPROVED' && !qrCodeUrl) {
      const qrData = JSON.stringify({ passCode: reg.pass_code, regId: reg.id, isVvip: reg.is_vvip });
      qrCodeUrl = await QRCode.toDataURL(qrData);
    }

    await db.query(
      `UPDATE registrations 
       SET status = $1, 
           qr_code_url = $2, 
           accommodation_approved = CASE WHEN $3 = true THEN true ELSE accommodation_approved END,
           priority = COALESCE($4, priority),
           visit_type = COALESCE($5, visit_type),
           valid_from = COALESCE($6, valid_from),
           valid_until = COALESCE($7, valid_until),
           approved_by_user_id = CASE WHEN $1 = 'APPROVED' OR $1 LIKE 'PENDING%' THEN $9 ELSE approved_by_user_id END,
           approved_by_name = CASE WHEN $1 = 'APPROVED' OR $1 LIKE 'PENDING%' THEN $10 ELSE approved_by_name END,
           approved_by_role = CASE WHEN $1 = 'APPROVED' OR $1 LIKE 'PENDING%' THEN $11 ELSE approved_by_role END
       WHERE id = $8`,
      [
        newStatus, 
        qrCodeUrl, 
        reg.stay_required && req.user.role === 'HOD', 
        priority || null,
        visit_type || null,
        valid_from ? new Date(valid_from) : null,
        valid_until ? new Date(valid_until) : null,
        registration_id,
        req.user.id,
        req.user.name,
        req.user.role
      ]
    );

    if (visitor_category) {
      await db.query(`UPDATE visitors SET visitor_category = $1 WHERE id = $2`, [visitor_category, reg.visitor_id]);
    }

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, `APPROVAL_${action}`, 'REGISTRATION', registration_id, remarks || `Action ${action} by ${req.user.name}`]
    );

    broadcastSyncEvent('REGISTRATION_UPDATED', {
      registrationId: registration_id,
      status: newStatus,
      host_id: reg.host_id,
      visitor_name: reg.visitor_name,
      pass_code: reg.pass_code,
      action: action,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: `Registration status updated to ${newStatus}`,
      status: newStatus,
      qr_code_url: qrCodeUrl,
    });
  } catch (err) {
    console.error('Error updating approval:', err);
    res.status(500).json({ success: false, message: 'Failed to update approval.' });
  }
}

// 3. Get Host Pending & Approved Registrations (Includes Vehicles & Accompanying breakdown)
async function getHostRegistrations(req, res) {
  try {
    const result = await db.query(
      `SELECT r.*, 
              v.full_name as visitor_name, v.phone as visitor_phone, v.email as visitor_email, v.gender as visitor_gender,
              v.photo_url, v.id_card_number, v.id_card_image_url, v.visitor_category,
              u.name as host_name
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       LEFT JOIN users u ON r.host_id = u.id
       WHERE r.host_id = $1 OR $2 = 'HOD' OR $2 = 'SUPERVISOR' OR $2 = 'SECURITY_HEAD' OR $2 = 'ADMIN'
       ORDER BY r.created_at DESC`,
      [req.user.id, req.user.role]
    );

    const registrations = result.rows;

    // Fetch multiple vehicles for each registration
    for (let reg of registrations) {
      const vehRes = await db.query(
        `SELECT * FROM registration_vehicles WHERE registration_id = $1`,
        [reg.id]
      );
      reg.vehicles = vehRes.rows;
    }

    res.json({ success: true, registrations });
  } catch (err) {
    console.error('Error fetching host registrations:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch host registrations.' });
  }
}

// 4. Update Registration Details Before Approval
async function updateRegistration(req, res) {
  const { id } = req.params;
  const {
    full_name,
    phone,
    email,
    gender,
    photo_url,
    id_type,
    id_number,
    id_card_number,
    id_card_image_url,
    visitor_category,
    purpose,
    visit_type,
    stay_required,
    priority,
    is_vvip,
    valid_from,
    valid_until,
    adult_men_count,
    adult_women_count,
    children_count,
    vehicles,
  } = req.body;

  try {
    const regRes = await db.query('SELECT * FROM registrations WHERE id = $1', [id]);
    if (regRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    const reg = regRes.rows[0];

    // Only allow editing if status is pending approval
    const allowedStatuses = ['PENDING_L1', 'PENDING_L2', 'PENDING_ACCOMMODATION'];
    if (!allowedStatuses.includes(reg.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot edit registration with status '${reg.status}'. Editing is only allowed prior to approval.`,
      });
    }

    await db.query('BEGIN');

    // Update Visitor details
    const idCardNo = id_card_number || id_number || '';
    if (phone || full_name) {
      await db.query(
        `UPDATE visitors 
         SET full_name = COALESCE($1, full_name),
             email = COALESCE($2, email),
             gender = COALESCE($3, gender),
             photo_url = COALESCE($4, photo_url),
             id_type = COALESCE($5, id_type),
             id_number = COALESCE($6, id_number),
             id_card_number = COALESCE($7, id_card_number),
             id_card_image_url = COALESCE($8, id_card_image_url),
             visitor_category = COALESCE($9, visitor_category)
         WHERE id = $10`,
        [full_name, email, gender, photo_url, id_type, idCardNo, idCardNo, id_card_image_url, visitor_category, reg.visitor_id]
      );
    }

    // Recalculate guest counts & times
    const menCount = adult_men_count !== undefined ? parseInt(adult_men_count) : reg.adult_men_count;
    const womenCount = adult_women_count !== undefined ? parseInt(adult_women_count) : reg.adult_women_count;
    const boysCount = req.body.boys_count !== undefined ? parseInt(req.body.boys_count) : (reg.boys_count || 0);
    const girlsCount = req.body.girls_count !== undefined ? parseInt(req.body.girls_count) : (reg.girls_count || 0);
    const kidsCount = children_count !== undefined ? parseInt(children_count) : (boysCount + girlsCount);
    const totalCount = menCount + womenCount + boysCount + girlsCount;

    const validFromTime = valid_from ? new Date(valid_from) : reg.valid_from;
    const validUntilTime = valid_until ? new Date(valid_until) : reg.valid_until;

    // Update Registration
    await db.query(
      `UPDATE registrations 
       SET purpose = COALESCE($1, purpose),
           visit_type = COALESCE($2, visit_type),
           stay_required = COALESCE($3, stay_required),
           priority = COALESCE($4, priority),
           is_vvip = COALESCE($5, is_vvip),
           valid_from = $6,
           valid_until = $7,
           adult_men_count = $8,
           adult_women_count = $9,
           children_count = $10,
           boys_count = $11,
           girls_count = $12,
           person_count = $13
       WHERE id = $14`,
      [
        purpose,
        visit_type,
        stay_required,
        priority || (is_vvip ? 'P1' : 'P3'),
        is_vvip,
        validFromTime,
        validUntilTime,
        menCount,
        womenCount,
        kidsCount,
        boysCount,
        girlsCount,
        totalCount,
        id,
      ]
    );

    // Update Registered Vehicles
    if (Array.isArray(vehicles)) {
      await db.query('DELETE FROM registration_vehicles WHERE registration_id = $1', [id]);
      for (const veh of vehicles) {
        if (veh.plate_number && veh.plate_number.trim() !== '') {
          await db.query(
            `INSERT INTO registration_vehicles (registration_id, plate_number, vehicle_type, driver_name, driver_phone)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, veh.plate_number, veh.vehicle_type || 'Car', veh.driver_name || '', veh.driver_phone || '']
          );
        }
      }
    }

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user?.id || null, 'EDIT_REGISTRATION', 'REGISTRATION', id, `Updated registration pre-approval details`]
    );

    await db.query('COMMIT');

    broadcastSyncEvent('REGISTRATION_UPDATED', { registrationId: id, status: reg.status });

    res.json({
      success: true,
      message: 'Registration updated successfully.',
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error updating registration:', err);
    res.status(500).json({ success: false, message: 'Failed to update registration.' });
  }
}

// 5. Get Visit History (All allowed/approved, inside, checked-out, and processed visits)
async function getVisitHistory(req, res) {
  try {
    const result = await db.query(
      `SELECT r.*, 
              v.full_name as visitor_name, v.phone as visitor_phone, v.visitor_category,
              v.photo_url,
              u.name as host_name,
              gl_in.timestamp as entry_time, gl_in.gate_name as entry_gate,
              gl_out.timestamp as exit_time, gl_out.gate_name as exit_gate
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       LEFT JOIN users u ON r.host_id = u.id
       LEFT JOIN LATERAL (
         SELECT timestamp, gate_name FROM gate_logs 
         WHERE registration_id = r.id AND direction = 'IN' 
         ORDER BY timestamp DESC LIMIT 1
       ) gl_in ON true
       LEFT JOIN LATERAL (
         SELECT timestamp, gate_name FROM gate_logs 
         WHERE registration_id = r.id AND direction = 'OUT' 
         ORDER BY timestamp DESC LIMIT 1
       ) gl_out ON true
       WHERE (r.host_id = $1 OR $2 IN ('HOD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'))
       ORDER BY r.created_at DESC
       LIMIT 200`,
      [req.user.id, req.user.role]
    );
    res.json({ success: true, history: result.rows });
  } catch (err) {
    console.error('Error fetching visit history:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch visit history.' });
  }
}

const crypto = require('crypto');

function generateUserGuid(user) {
  if (!user) return '11111111-2222-4333-a444-555555555555';
  if (user.guid) return user.guid;
  const idStr = String(user.id || '1');
  const emailStr = String(user.email || 'user@sai.org');
  const hash = crypto.createHash('sha256').update(`vms_guid_salt_${idStr}_${emailStr}`).digest('hex');
  return `${hash.substring(0,8)}-${hash.substring(8,12)}-4${hash.substring(13,16)}-a${hash.substring(17,20)}-${hash.substring(20,32)}`;
}

async function resolveHostUser(identifier) {
  if (!identifier) return null;
  const str = String(identifier).trim();
  
  if (!isNaN(str) && /^\d+$/.test(str)) {
    const res = await db.query('SELECT id, name, residency_status, role, email FROM users WHERE id = $1', [parseInt(str)]);
    if (res.rows.length > 0) return res.rows[0];
  }

  const allUsers = await db.query('SELECT id, name, residency_status, role, email FROM users');
  for (const u of allUsers.rows) {
    if (generateUserGuid(u) === str || String(u.id) === str) {
      return u;
    }
  }

  return allUsers.rows[0] || null;
}

// Ensure invite_tokens table exists
async function ensureInviteTokensTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS invite_tokens (
        id SERIAL PRIMARY KEY,
        token VARCHAR(100) UNIQUE NOT NULL,
        host_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_used BOOLEAN DEFAULT FALSE,
        used_at TIMESTAMP,
        registration_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('Error creating invite_tokens table:', err);
  }
}
ensureInviteTokensTable();

// Generate a Single-Use Invite Token
async function generateInviteToken(req, res) {
  try {
    const hostId = req.user.id;
    const token = `inv_${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO invite_tokens (token, host_id, is_used) VALUES ($1, $2, false)`,
      [token, hostId]
    );
    res.json({ success: true, token, host_id: hostId });
  } catch (err) {
    console.error('Error generating invite token:', err);
    res.status(500).json({ success: false, message: 'Failed to generate single-use invite token.' });
  }
}

// 6. Public Host Details lookup for Shared Visitor Link (PDF Page 6-7)
async function getPublicHostInfo(req, res) {
  const { host_id } = req.params;
  try {
    // Check if single-use token
    if (typeof host_id === 'string' && host_id.startsWith('inv_')) {
      const tokenRes = await db.query(
        `SELECT it.*, u.name, u.residency_status, u.role 
         FROM invite_tokens it 
         JOIN users u ON it.host_id = u.id 
         WHERE it.token = $1`,
        [host_id]
      );
      if (tokenRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Invalid or non-existent invitation link.' });
      }
      const tok = tokenRes.rows[0];
      if (tok.is_used) {
        return res.json({
          success: true,
          is_used: true,
          message: 'This invitation link has already been used to submit a visitor registration and is now expired.',
          host: { id: tok.host_id, name: tok.name, residency_status: tok.residency_status }
        });
      }
      return res.json({
        success: true,
        is_used: false,
        host: { id: tok.host_id, name: tok.name, residency_status: tok.residency_status }
      });
    }

    const host = await resolveHostUser(host_id);
    if (!host) {
      return res.status(404).json({ success: false, message: 'Host not found.' });
    }
    res.json({ success: true, is_used: false, host });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch host details.' });
  }
}

// 7. Public Visitor Form Submission from Shared Link (PDF Page 7)
async function createPublicVisitorRegistration(req, res) {
  const {
    host_id,
    token,
    full_name,
    phone,
    gender,
    registration_mode,
    adult_men_count,
    adult_women_count,
    children_count,
    valid_from,
    valid_until,
    photo_url,
    purpose,
  } = req.body;

  const activeToken = token || (typeof host_id === 'string' && host_id.startsWith('inv_') ? host_id : null);

  if (!host_id || !full_name || !phone) {
    return res.status(400).json({ success: false, message: 'Host ID/GUID, Full Name, and Phone are required.' });
  }

  try {
    if (activeToken) {
      const checkTok = await db.query('SELECT is_used FROM invite_tokens WHERE token = $1', [activeToken]);
      if (checkTok.rows.length > 0 && checkTok.rows[0].is_used) {
        return res.status(400).json({
          success: false,
          message: 'This invitation link has already been submitted. Re-submission is not allowed.'
        });
      }
    }

    const hostUser = await resolveHostUser(host_id);
    const hostNumericId = hostUser ? hostUser.id : 1;

    await db.query('BEGIN');

    let visitorId;
    const existing = await db.query('SELECT id FROM visitors WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      visitorId = existing.rows[0].id;
      await db.query('UPDATE visitors SET full_name = $1, gender = $2, photo_url = COALESCE($3, photo_url) WHERE id = $4', [full_name, gender || 'Male', photo_url || '', visitorId]);
    } else {
      const newV = await db.query(
        'INSERT INTO visitors (full_name, phone, gender, photo_url) VALUES ($1, $2, $3, $4) RETURNING id',
        [full_name, phone, gender || 'Male', photo_url || '']
      );
      visitorId = newV.rows[0].id;
    }

    const passCode = `PASS-${Math.floor(1000 + Math.random() * 9000)}`;
    const validFromTime = valid_from ? new Date(valid_from) : new Date();
    let validUntilTime;
    if (valid_until) {
      validUntilTime = new Date(valid_until);
    } else {
      validUntilTime = new Date(validFromTime);
      validUntilTime.setDate(validUntilTime.getDate() + 1);
      validUntilTime.setHours(21, 0, 0, 0); // Default to Tomorrow 9:00 PM
    }

    const menCount = parseInt(adult_men_count) || 1;
    const womenCount = parseInt(adult_women_count) || 0;
    const kidsCount = parseInt(children_count) || 0;
    const totalCount = menCount + womenCount + kidsCount;

    const regRes = await db.query(
      `INSERT INTO registrations 
       (visitor_id, host_id, purpose, registration_mode, registration_type, visit_type, priority, status, pass_code, valid_from, valid_until, adult_men_count, adult_women_count, children_count, person_count, host_notified_at)
       VALUES ($1, $2, $3, $4, 'PRE_APPROVAL', 'HOME', 'P3', 'PENDING_L1', $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
       RETURNING *`,
      [visitorId, hostNumericId, purpose || 'Visitor Self-Filled Form via Share Link', registration_mode || 'Single', passCode, validFromTime, validUntilTime, menCount, womenCount, kidsCount, totalCount]
    );

    const registration = regRes.rows[0];

    if (activeToken) {
      await db.query(
        `UPDATE invite_tokens SET is_used = true, used_at = CURRENT_TIMESTAMP, registration_id = $1 WHERE token = $2`,
        [registration.id, activeToken]
      );
    }

    await db.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4)`,
      ['PUBLIC_VISITOR_SUBMIT', 'REGISTRATION', registration.id, `Visitor ${full_name} submitted self-invite form for Host #${host_id}`]
    );

    await db.query('COMMIT');

    broadcastSyncEvent('PUBLIC_VISITOR_SUBMITTED', {
      registration,
      host_id: hostNumericId,
      visitor_name: full_name,
      pass_code: passCode,
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Visitor information submitted successfully! Awaiting host approval.',
      pass_code: passCode,
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error submitting public visitor registration:', err);
    res.status(500).json({ success: false, message: 'Failed to submit visitor registration.' });
  }
}

// 2b. Explicit Referrer Generate QR Code button
async function generateRegistrationQr(req, res) {
  const { registration_id } = req.body;
  if (!registration_id) {
    return res.status(400).json({ success: false, message: 'Registration ID required.' });
  }

  try {
    const regRes = await db.query('SELECT * FROM registrations WHERE id = $1', [registration_id]);
    if (regRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    const reg = regRes.rows[0];
    if (reg.status !== 'APPROVED' && reg.status !== 'ADMIN_BYPASSED' && !reg.bypassed_by_admin) {
      return res.status(400).json({
        success: false,
        message: `Cannot generate QR Code. Registration status is '${reg.status}'. Pass must be approved first.`,
      });
    }

    let qrCodeUrl = reg.qr_code_url;
    if (!qrCodeUrl) {
      const qrData = JSON.stringify({ passCode: reg.pass_code, regId: reg.id, isVvip: reg.is_vvip });
      qrCodeUrl = await QRCode.toDataURL(qrData);
      await db.query('UPDATE registrations SET qr_code_url = $1 WHERE id = $2', [qrCodeUrl, reg.id]);
    }

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'GENERATE_QR_CODE', 'REGISTRATION', reg.id, `Referrer ${req.user.name} generated QR Code for Pass ${reg.pass_code}`]
    );

    broadcastSyncEvent('QR_GENERATED', { registrationId: reg.id, passCode: reg.pass_code });

    res.json({
      success: true,
      message: `QR Code and Passcode generated for ${reg.pass_code}! Share it with your guest.`,
      pass_code: reg.pass_code,
      qr_code_url: qrCodeUrl,
      is_single_use: !reg.is_permanent_pass,
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
    res.status(500).json({ success: false, message: 'Failed to generate QR code.' });
  }
}

// Public Passcard Details lookup by Passcode for WhatsApp/Email View
async function getPublicPassDetails(req, res) {
  const { pass_code } = req.params;
  try {
    const result = await db.query(
      `SELECT r.*, v.full_name as visitor_name, v.phone as visitor_phone, v.photo_url as visitor_photo, u.name as host_name
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       LEFT JOIN users u ON r.host_id = u.id 
       WHERE r.pass_code = $1 OR CAST(r.id AS VARCHAR) = $1`,
      [pass_code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gate pass not found.' });
    }

    const reg = result.rows[0];
    let qrCodeUrl = reg.qr_code_url;
    if (!qrCodeUrl) {
      const qrData = JSON.stringify({ passCode: reg.pass_code, regId: reg.id, isVvip: reg.is_vvip });
      qrCodeUrl = await QRCode.toDataURL(qrData);
    }

    res.json({
      success: true,
      pass: {
        id: reg.id,
        pass_code: reg.pass_code,
        visitor_name: reg.visitor_name,
        visitor_phone: reg.visitor_phone,
        visitor_photo: reg.visitor_photo,
        host_name: reg.host_name,
        status: reg.status,
        qr_code_url: qrCodeUrl,
        valid_from: reg.valid_from,
        valid_until: reg.valid_until,
        is_permanent_pass: reg.is_permanent_pass,
        person_count: reg.person_count,
        registration_mode: reg.registration_mode,
      }
    });
  } catch (err) {
    console.error('Error fetching public pass details:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch public pass details.' });
  }
}

// Direct PNG Image endpoint for WhatsApp preview & attachment download
async function getQrCodePngImage(req, res) {
  let pass_code = req.params.pass_code || '';
  if (pass_code.endsWith('.png')) {
    pass_code = pass_code.slice(0, -4);
  }
  try {
    const result = await db.query(
      'SELECT pass_code, id, is_vvip FROM registrations WHERE pass_code = $1 OR CAST(id AS VARCHAR) = $1',
      [pass_code]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Pass not found');
    }

    const reg = result.rows[0];
    const qrData = JSON.stringify({ passCode: reg.pass_code, regId: reg.id, isVvip: reg.is_vvip });
    const buffer = await QRCode.toBuffer(qrData, { type: 'png', width: 400, margin: 2 });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('Error generating QR PNG:', err);
    res.status(500).send('Failed to render QR Code image.');
  }
}

module.exports = {
  createRegistration,
  updateApproval,
  generateRegistrationQr,
  getHostRegistrations,
  updateRegistration,
  isL2Enabled,
  getVisitHistory,
  getPublicHostInfo,
  createPublicVisitorRegistration,
  generateInviteToken,
  getPublicPassDetails,
  getQrCodePngImage,
};
