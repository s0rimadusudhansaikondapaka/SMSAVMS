const db = require('../config/db');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middlewares/auth');

/**
 * Ashram-Owned Mobile Guard Devices & Duty Management Controller
 */

// 1. Device Authentication (Login via Device ID & Secret Code)
exports.deviceAuth = async (req, res) => {
  try {
    const { device_id, secret_code } = req.body;
    if (!device_id || !secret_code) {
      return res.status(400).json({ success: false, message: 'Device ID and Secret Code are required.' });
    }

    const cleanDeviceId = device_id.trim().toUpperCase();
    const cleanSecret = secret_code.trim();

    const devRes = await db.query(
      `SELECT * FROM devices WHERE UPPER(device_id) = $1`,
      [cleanDeviceId]
    );

    if (devRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Device '${cleanDeviceId}' is not registered with Ashram Systems.` });
    }

    const device = devRes.rows[0];

    if (device.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: `Device '${cleanDeviceId}' is currently ${device.status}. Contact Super Admin.` });
    }

    if (device.secret_code !== cleanSecret) {
      return res.status(401).json({ success: false, message: 'Invalid Secret Code for this device.' });
    }

    // Update last_active_at ping
    await db.query(
      `UPDATE devices SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [device.id]
    );

    // Fetch active on-duty guards for this device (strictly deduplicated by guard_id)
    const dutyRes = await db.query(
      `SELECT DISTINCT ON (guard_id) id, device_id, guard_id, guard_name, guard_phone, guard_code, duty_date, checked_in_at, status, gate_name
       FROM device_duty_sessions
       WHERE UPPER(device_id) = UPPER($1) AND status = 'ON_DUTY'
       ORDER BY guard_id, checked_in_at DESC`,
      [device.device_id]
    );

    // Issue Device JWT Token
    const token = jwt.sign(
      {
        id: device.id,
        device_id: device.device_id,
        device_name: device.device_name,
        gate_name: device.gate_name,
        role: 'GUARD',
        is_device: true
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      success: true,
      message: `Device '${device.device_id}' authenticated successfully at ${device.gate_name}.`,
      device: {
        id: device.id,
        device_id: device.device_id,
        device_name: device.device_name,
        gate_name: device.gate_name,
        status: device.status,
        last_active_at: device.last_active_at
      },
      on_duty_guards: dutyRes.rows,
      token
    });
  } catch (err) {
    console.error('[DeviceAuth Error]:', err);
    return res.status(500).json({ success: false, message: 'Device authentication failed.' });
  }
};

// 2. Get Currently On-Duty Guards for a Device
exports.getOnDutyGuards = async (req, res) => {
  try {
    const deviceId = req.params.deviceId || req.query.device_id;
    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'Device ID is required.' });
    }

    const cleanDeviceId = deviceId.trim().toUpperCase();
    const dutyRes = await db.query(
      `SELECT DISTINCT ON (guard_id) id, device_id, guard_id, guard_name, guard_phone, guard_code, duty_date, checked_in_at, status, gate_name
       FROM device_duty_sessions
       WHERE UPPER(device_id) = $1 AND status = 'ON_DUTY'
       ORDER BY guard_id, checked_in_at DESC`,
      [cleanDeviceId]
    );

    return res.json({
      success: true,
      device_id: cleanDeviceId,
      on_duty_guards: dutyRes.rows
    });
  } catch (err) {
    console.error('[GetOnDutyGuards Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve on-duty guards.' });
  }
};

// 3. Put Guard On Duty (Check-in to Device)
exports.dutyCheckIn = async (req, res) => {
  try {
    const { device_id, guard_id } = req.body;
    if (!device_id || !guard_id) {
      return res.status(400).json({ success: false, message: 'device_id and guard_id are required.' });
    }

    const cleanDeviceId = device_id.trim().toUpperCase();

    // Verify Device
    const devRes = await db.query(`SELECT * FROM devices WHERE UPPER(device_id) = $1`, [cleanDeviceId]);
    if (devRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }
    const device = devRes.rows[0];

    // Verify Guard
    const guardRes = await db.query(
      `SELECT id, guid, name, phone, role FROM users WHERE id = $1 AND role IN ('GUARD', 'SUPERVISOR', 'SECURITY_HEAD')`,
      [guard_id]
    );
    if (guardRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Guard not found or not eligible for gate duty.' });
    }
    const guard = guardRes.rows[0];

    // Check if guard is already on duty on this device
    const existing = await db.query(
      `SELECT id FROM device_duty_sessions WHERE UPPER(device_id) = $1 AND guard_id = $2 AND status = 'ON_DUTY'`,
      [cleanDeviceId, guard.id]
    );

    if (existing.rows.length > 0) {
      const allActive = await db.query(
        `SELECT DISTINCT ON (guard_id) id, device_id, guard_id, guard_name, guard_phone, guard_code, duty_date, checked_in_at, status, gate_name
         FROM device_duty_sessions WHERE UPPER(device_id) = $1 AND status = 'ON_DUTY' ORDER BY guard_id, checked_in_at DESC`,
        [cleanDeviceId]
      );
      return res.json({
        success: true,
        message: `${guard.name} is already on duty on ${cleanDeviceId}.`,
        on_duty_guards: allActive.rows
      });
    }

    // Close any previous session for this guard before creating new session
    await db.query(
      `UPDATE device_duty_sessions SET status = 'OFF_DUTY', checked_out_at = CURRENT_TIMESTAMP WHERE UPPER(device_id) = $1 AND guard_id = $2 AND status = 'ON_DUTY'`,
      [cleanDeviceId, guard.id]
    );

    // Insert new duty session
    await db.query(
      `INSERT INTO device_duty_sessions (device_id, guard_id, guard_name, guard_phone, guard_code, duty_date, checked_in_at, status, gate_name)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, CURRENT_TIMESTAMP, 'ON_DUTY', $6)`,
      [device.device_id, guard.id, guard.name, guard.phone, guard.guid || `GRD-${guard.id}`, device.gate_name]
    );

    // Return updated active roster
    const allActive = await db.query(
      `SELECT DISTINCT ON (guard_id) id, device_id, guard_id, guard_name, guard_phone, guard_code, duty_date, checked_in_at, status, gate_name
       FROM device_duty_sessions WHERE UPPER(device_id) = $1 AND status = 'ON_DUTY' ORDER BY guard_id, checked_in_at DESC`,
      [cleanDeviceId]
    );

    return res.json({
      success: true,
      message: `${guard.name} is now checked-in ON DUTY for ${cleanDeviceId} (${device.gate_name}).`,
      on_duty_guards: allActive.rows
    });
  } catch (err) {
    console.error('[DutyCheckIn Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to put guard on duty.' });
  }
};

// 4. Relieve Guard from Duty (Check-out from Device)
exports.dutyCheckOut = async (req, res) => {
  try {
    const { device_id, guard_id, session_id } = req.body;
    if (!device_id && !session_id) {
      return res.status(400).json({ success: false, message: 'device_id and guard_id (or session_id) are required.' });
    }

    let cleanDeviceId = device_id ? device_id.trim().toUpperCase() : null;

    if (session_id) {
      const sessRes = await db.query(
        `UPDATE device_duty_sessions
         SET status = 'OFF_DUTY', checked_out_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING device_id, guard_name`,
        [session_id]
      );
      if (sessRes.rows.length > 0) {
        cleanDeviceId = sessRes.rows[0].device_id;
      }
    } else if (cleanDeviceId && guard_id) {
      await db.query(
        `UPDATE device_duty_sessions
         SET status = 'OFF_DUTY', checked_out_at = CURRENT_TIMESTAMP
         WHERE UPPER(device_id) = $1 AND guard_id = $2 AND status = 'ON_DUTY'`,
        [cleanDeviceId, guard_id]
      );
    }

    const allActive = await db.query(
      `SELECT DISTINCT ON (guard_id) id, device_id, guard_id, guard_name, guard_phone, guard_code, duty_date, checked_in_at, status, gate_name
       FROM device_duty_sessions WHERE UPPER(device_id) = $1 AND status = 'ON_DUTY' ORDER BY guard_id, checked_in_at DESC`,
      [cleanDeviceId]
    );

    return res.json({
      success: true,
      message: 'Guard marked OFF DUTY successfully.',
      on_duty_guards: allActive.rows
    });
  } catch (err) {
    console.error('[DutyCheckOut Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to check out guard.' });
  }
};

// 5. Search Guards by Name, Code, or Phone Suffix (4 to 10 digits)
exports.searchGuards = async (req, res) => {
  try {
    const query = req.query.q ? req.query.q.trim() : '';

    if (!query) {
      // Return recent / top guards
      const defaultGuards = await db.query(
        `SELECT id, guid, name, email, phone, role, user_type, flat_info
         FROM users
         WHERE role IN ('GUARD', 'SUPERVISOR', 'SECURITY_HEAD')
         ORDER BY name ASC LIMIT 15`
      );
      return res.json({ success: true, guards: defaultGuards.rows });
    }

    // Extract digits for flexible phone suffix matching (e.g. last 4, 5, 6... 10 digits)
    const digitsOnly = query.replace(/\D/g, '');
    const hasDigits = digitsOnly.length >= 3;

    let sql = `
      SELECT id, guid, name, email, phone, role, user_type, flat_info
      FROM users
      WHERE role IN ('GUARD', 'SUPERVISOR', 'SECURITY_HEAD')
        AND (
          name ILIKE $1
          OR guid ILIKE $1
          OR email ILIKE $1
    `;
    const params = [`%${query}%`];

    if (hasDigits) {
      // Matches phone number ending with the entered digits (last 4, 5, 6... digits)
      params.push(`%${digitsOnly}`);
      sql += ` OR REPLACE(REPLACE(phone, ' ', ''), '-', '') LIKE $2`;
    }

    sql += `) ORDER BY name ASC LIMIT 20`;

    const result = await db.query(sql, params);
    return res.json({ success: true, guards: result.rows });
  } catch (err) {
    console.error('[SearchGuards Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to search guards.' });
  }
};

// 6. Super Admin: List All Ashram Devices
exports.getAdminDevices = async (req, res) => {
  try {
    const query = `
      SELECT d.*,
        (SELECT json_agg(json_build_object('id', s.id, 'guard_id', s.guard_id, 'guard_name', s.guard_name, 'guard_phone', s.guard_phone, 'checked_in_at', s.checked_in_at))
         FROM device_duty_sessions s
         WHERE UPPER(s.device_id) = UPPER(d.device_id) AND s.status = 'ON_DUTY') as active_guards
      FROM devices d
      ORDER BY d.device_id ASC
    `;
    const result = await db.query(query);
    return res.json({ success: true, devices: result.rows });
  } catch (err) {
    console.error('[GetAdminDevices Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve devices.' });
  }
};

// 7. Super Admin: Create New Ashram Device
exports.createAdminDevice = async (req, res) => {
  try {
    const { device_id, device_name, gate_name, secret_code } = req.body;
    if (!device_id || !gate_name || !secret_code) {
      return res.status(400).json({ success: false, message: 'device_id, gate_name, and secret_code are required.' });
    }

    const cleanDeviceId = device_id.trim().toUpperCase();

    // Check duplicate
    const check = await db.query(`SELECT id FROM devices WHERE UPPER(device_id) = $1`, [cleanDeviceId]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, message: `Device ID '${cleanDeviceId}' already exists.` });
    }

    const insertRes = await db.query(
      `INSERT INTO devices (device_id, device_name, gate_name, secret_code, status, last_active_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP)
       RETURNING *`,
      [cleanDeviceId, device_name || `${gate_name} Device`, gate_name, secret_code.trim()]
    );

    return res.json({ success: true, message: `Device '${cleanDeviceId}' registered successfully.`, device: insertRes.rows[0] });
  } catch (err) {
    console.error('[CreateAdminDevice Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to create device.' });
  }
};

// 8. Super Admin: Update Device (Reassign Gate, Edit Secret, Status)
exports.updateAdminDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const { device_name, gate_name, secret_code, status } = req.body;

    const devRes = await db.query(`SELECT * FROM devices WHERE id = $1`, [id]);
    if (devRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }
    const current = devRes.rows[0];

    const updated = await db.query(
      `UPDATE devices
       SET device_name = COALESCE($1, device_name),
           gate_name = COALESCE($2, gate_name),
           secret_code = COALESCE($3, secret_code),
           status = COALESCE($4, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [device_name, gate_name, secret_code ? secret_code.trim() : null, status, id]
    );

    return res.json({ success: true, message: 'Device updated successfully.', device: updated.rows[0] });
  } catch (err) {
    console.error('[UpdateAdminDevice Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to update device.' });
  }
};

// 9. Super Admin: Date-wise & Device-wise Guard Duty Connection Audit
exports.getDeviceDutyAudit = async (req, res) => {
  try {
    const { date, from_date, to_date, device_id, gate_name } = req.query;

    let sql = `
      SELECT s.id, s.device_id, s.guard_id, s.guard_name, s.guard_phone, s.guard_code,
             s.duty_date, s.checked_in_at, s.checked_out_at, s.status, s.gate_name,
             ROUND(EXTRACT(EPOCH FROM (COALESCE(s.checked_out_at, CURRENT_TIMESTAMP) - s.checked_in_at)) / 60) as duration_minutes
      FROM device_duty_sessions s
      WHERE 1=1
    `;
    const params = [];
    let pIdx = 1;

    if (date) {
      sql += ` AND s.duty_date = $${pIdx}`;
      params.push(date);
      pIdx++;
    } else if (from_date && to_date) {
      sql += ` AND s.duty_date >= $${pIdx} AND s.duty_date <= $${pIdx + 1}`;
      params.push(from_date, to_date);
      pIdx += 2;
    }

    if (device_id) {
      sql += ` AND UPPER(s.device_id) = $${pIdx}`;
      params.push(device_id.trim().toUpperCase());
      pIdx++;
    }

    if (gate_name) {
      sql += ` AND UPPER(s.gate_name) = $${pIdx}`;
      params.push(gate_name.trim().toUpperCase());
      pIdx++;
    }

    sql += ` ORDER BY s.checked_in_at DESC LIMIT 300`;

    const result = await db.query(sql, params);
    return res.json({ success: true, audit_logs: result.rows });
  } catch (err) {
    console.error('[GetDeviceDutyAudit Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve device duty audit.' });
  }
};
