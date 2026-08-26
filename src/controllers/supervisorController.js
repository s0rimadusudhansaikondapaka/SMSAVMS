const QRCode = require('qrcode');
const db = require('../config/db');
const { broadcastSyncEvent } = require('../sockets/syncServer');

// 1. Get Delayed Exits / Overstay Alerts
async function getOverstayAlerts(req, res) {
  try {
    const result = await db.query(
      `SELECT r.*, v.full_name as visitor_name, v.phone as visitor_phone, v.visitor_category, v.vehicle_no, u.name as host_name, u.phone as host_phone 
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       LEFT JOIN users u ON r.host_id = u.id 
       WHERE r.status = 'INSIDE_CAMPUS' AND r.valid_until < CURRENT_TIMESTAMP
       ORDER BY r.valid_until ASC`
    );
    res.json({ success: true, count: result.rows.length, overstays: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch overstay alerts.' });
  }
}

// 2. Supervisor Override / Special Spot Approval
async function supervisorOverride(req, res) {
  const { registration_id, action, remarks } = req.body; // action: APPROVE, REJECT, ESCALATE
  if (!registration_id || !action || !remarks) {
    return res.status(400).json({ success: false, message: 'Registration ID, action, and mandatory remarks required.' });
  }

  try {
    const newStatus = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'ESCALATED';

    await db.query(`UPDATE registrations SET status = $1 WHERE id = $2`, [newStatus, registration_id]);

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, `SUPERVISOR_OVERRIDE_${action}`, 'REGISTRATION', registration_id, remarks]
    );

    broadcastSyncEvent('SUPERVISOR_OVERRIDE', { registration_id, action, remarks, status: newStatus });

    res.json({ success: true, message: `Supervisor override executed: ${newStatus}`, status: newStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Supervisor override failed.' });
  }
}

// 3. Admin Bypass Approval (Super Admin override for any registration/approval level)
async function adminBypassApprove(req, res) {
  const { registration_id, remarks } = req.body;
  if (!registration_id) {
    return res.status(400).json({ success: false, message: 'Registration ID required for Admin Bypass.' });
  }

  try {
    const regRes = await db.query(
      `SELECT r.*, v.full_name as visitor_name FROM registrations r JOIN visitors v ON r.visitor_id = v.id WHERE r.id = $1`,
      [registration_id]
    );

    if (regRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Registration record not found.' });
    }

    const reg = regRes.rows[0];
    const passCode = reg.pass_code;
    const qrData = JSON.stringify({ passCode, regId: reg.id, isVvip: reg.is_vvip });
    const qrCodeUrl = await QRCode.toDataURL(qrData);

    await db.query(
      `UPDATE registrations 
       SET status = 'APPROVED', 
           accommodation_approved = true, 
           bypassed_by_admin = true, 
           qr_code_url = $1 
       WHERE id = $2`,
      [qrCodeUrl, registration_id]
    );

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'ADMIN_BYPASS_APPROVAL', 'REGISTRATION', registration_id, remarks || `Bypassed by Admin ${req.user.name}`]
    );

    broadcastSyncEvent('ADMIN_BYPASS', { registration_id, passCode, status: 'APPROVED' });

    res.json({
      success: true,
      message: 'Admin bypass executed! Pass immediately approved and QR code generated.',
      status: 'APPROVED',
      qr_code_url: qrCodeUrl,
    });
  } catch (err) {
    console.error('Admin bypass error:', err);
    res.status(500).json({ success: false, message: 'Admin bypass failed.' });
  }
}

// 4. Admin Emergency Instant Pass (Bypasses all approvals & checks)
async function adminEmergencyPass(req, res) {
  const { full_name, phone, vehicle_no, purpose } = req.body;
  if (!full_name || !phone) {
    return res.status(400).json({ success: false, message: 'Visitor name and phone required for Emergency Pass.' });
  }

  try {
    await db.query('BEGIN');

    // Create or resolve visitor
    let visitorId;
    const existing = await db.query('SELECT id FROM visitors WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      visitorId = existing.rows[0].id;
    } else {
      const newV = await db.query(
        `INSERT INTO visitors (full_name, phone, visitor_category, vehicle_no) VALUES ($1, $2, 'VIP', $3) RETURNING id`,
        [full_name, phone, vehicle_no || '']
      );
      visitorId = newV.rows[0].id;
    }

    const passCode = `EMERGENCY-${Math.floor(1000 + Math.random() * 9000)}`;
    const qrData = JSON.stringify({ passCode, isEmergency: true });
    const qrCodeUrl = await QRCode.toDataURL(qrData);

    const regRes = await db.query(
      `INSERT INTO registrations 
       (visitor_id, host_id, purpose, visit_type, stay_required, accommodation_approved, priority, status, pass_code, qr_code_url, valid_from, valid_until, is_vvip, bypassed_by_admin)
       VALUES ($1, $2, $3, 'EMERGENCY', true, true, 'P1', 'APPROVED', $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '24 hours', true, true)
       RETURNING *`,
      [visitorId, req.user.id, purpose || 'Admin Emergency Instant Pass', passCode, qrCodeUrl]
    );

    const registration = regRes.rows[0];

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'ADMIN_EMERGENCY_PASS', 'REGISTRATION', registration.id, `Emergency Instant Pass issued by Admin ${req.user.name}`]
    );

    await db.query('COMMIT');

    broadcastSyncEvent('EMERGENCY_PASS_ISSUED', { registration });

    res.status(201).json({
      success: true,
      message: 'Emergency Instant Pass created and auto-approved.',
      registration,
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Emergency pass error:', err);
    res.status(500).json({ success: false, message: 'Failed to issue emergency pass.' });
  }
}

// 5. Toggle Global System Settings
async function toggleL2Approval(req, res) {
  const { enabled, key } = req.body;
  const targetKey = key || 'L2_APPROVAL_ENABLED';
  const strVal = enabled ? 'true' : 'false';

  try {
    await db.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [targetKey, strVal]
    );

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, remarks) VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'TOGGLE_SYSTEM_SETTING', 'SYSTEM', `Global setting ${targetKey} set to ${strVal} by Admin ${req.user.name}`]
    );

    broadcastSyncEvent('SETTING_CHANGED', { key: targetKey, value: strVal });

    res.json({ success: true, message: `System setting ${targetKey} set to ${enabled}`, key: targetKey, enabled });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update system setting.' });
  }
}

// 6. Resident Absence Pre-Notification
async function registerResidentAbsence(req, res) {
  const { departure_date, expected_return_date, reason } = req.body;
  if (!departure_date || !expected_return_date) {
    return res.status(400).json({ success: false, message: 'Departure and expected return dates required.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO resident_absences (resident_id, departure_date, expected_return_date, reason) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, new Date(departure_date), new Date(expected_return_date), reason || '']
    );

    res.status(201).json({ success: true, message: 'Resident absence pre-notification saved.', absence: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to register resident absence.' });
  }
}

module.exports = {
  getOverstayAlerts,
  supervisorOverride,
  adminBypassApprove,
  adminEmergencyPass,
  toggleL2Approval,
  registerResidentAbsence,
};
