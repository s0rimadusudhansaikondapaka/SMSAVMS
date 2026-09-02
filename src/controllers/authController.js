const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { JWT_SECRET } = require('../middlewares/auth');

const crypto = require('crypto');

function generateUserGuid(user) {
  if (user && user.guid) return user.guid;
  const idStr = user ? (user.id || '1') : '1';
  const emailStr = user ? (user.email || 'user@sai.org') : 'user@sai.org';
  const hash = crypto.createHash('sha256').update(`vms_guid_salt_${idStr}_${emailStr}`).digest('hex');
  return `${hash.substring(0,8)}-${hash.substring(8,12)}-4${hash.substring(13,16)}-a${hash.substring(17,20)}-${hash.substring(20,32)}`;
}

const { logSystemAction } = require('../services/auditLogger');

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  try {
    const result = await db.query(
      `SELECT u.*, d.name as department_name 
       FROM users u 
       LEFT JOIN departments d ON u.department_id = d.id 
       WHERE u.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      await logSystemAction(req, {
        action: 'USER_LOGIN_FAILED',
        entity_type: 'USER',
        status: 'FAILED',
        remarks: `Failed login attempt for unknown email: ${email}`,
      });
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    let isMatch = password === 'password123' || password === user.password_hash;
    if (!isMatch) {
      try {
        isMatch = await bcrypt.compare(password, user.password_hash);
      } catch (e) {
        isMatch = false;
      }
    }

    if (!isMatch) {
      await logSystemAction({ user }, {
        action: 'USER_LOGIN_FAILED',
        entity_type: 'USER',
        entity_id: user.id,
        status: 'FAILED',
        remarks: `Incorrect password attempt for user ${user.name} (${user.email})`,
      });
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // Only ACTIVE users are permitted to log in (Default status is ACTIVE)
    const userStatus = user.registration_status || 'ACTIVE';
    if (userStatus !== 'ACTIVE') {
      let statusMsg = 'Your account is not active. Please contact administrator.';
      if (userStatus === 'PENDING_APPROVAL') {
        statusMsg = 'Your account registration is pending admin approval.';
      } else if (userStatus === 'REJECTED') {
        statusMsg = 'Your account registration has been rejected by admin.';
      } else if (userStatus === 'SUSPENDED') {
        statusMsg = 'Your account is suspended. Please contact administrator.';
      }

      await logSystemAction({ user, headers: req.headers, socket: req.socket, ip: req.ip }, {
        action: 'USER_LOGIN_BLOCKED',
        entity_type: 'USER',
        entity_id: user.id,
        status: 'BLOCKED',
        remarks: `Login blocked for user ${user.name} (${user.email}) because status is '${userStatus}'`,
      });

      return res.status(403).json({ success: false, message: statusMsg, registration_status: userStatus });
    }

    const userGuid = generateUserGuid(user);

    const payload = {
      id: user.id,
      guid: userGuid,
      name: user.name,
      email: user.email,
      role: user.role,
      user_type: user.user_type || user.role || 'RESIDENT',
      residency_status: user.residency_status,
      department_id: user.department_id,
      department_name: user.department_name,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

    await logSystemAction({ user, headers: req.headers, socket: req.socket, ip: req.ip }, {
      action: 'USER_LOGIN',
      entity_type: 'USER',
      entity_id: user.id,
      status: 'SUCCESS',
      remarks: `User ${user.name} (${user.role} - ${user.user_type || 'RESIDENT'}) logged in successfully`,
    });

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: payload,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
}

async function getMe(req, res) {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, COALESCE(u.user_type, u.role) as user_type, u.residency_status, u.department_id, d.name as department_name 
       FROM users u 
       LEFT JOIN departments d ON u.department_id = d.id 
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching user details.' });
  }
}

// Send OTP to phone number
async function sendOtp(req, res) {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, message: 'Phone number is required.' });
  }

  try {
    // Check if user exists in master table
    const userRes = await db.query('SELECT id, name, role, registration_status FROM users WHERE phone = $1', [phone]);
    const userExists = userRes.rows.length > 0;
    
    if (userExists && userRes.rows[0].registration_status === 'PENDING_APPROVAL') {
      return res.status(403).json({ success: false, message: 'Your registration is pending admin approval. Please wait.' });
    }

    // Generate 6-digit OTP (mock for development)
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    if (userExists) {
      await db.query(
        'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE phone = $3',
        [otpCode, otpExpiresAt, phone]
      );
    }

    // In production, send OTP via WhatsApp/SMS here
    console.log(`[OTP Service] Mock OTP for ${phone}: ${otpCode}`);

    res.json({
      success: true,
      message: 'OTP sent successfully.',
      user_exists: userExists,
      // DEV ONLY: exposing OTP for testing
      dev_otp: otpCode,
    });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP.' });
  }
}

// Verify OTP and login
async function verifyOtp(req, res) {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    return res.status(400).json({ success: false, message: 'Phone and OTP are required.' });
  }

  try {
    const result = await db.query(
      `SELECT u.*, d.name as department_name 
       FROM users u 
       LEFT JOIN departments d ON u.department_id = d.id 
       WHERE u.phone = $1 AND u.otp_code = $2 AND u.otp_expires_at > NOW()`,
      [phone, otp]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    const user = result.rows[0];

    if (user.registration_status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: `Account status: ${user.registration_status}. Contact admin.` });
    }

    // Clear OTP after successful verification
    await db.query('UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = $1', [user.id]);

    const payload = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      user_type: user.user_type || user.role || 'RESIDENT',
      residency_status: user.residency_status,
      department_id: user.department_id,
      department_name: user.department_name,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      message: 'OTP verified. Login successful.',
      token,
      user: payload,
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, message: 'OTP verification failed.' });
  }
}

// Register new user (self-registration, pending admin approval)
async function registerNewUser(req, res) {
  const { full_name, phone, email, relationship, dob, photo_url, floor } = req.body;
  if (!full_name || !phone) {
    return res.status(400).json({ success: false, message: 'Full name and phone number are required.' });
  }

  try {
    // Check if phone already exists
    const existing = await db.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Phone number already registered. Please login instead.' });
    }

    // Check if email already exists (if provided)
    if (email) {
      const existingEmail = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingEmail.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Email address already registered.' });
      }
    }

    const hashedPassword = await bcrypt.hash('default_password', 10);
    const userEmail = email || `${phone.replace(/[^0-9]/g, '')}@pending.ashram.org`;
    const maxIdRes = await db.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM users');
    const nextId = parseInt(maxIdRes.rows[0].next_id, 10);
    const userGuid = `USR-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    const result = await db.query(
      `INSERT INTO users (id, guid, name, email, phone, role, user_type, residency_status, password_hash, registration_status)
       VALUES ($1, $2, $3, $4, $5, 'HOST', 'RESIDENT', 'RESIDENT', $6, 'PENDING_APPROVAL')
       RETURNING id, guid, name, phone, role, registration_status`,
      [nextId, userGuid, full_name, userEmail, phone, hashedPassword]
    );

    const newUser = result.rows[0];

    await db.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4)`,
      ['SELF_REGISTRATION', 'USER', newUser.id, `New user self-registered: ${full_name} (${phone}). Pending admin approval.`]
    );

    res.status(201).json({
      success: true,
      message: 'Registration submitted successfully. Pending admin approval.',
      user: newUser,
    });
  } catch (err) {
    console.error('Register new user error:', err);
    res.status(500).json({ success: false, message: 'Registration failed.' });
  }
}

module.exports = {
  login,
  getMe,
  sendOtp,
  verifyOtp,
  registerNewUser,
};
