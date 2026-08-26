const bcrypt = require('bcryptjs');
const db = require('../config/db');
const QRCode = require('qrcode');

// Get all users for admin management
async function getAllUsers(req, res) {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.residency_status, u.registration_status, u.department_id, u.created_at, d.name as department_name
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
  const { name, email, phone, role, residency_status, department_id, password } = req.body;

  if (!name || !email || !phone || !role) {
    return res.status(400).json({ success: false, message: 'Name, email, phone, and role are required.' });
  }

  const validRoles = ['RESIDENT', 'EMPLOYEE', 'HOD', 'GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'];
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
      `INSERT INTO users (name, email, phone, role, residency_status, department_id, password_hash, registration_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
       RETURNING id, name, email, phone, role, residency_status, department_id, registration_status, created_at`,
      [name, email, phone, role, validResidency, department_id || null, hashedPassword]
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

module.exports = {
  getAllUsers,
  getDepartments,
  createSingleUser,
  bulkUploadUsers,
  bulkUploadVisitors,
};
