const bcrypt = require('bcryptjs');
const db = require('../config/db');
const QRCode = require('qrcode');
const { broadcastSyncEvent } = require('../sockets/syncServer');

// Get all users for admin management
async function getAllUsers(req, res) {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.residency_status, u.registration_status, u.department_id, u.flat_info, COALESCE(u.flat_info, 'Ashram Campus') as address, u.created_at, d.name as department_name
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       ORDER BY u.id DESC`
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
}

// Get departments list
async function getDepartments(req, res) {
  try {
    const result = await db.query('SELECT * FROM departments ORDER BY name');
    res.json({ success: true, departments: result.rows });
  } catch (err) {
    console.error('Error fetching departments:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch departments.' });
  }
}

// Create single user by Admin (Wizard)
async function createSingleUser(req, res) {
  const { name, email, phone, role, residency_status, department_id, password, address, flat_info } = req.body;
  const userAddress = address || flat_info || '';

  if (!name || !email || !phone || !role) {
    return res.status(400).json({ success: false, message: 'Name, email, phone, and role are required.' });
  }

  const validRoles = ['RESIDENT', 'EMPLOYEE', 'RESIDENT_EMPLOYEE', 'HOD', 'PRO', 'GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  const validResidency = residency_status || (role === 'RESIDENT' ? 'RESIDENT' : 'NON_RESIDENT');

  try {
    // Check duplicates
    const checkEmail = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (checkEmail.rows.length > 0) {
      return res.status(409).json({ success: false, message: `User with email '${email}' already exists.` });
    }

    const checkPhone = await db.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (checkPhone.rows.length > 0) {
      return res.status(409).json({ success: false, message: `User with phone '${phone}' already exists.` });
    }

    const userPassword = password || 'password123';
    const hashedPassword = await bcrypt.hash(userPassword, 10);

    const result = await db.query(
      `INSERT INTO users (name, email, phone, role, residency_status, department_id, password_hash, flat_info, registration_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
       RETURNING id, name, email, phone, role, residency_status, department_id, flat_info, registration_status, created_at`,
      [name, email, phone, role, validResidency, department_id || null, hashedPassword, userAddress]
    );

    const newUser = result.rows[0];

    // Audit log
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'CREATE_USER_WIZARD', 'USER', newUser.id, `Admin ${req.user.name} created user ${name} (${role})`]
    );

    res.status(201).json({
      success: true,
      message: `User '${name}' created successfully with role ${role}.`,
      user: newUser,
    });
  } catch (err) {
    console.error('Create single user error:', err);
    res.status(500).json({ success: false, message: 'Server error creating user.' });
  }
}

// Bulk Upload Users via Excel/JSON Array
async function bulkUploadUsers(req, res) {
  const { users } = req.body;

  if (!Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid or empty users array provided.' });
  }

  let createdCount = 0;
  let failedCount = 0;
  const errors = [];
  const createdUsers = [];

  // Fetch departments mapping
  const deptRes = await db.query('SELECT id, LOWER(name) as name_lower FROM departments');
  const deptMap = {};
  deptRes.rows.forEach(d => { deptMap[d.name_lower] = d.id; });

  const defaultPasswordHash = await bcrypt.hash('password123', 10);

  for (let i = 0; i < users.length; i++) {
    const row = users[i];
    const rowNum = i + 1;

    const name = row.name || row.Name || row['Full Name'];
    const email = row.email || row.Email || row['Email Address'];
    const phone = row.phone || row.Phone || row['Phone Number'] || row['Mobile'];
    const role = (row.role || row.Role || 'RESIDENT').toUpperCase();
    const residency_status = (row.residency_status || row.Residency || (role === 'RESIDENT' ? 'RESIDENT' : 'NON_RESIDENT')).toUpperCase();
    const deptName = row.department || row.Department || row['Department Name'] || '';
    const password = row.password || row.Password || 'password123';

    if (!name || !email || !phone) {
      failedCount++;
      errors.push({ row: rowNum, message: 'Missing required fields (Name, Email, or Phone).' });
      continue;
    }

    let deptId = null;
    if (deptName && deptMap[deptName.toLowerCase()]) {
      deptId = deptMap[deptName.toLowerCase()];
    }

    try {
      // Check existing email/phone
      const existing = await db.query('SELECT id FROM users WHERE email = $1 OR phone = $2', [email, phone]);
      if (existing.rows.length > 0) {
        failedCount++;
        errors.push({ row: rowNum, name, email, message: 'User with this email or phone already exists.' });
        continue;
      }

      const passHash = password === 'password123' ? defaultPasswordHash : await bcrypt.hash(password, 10);

      const ins = await db.query(
        `INSERT INTO users (name, email, phone, role, residency_status, department_id, password_hash, registration_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         RETURNING id, name, email, phone, role`,
        [name, email, phone, role, residency_status, deptId, passHash]
      );

      createdCount++;
      createdUsers.push(ins.rows[0]);
    } catch (err) {
      failedCount++;
      errors.push({ row: rowNum, name, email, message: err.message });
    }
  }

  // Audit log
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, remarks) VALUES ($1, $2, $3, $4)`,
    [req.user.id, 'BULK_USER_UPLOAD', 'USER', `Bulk uploaded ${createdCount} users. Failed: ${failedCount}. Executed by ${req.user.name}`]
  );

  res.json({
    success: true,
    message: `Bulk user import complete. ${createdCount} users created successfully. ${failedCount} failed.`,
    createdCount,
    failedCount,
    errors,
    createdUsers,
  });
}

// Bulk Upload Visitors via Excel/JSON Array
async function bulkUploadVisitors(req, res) {
  const { visitors } = req.body;

  if (!Array.isArray(visitors) || visitors.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid or empty visitors array provided.' });
  }

  let createdCount = 0;
  let failedCount = 0;
  const errors = [];
  const generatedPasses = [];

  // Default host user (current admin or resident #1)
  const hostId = req.user?.id || 1;

  for (let i = 0; i < visitors.length; i++) {
    const row = visitors[i];
    const rowNum = i + 1;

    const full_name = row.full_name || row.Name || row['Visitor Name'] || row['Full Name'];
    const phone = row.phone || row.Phone || row['Mobile'] || row['Phone Number'];
    const email = row.email || row.Email || '';
    const gender = row.gender || row.Gender || 'Male';
    const category = (row.visitor_category || row.Category || 'GENERAL').toUpperCase();
    const visit_type = (row.visit_type || row['Visit Type'] || 'OFFICE').toUpperCase();
    const purpose = row.purpose || row.Purpose || 'Bulk Event / Institutional Visit';
    const vehicle_no = row.vehicle_no || row['Vehicle No'] || row['Vehicle Number'] || '';
    const person_count = parseInt(row.person_count || row['Person Count'] || 1);

    if (!full_name || !phone) {
      failedCount++;
      errors.push({ row: rowNum, message: 'Missing required Visitor Name or Phone Number.' });
      continue;
    }

    try {
      // 1. Insert or find Visitor record
      let visitorId;
      const existingVisitor = await db.query('SELECT id FROM visitors WHERE phone = $1', [phone]);

      if (existingVisitor.rows.length > 0) {
        visitorId = existingVisitor.rows[0].id;
        await db.query(
          `UPDATE visitors SET full_name = $1, email = $2, visitor_category = $3, vehicle_no = $4 WHERE id = $5`,
          [full_name, email, category, vehicle_no, visitorId]
        );
      } else {
        const newVisitor = await db.query(
          `INSERT INTO visitors (full_name, phone, email, gender, visitor_category, vehicle_no, has_smartphone)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          [full_name, phone, email, gender, category, vehicle_no]
        );
        visitorId = newVisitor.rows[0].id;
      }

      // 2. Generate unique Pass Code & QR code
      const passCode = `BULK-${Math.floor(100000 + Math.random() * 900000)}`;
      const qrDataUrl = await QRCode.toDataURL(passCode);

      const validFrom = row.valid_from ? new Date(row.valid_from) : new Date();
      const validUntil = row.valid_until ? new Date(row.valid_until) : new Date(Date.now() + 24 * 60 * 60 * 1000);

      // 3. Create auto-approved visitor registration
      const regRes = await db.query(
        `INSERT INTO registrations (
          visitor_id, host_id, purpose, registration_mode, registration_type, visit_type,
          priority, status, pass_code, qr_code_url, valid_from, valid_until, person_count, bypassed_by_admin
        ) VALUES ($1, $2, $3, 'Group', 'PRE_APPROVAL', $4, 'P3', 'APPROVED', $5, $6, $7, $8, $9, true)
        RETURNING id, pass_code, status, valid_from, valid_until`,
        [visitorId, hostId, purpose, visit_type, passCode, qrDataUrl, validFrom, validUntil, person_count]
      );

      // 4. Add vehicle if provided
      if (vehicle_no) {
        await db.query(
          `INSERT INTO registration_vehicles (registration_id, plate_number, vehicle_type) VALUES ($1, $2, 'Car')`,
          [regRes.rows[0].id, vehicle_no]
        );
      }

      createdCount++;
      generatedPasses.push({
        visitor_name: full_name,
        phone,
        pass_code: passCode,
        status: 'APPROVED',
        qr_code_url: qrDataUrl,
      });
    } catch (err) {
      failedCount++;
      errors.push({ row: rowNum, name: full_name, message: err.message });
    }
  }

  // Audit log
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, remarks) VALUES ($1, $2, $3, $4)`,
    [req.user.id, 'BULK_VISITOR_UPLOAD', 'REGISTRATION', `Bulk uploaded ${createdCount} visitor passes. Failed: ${failedCount}. Executed by ${req.user.name}`]
  );

  res.json({
    success: true,
    message: `Bulk visitor import complete. ${createdCount} passes issued & auto-approved. ${failedCount} failed.`,
    createdCount,
    failedCount,
    errors,
    generatedPasses,
  });
}

// Get all gatewise visitor category rules
async function getGateCategoryRules(req, res) {
  try {
    const result = await db.query(
      `SELECT * FROM gate_category_rules ORDER BY gate_name, visitor_category`
    );
    res.json({ success: true, rules: result.rows });
  } catch (err) {
    console.error('Error fetching gate category rules:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch gate category rules.' });
  }
}

// Update/toggle gatewise category IN/OUT direction rule (Super Admin)
async function toggleGateCategoryRule(req, res) {
  const { gate_name, visitor_category, is_allowed, direction_mode, allow_in, allow_out } = req.body;

  if (!gate_name || !visitor_category) {
    return res.status(400).json({ success: false, message: 'gate_name and visitor_category are required.' });
  }

  let finalMode = direction_mode;
  if (!finalMode) {
    if (allow_in !== undefined || allow_out !== undefined) {
      const inVal = allow_in !== undefined ? Boolean(allow_in) : true;
      const outVal = allow_out !== undefined ? Boolean(allow_out) : true;
      if (inVal && outVal) finalMode = 'BOTH';
      else if (inVal && !outVal) finalMode = 'IN_ONLY';
      else if (!inVal && outVal) finalMode = 'OUT_ONLY';
      else finalMode = 'DISABLED';
    } else if (is_allowed !== undefined) {
      finalMode = is_allowed ? 'BOTH' : 'DISABLED';
    } else {
      finalMode = 'BOTH';
    }
  }

  const isAllowedBool = finalMode !== 'DISABLED';
  const allowInBool = finalMode === 'BOTH' || finalMode === 'IN_ONLY';
  const allowOutBool = finalMode === 'BOTH' || finalMode === 'OUT_ONLY';

  try {
    // Dynamic schema auto-migration for direction_mode columns
    try {
      await db.query(`
        ALTER TABLE gate_category_rules 
        ADD COLUMN IF NOT EXISTS direction_mode VARCHAR(50) DEFAULT 'BOTH',
        ADD COLUMN IF NOT EXISTS allow_in BOOLEAN DEFAULT true,
        ADD COLUMN IF NOT EXISTS allow_out BOOLEAN DEFAULT true;
      `);
    } catch (colErr) {}

    const existing = await db.query(
      `SELECT id FROM gate_category_rules WHERE gate_name = $1 AND visitor_category = $2`,
      [gate_name, visitor_category]
    );

    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE gate_category_rules 
         SET is_allowed = $1, direction_mode = $2, allow_in = $3, allow_out = $4, updated_at = CURRENT_TIMESTAMP 
         WHERE gate_name = $5 AND visitor_category = $6`,
        [isAllowedBool, finalMode, allowInBool, allowOutBool, gate_name, visitor_category]
      );
    } else {
      await db.query(
        `INSERT INTO gate_category_rules (gate_name, visitor_category, is_allowed, direction_mode, allow_in, allow_out, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [gate_name, visitor_category, isAllowedBool, finalMode, allowInBool, allowOutBool]
      );
    }

    try {
      await db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, remarks) VALUES ($1, $2, $3, $4)`,
        [
          req.user.id,
          'UPDATE_GATE_CATEGORY_RULE',
          'GATE_RULE',
          `Super Admin ${req.user.name} set category '${visitor_category}' at gate '${gate_name}' to direction state '${finalMode}' (IN: ${allowInBool}, OUT: ${allowOutBool})`,
        ]
      );
    } catch (auditErr) {}

    broadcastSyncEvent('GATE_RULE_UPDATED', {
      gate_name,
      visitor_category,
      direction_mode: finalMode,
      allow_in: allowInBool,
      allow_out: allowOutBool,
      updated_by: req.user.name,
    });

    res.json({
      success: true,
      message: `Category '${visitor_category}' at gate '${gate_name}' updated to ${finalMode}.`,
    });
  } catch (err) {
    console.error('Error updating gate category rule:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to update gate category rule.' });
  }
}

// Get L2 Approval Matrix Rules (Super Admin)
async function getL2MatrixRules(req, res) {
  try {
    const result = await db.query(
      `SELECT * FROM l2_approval_matrix_rules ORDER BY host_category, visit_type_category`
    );
    res.json({ success: true, rules: result.rows });
  } catch (err) {
    console.error('Error fetching L2 matrix rules:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch L2 matrix rules.' });
  }
}

// Update L2 Approval Matrix Rule (Super Admin)
async function updateL2MatrixRule(req, res) {
  const { host_category, visit_type_category, approver_type, is_enabled } = req.body;

  if (!host_category || !visit_type_category || !approver_type) {
    return res.status(400).json({ success: false, message: 'host_category, visit_type_category, and approver_type required.' });
  }

  try {
    await db.query(
      `INSERT INTO l2_approval_matrix_rules (host_category, visit_type_category, approver_type, is_enabled, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (host_category, visit_type_category)
       DO UPDATE SET approver_type = EXCLUDED.approver_type, is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP`,
      [host_category, visit_type_category, approver_type, is_enabled !== undefined ? is_enabled : true]
    );

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, remarks) VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'UPDATE_L2_MATRIX_RULE', 'L2_RULE', `Super Admin ${req.user.name} updated L2 rule for ${host_category} + ${visit_type_category} to ${approver_type}`]
    );

    broadcastSyncEvent('L2_RULE_UPDATED', { host_category, visit_type_category, approver_type, updated_by: req.user.name });

    res.json({
      success: true,
      message: `L2 Approval Rule updated for ${host_category} (${visit_type_category}) to ${approver_type}.`,
    });
  } catch (err) {
    console.error('Error updating L2 matrix rule:', err);
    res.status(500).json({ success: false, message: 'Failed to update L2 matrix rule.' });
  }
}

// Get All Pending L2 Approvals for Super Admin
async function getAllPendingL2Approvals(req, res) {
  try {
    const result = await db.query(
      `SELECT r.*, 
              v.full_name as visitor_name, v.phone as visitor_phone, v.visitor_category, v.photo_url,
              u.name as host_name, u.role as host_role, u.department as host_department, u.address as host_address
       FROM registrations r
       JOIN visitors v ON r.visitor_id = v.id
       LEFT JOIN users u ON r.host_id = u.id
       WHERE r.status = 'PENDING_L2' OR r.status = 'PENDING_L1'
       ORDER BY r.created_at DESC`
    );
    res.json({ success: true, pending_approvals: result.rows });
  } catch (err) {
    console.error('Error fetching pending L2 approvals:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pending L2 approvals.' });
  }
}

// Process L2 Approval or Rejection by Super Admin
async function processL2ApprovalByAdmin(req, res) {
  const { registration_id, action, remarks } = req.body;

  if (!registration_id || !action || !['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Registration ID and valid action (APPROVE or REJECT) required.' });
  }

  try {
    const regRes = await db.query('SELECT * FROM registrations WHERE id = $1', [registration_id]);
    if (regRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Registration pass not found.' });
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const auditAction = action === 'APPROVE' ? 'SUPERADMIN_L2_APPROVED' : 'SUPERADMIN_L2_REJECTED';
    const auditRemarks = remarks || `Super Admin ${req.user.name} (${req.user.role}) executed L2 ${action}`;

    await db.query(
      `UPDATE registrations 
       SET status = $1, approved_by_name = $2, approved_by_role = $3, approval_timestamp = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [newStatus, req.user.name, req.user.role, registration_id]
    );

    // Audit Logging
    await db.query(
      `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, status, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.user.id, req.user.name, req.user.role, auditAction, 'REGISTRATION', registration_id, 'SUCCESS', auditRemarks]
    );

    if (newStatus === 'APPROVED' && regRes.rows[0].family_member_id) {
      await db.query(
        `UPDATE resident_family_members SET is_pro_approved = true, pro_approved_by = $1, pro_approved_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [req.user.id, regRes.rows[0].family_member_id]
      );
    }

    // Broadcast WebSocket Event
    broadcastSyncEvent('REGISTRATION_UPDATED', { registration_id, status: newStatus, updated_by: req.user.name });

    // Send Visitor Email on Approval Completion
    if (newStatus === 'APPROVED') {
      const visRes = await db.query(
        `SELECT r.*, v.full_name as visitor_name, v.email as visitor_email 
         FROM registrations r JOIN visitors v ON r.visitor_id = v.id WHERE r.id = $1`,
        [registration_id]
      );
      if (visRes.rows.length > 0 && visRes.rows[0].visitor_email) {
        const vis = visRes.rows[0];
        const { sendVisitorApprovalEmail } = require('../services/emailService');
        sendVisitorApprovalEmail({
          visitorEmail: vis.visitor_email,
          visitorName: vis.visitor_name,
          passCode: vis.pass_code,
          validFrom: vis.valid_from,
          validUntil: vis.valid_until,
          hostName: req.user.name,
        });
      }
    }

    res.json({
      success: true,
      message: `Pass ${regRes.rows[0].pass_code} successfully ${newStatus} by Super Admin.`,
    });
  } catch (err) {
    console.error('Error processing L2 approval by Admin:', err);
    res.status(500).json({ success: false, message: 'Failed to process L2 approval.' });
  }
}

// Get all gate direction / In-Out state configurations (Super Admin & Gate Terminal)
async function getGateDirectionConfig(req, res) {
  try {
    const result = await db.query(`SELECT * FROM gate_direction_config ORDER BY gate_name`);
    res.json({ success: true, configs: result.rows });
  } catch (err) {
    console.error('Error fetching gate direction configs:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch gate direction configs.' });
  }
}

// Update gate direction / In-Out state mode (Super Admin)
async function updateGateDirectionConfig(req, res) {
  const { gate_name, direction_mode } = req.body;
  if (!gate_name || !direction_mode) {
    return res.status(400).json({ success: false, message: 'gate_name and direction_mode are required.' });
  }

  const validModes = ['BOTH', 'IN_ONLY', 'OUT_ONLY', 'CLOSED'];
  if (!validModes.includes(direction_mode)) {
    return res.status(400).json({ success: false, message: 'Invalid direction_mode. Must be BOTH, IN_ONLY, OUT_ONLY, or CLOSED.' });
  }

  try {
    const existing = await db.query(`SELECT gate_name FROM gate_direction_config WHERE gate_name = $1`, [gate_name]);
    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE gate_direction_config SET direction_mode = $1, updated_at = CURRENT_TIMESTAMP WHERE gate_name = $2`,
        [direction_mode, gate_name]
      );
    } else {
      await db.query(
        `INSERT INTO gate_direction_config (gate_name, direction_mode, is_active, updated_at) VALUES ($1, $2, true, CURRENT_TIMESTAMP)`,
        [gate_name, direction_mode]
      );
    }

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, remarks) VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'UPDATE_GATE_DIRECTION_CONFIG', 'GATE_RULE', `Super Admin ${req.user.name} set gate '${gate_name}' direction state mode to '${direction_mode}'`]
    );

    broadcastSyncEvent('GATE_DIRECTION_CONFIG_UPDATED', {
      gate_name,
      direction_mode,
      updated_by: req.user.name,
      timestamp: new Date()
    });

    res.json({ success: true, message: `Gate ${gate_name} state updated to ${direction_mode}` });
  } catch (err) {
    console.error('Error updating gate direction config:', err);
    res.status(500).json({ success: false, message: 'Failed to update gate direction config.' });
  }
}

// Update User Details & Registration Status (Super Admin)
async function updateSingleUser(req, res) {
  const { id } = req.params;
  const {
    name,
    email,
    phone,
    role,
    residency_status,
    registration_status,
    flat_info,
    department_id,
  } = req.body;

  if (!id) {
    return res.status(400).json({ success: false, message: 'User ID is required.' });
  }

  try {
    const existingRes = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const existingUser = existingRes.rows[0];

    const updatedName = name || existingUser.name;
    const updatedEmail = email || existingUser.email;
    const updatedPhone = phone || existingUser.phone;
    const updatedRole = role || existingUser.role;
    const updatedResidency = residency_status || existingUser.residency_status;
    const updatedStatus = registration_status || existingUser.registration_status || 'ACTIVE';
    const updatedFlatInfo = flat_info !== undefined ? flat_info : existingUser.flat_info;
    const updatedDeptId = department_id !== undefined ? (department_id ? parseInt(department_id) : null) : existingUser.department_id;

    await db.query(
      `UPDATE users 
       SET name = $1, 
           email = $2, 
           phone = $3, 
           role = $4, 
           residency_status = $5, 
           registration_status = $6, 
           flat_info = $7, 
           department_id = $8 
       WHERE id = $9`,
      [
        updatedName,
        updatedEmail,
        updatedPhone,
        updatedRole,
        updatedResidency,
        updatedStatus,
        updatedFlatInfo,
        updatedDeptId,
        id,
      ]
    );

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.id,
        'UPDATE_USER_DETAILS',
        'USER',
        id,
        `Super Admin ${req.user.name} updated user #${id} (${updatedName}). Status: ${updatedStatus}, Role: ${updatedRole}`,
      ]
    );

    broadcastSyncEvent('USER_UPDATED', {
      user_id: id,
      name: updatedName,
      status: updatedStatus,
      updated_by: req.user.name,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: `User '${updatedName}' updated successfully! Status set to ${updatedStatus}.`,
    });
  } catch (err) {
    console.error('Error updating user details:', err);
    res.status(500).json({ success: false, message: 'Failed to update user details.' });
  }
}

module.exports = {
  getAllUsers,
  getDepartments,
  createSingleUser,
  updateSingleUser,
  bulkUploadUsers,
  bulkUploadVisitors,
  getGateCategoryRules,
  toggleGateCategoryRule,
  getL2MatrixRules,
  updateL2MatrixRule,
  getAllPendingL2Approvals,
  processL2ApprovalByAdmin,
  getGateDirectionConfig,
  updateGateDirectionConfig,
};
