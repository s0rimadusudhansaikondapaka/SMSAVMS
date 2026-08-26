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
    const validUntilTime = valid_until ? new Date(valid_until) : new Date(Date.now() + 12 * 60 * 60 * 1000);

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
    const kidsCount = parseInt(children_count) || 0;
    const totalCount = menCount + womenCount + kidsCount;

    // Insert Registration
    const regRes = await db.query(
      `INSERT INTO registrations 
       (visitor_id, host_id, purpose, visit_type, stay_required, accommodation_approved, priority, status, pass_code, valid_from, valid_until, adult_men_count, adult_women_count, children_count, person_count, is_vvip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
        totalCount,
        is_vvip || false,
      ]
    );

    const registration = regRes.rows[0];

    // Set host notification timestamp for timeout tracking
    if (registration.host_id && initialStatus === 'PENDING_L1') {
      await db.query('UPDATE registrations SET host_notified_at = NOW() WHERE id = $1', [registration.id]);
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
      await db.query('UPDATE registrations SET qr_code_url = $1 WHERE id = $2', [qrCodeUrl, registration.id]);
      registration.qr_code_url = qrCodeUrl;
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
  const { registration_id, action, remarks } = req.body;
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
      if (reg.stay_required && !reg.accommodation_approved) {
        newStatus = 'PENDING_ACCOMMODATION';
      } else if (l2Enabled && reg.visit_type === 'OFFICE' && req.user.role !== 'HOD') {
        newStatus = 'PENDING_L2';
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
      `UPDATE registrations SET status = $1, qr_code_url = $2, accommodation_approved = CASE WHEN $3 = true THEN true ELSE accommodation_approved END WHERE id = $4`,
      [newStatus, qrCodeUrl, reg.stay_required && req.user.role === 'HOD', registration_id]
    );

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, `APPROVAL_${action}`, 'REGISTRATION', registration_id, remarks || `Action ${action} by ${req.user.name}`]
    );

    broadcastSyncEvent('REGISTRATION_UPDATED', { registrationId: registration_id, status: newStatus });

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
    const kidsCount = children_count !== undefined ? parseInt(children_count) : reg.children_count;
    const totalCount = menCount + womenCount + kidsCount;

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
           person_count = $11
       WHERE id = $12`,
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

// 5. Get Visit History (completed, expired, checked-out visits)
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
       AND r.status IN ('CHECKED_OUT', 'EXPIRED', 'NOT_ARRIVED', 'REJECTED')
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [req.user.id, req.user.role]
    );
    res.json({ success: true, history: result.rows });
  } catch (err) {
    console.error('Error fetching visit history:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch visit history.' });
  }
}

module.exports = {
  createRegistration,
  updateApproval,
  getHostRegistrations,
  updateRegistration,
  isL2Enabled,
  getVisitHistory,
};
