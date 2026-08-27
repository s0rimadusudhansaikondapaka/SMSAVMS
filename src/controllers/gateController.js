const db = require('../config/db');
const { broadcastSyncEvent } = require('../sockets/syncServer');

// 1. Lookup Registration by Passcode, QR Code Hash, Phone Number, or Vehicle No
async function verifyGatePass(req, res) {
  const { query } = req.query; // passcode, qr content, phone number, or vehicle_no
  if (!query) {
    return res.status(400).json({ success: false, message: 'Search parameter required.' });
  }

  let cleanQuery = query.trim();

  // Parse scanned QR content if JSON payload e.g. {"passCode":"PASS-1001", ...}
  if (cleanQuery.startsWith('{') && cleanQuery.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleanQuery);
      if (parsed.passCode || parsed.pass_code) {
        cleanQuery = (parsed.passCode || parsed.pass_code).trim();
      }
    } catch (e) {
      // Ignore JSON parse error and proceed with raw string
    }
  }

  // Parse scanned QR content if URL link e.g. http://localhost:3000/?pass=PASS-1001 or /pass/PASS-1001
  if (cleanQuery.includes('pass=')) {
    const match = cleanQuery.match(/pass=([A-Za-z0-9_-]+)/);
    if (match) cleanQuery = match[1];
  } else if (cleanQuery.includes('/pass/')) {
    const match = cleanQuery.match(/\/pass\/([A-Za-z0-9_-]+)/);
    if (match) cleanQuery = match[1];
  }

  try {
    // Allows searching by Passcode, Phone Number (for delivery boys/frequent visitors), Vehicle No, or Registration ID
    const result = await db.query(
      `SELECT r.*, 
              v.full_name as visitor_name, v.phone as visitor_phone, v.email as visitor_email, v.gender as visitor_gender,
              v.photo_url, v.id_type, v.id_number, v.id_card_number, v.id_card_image_url, v.visitor_category, v.is_frequent_visitor, v.has_smartphone,
              u.name as host_name, u.phone as host_phone
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       LEFT JOIN users u ON r.host_id = u.id 
       WHERE r.pass_code = $1 OR v.vehicle_no = $1 OR v.phone = $1 OR CAST(r.id AS TEXT) = $1
       ORDER BY r.created_at DESC LIMIT 1`,
      [cleanQuery]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No matching gate pass found for query: ' + cleanQuery });
    }

    const reg = result.rows[0];

    // Fetch multiple vehicles associated with this registration pass
    const vehRes = await db.query(
      `SELECT * FROM registration_vehicles WHERE registration_id = $1`,
      [reg.id]
    );
    reg.vehicles = vehRes.rows;

    // Privacy Masking: Mask host phone for standard guards
    const maskedHostPhone = reg.host_phone ? reg.host_phone.replace(/(\+\d{2}\s?\d{2})\d{4}(\d{4})/, '$1****$2') : '';

    res.json({
      success: true,
      pass: {
        ...reg,
        host_phone_masked: maskedHostPhone,
      },
    });
  } catch (err) {
    console.error('Error verifying gate pass:', err);
    res.status(500).json({ success: false, message: 'Gate pass lookup failed.' });
  }
}

// 2. Gate Check-in (IN) or Check-out (OUT)
async function processGateMovement(req, res) {
  const { registration_id, gate_name, direction, adult_men_count, adult_women_count, children_count, vehicle_no, remarks } = req.body;

  if (!registration_id || !gate_name || !direction) {
    return res.status(400).json({ success: false, message: 'Registration ID, gate name, and direction required.' });
  }

  if (!['NORTH_GATE', 'EAST_GATE', 'WEST_GATE', 'SOUTH_GATE'].includes(gate_name)) {
    return res.status(400).json({ success: false, message: 'Invalid gate name.' });
  }

  if (gate_name === 'SOUTH_GATE' && req.user.role !== 'SECURITY_HEAD' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'South Gate access requires Security Head authorization.' });
  }

  try {
    await db.query('BEGIN');

    const regRes = await db.query(
      `SELECT r.*, v.full_name as visitor_name 
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       WHERE r.id = $1`,
      [registration_id]
    );

    if (regRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Registration record not found.' });
    }

    const reg = regRes.rows[0];

    if (!reg.is_vvip && !reg.bypassed_by_admin && direction === 'IN' && reg.status !== 'APPROVED') {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Cannot process IN entry. Pass status is ${reg.status}` });
    }

    // Entry Window Validation: ±N hours from scheduled arrival (configurable via Super Admin)
    if (direction === 'IN' && reg.valid_from && !reg.is_permanent_pass) {
      let windowHours = 8;
      try {
        const settingRes = await db.query("SELECT value FROM system_settings WHERE key = 'ENTRY_WINDOW_HOURS'");
        if (settingRes.rows.length > 0) windowHours = parseInt(settingRes.rows[0].value) || 8;
      } catch (e) {
        windowHours = 8;
      }

      const now = new Date();
      const validFrom = new Date(reg.valid_from);
      const windowStart = new Date(validFrom.getTime() - windowHours * 60 * 60 * 1000);
      const windowEnd = new Date(validFrom.getTime() + windowHours * 60 * 60 * 1000);
      if (now < windowStart || now > windowEnd) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Entry not allowed. Visitor's acceptable entry window is ±${windowHours} hours from scheduled arrival time (${validFrom.toLocaleString()}). Allowed window: ${windowStart.toLocaleString()} to ${windowEnd.toLocaleString()}.`,
        });
      }
    }

    const menCount = adult_men_count !== undefined ? parseInt(adult_men_count) : reg.adult_men_count;
    const womenCount = adult_women_count !== undefined ? parseInt(adult_women_count) : reg.adult_women_count;
    const boysCount = req.body.boys_count !== undefined ? parseInt(req.body.boys_count) : (reg.boys_count || 0);
    const girlsCount = req.body.girls_count !== undefined ? parseInt(req.body.girls_count) : (reg.girls_count || 0);
    const kidsCount = children_count !== undefined ? parseInt(children_count) : (boysCount + girlsCount);
    const totalCount = menCount + womenCount + boysCount + girlsCount;

    // Insert Gate Log
    const logRes = await db.query(
      `INSERT INTO gate_logs (registration_id, visitor_id, gate_name, direction, person_count, adult_men_count, adult_women_count, children_count, boys_count, girls_count, vehicle_no, recorded_by_guard_id, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [registration_id, reg.visitor_id, gate_name, direction, totalCount, menCount, womenCount, kidsCount, boysCount, girlsCount, vehicle_no || '', req.user.id, remarks || '']
    );

    // PPTX Requirement: Permanent Passcodes for Maids/Frequent Visitors reset to APPROVED upon exit for repeated daily entry!
    let newStatus = direction === 'IN' ? 'INSIDE_CAMPUS' : 'CHECKED_OUT';
    if (direction === 'OUT' && reg.is_permanent_pass) {
      newStatus = 'APPROVED'; // Resets to APPROVED so permanent passcode works every day!
    }

    await db.query(
      `UPDATE registrations SET status = $1, adult_men_count = $2, adult_women_count = $3, children_count = $4, boys_count = $5, girls_count = $6, person_count = $7 WHERE id = $8`,
      [newStatus, menCount, womenCount, kidsCount, boysCount, girlsCount, totalCount, registration_id]
    );

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, `GATE_${direction}`, 'REGISTRATION', registration_id, `Gate ${direction} at ${gate_name}. Men: ${menCount}, Women: ${womenCount}, Children: ${kidsCount} (Permanent Pass: ${reg.is_permanent_pass})`]
    );

    await db.query('COMMIT');

    broadcastSyncEvent('GATE_MOVEMENT', {
      gate_name,
      direction,
      registration_id,
      visitor_name: reg.visitor_name,
      pass_code: reg.pass_code,
      host_id: reg.host_id,
      total_count: totalCount,
      adult_men_count: menCount,
      adult_women_count: womenCount,
      children_count: kidsCount,
      status: newStatus,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: `Visitor successfully checked ${direction} at ${gate_name}${reg.is_permanent_pass ? ' (Permanent Passcode Reset to APPROVED for Next Entry)' : ''}`,
      status: newStatus,
      gate_log: logRes.rows[0],
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error processing gate movement:', err);
    res.status(500).json({ success: false, message: 'Server error processing gate movement.' });
  }
}

// 3. Get Active Visitors Currently Inside Campus
async function getVisitorsInsideCampus(req, res) {
  try {
    const result = await db.query(
      `SELECT r.*, v.full_name as visitor_name, v.phone as visitor_phone, v.photo_url, v.visitor_category, u.name as host_name 
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       LEFT JOIN users u ON r.host_id = u.id 
       WHERE r.status = 'INSIDE_CAMPUS' 
       ORDER BY r.created_at DESC`
    );
    res.json({ success: true, count: result.rows.length, visitors: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch campus visitors.' });
  }
}

// 4. Get Gate Spot Registrations Queue (Submitted at Gate)
async function getSpotRegistrationsQueue(req, res) {
  try {
    const result = await db.query(
      `SELECT r.*, 
              v.full_name as visitor_name, v.phone as visitor_phone, v.email as visitor_email, v.gender as visitor_gender,
              v.photo_url, v.id_type, v.id_number, v.id_card_number, v.id_card_image_url, v.visitor_category,
              u.name as host_name, u.phone as host_phone, u.department
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       LEFT JOIN users u ON r.host_id = u.id 
       WHERE r.registration_type IN ('SPOT_REGISTRATION', 'SPOT_UNFAMILIAR') 
         AND r.status IN ('PENDING_L1', 'PENDING_L2', 'REJECTED', 'APPROVED', 'INSIDE_CAMPUS')
       ORDER BY r.created_at DESC LIMIT 50`
    );
    res.json({ success: true, count: result.rows.length, spot_requests: result.rows });
  } catch (err) {
    console.error('Error fetching spot registrations queue:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch spot registrations queue.' });
  }
}

// 5. Guard Assigns Resident / Employee / PRO to Spot Registration
async function assignHostToSpotRegistration(req, res) {
  const { registration_id, host_id, remarks } = req.body;
  if (!registration_id || !host_id) {
    return res.status(400).json({ success: false, message: 'Registration ID and Host ID are required.' });
  }

  try {
    await db.query('BEGIN');
    
    const hostRes = await db.query('SELECT name, department, role FROM users WHERE id = $1', [host_id]);
    if (hostRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Assigned Host/PRO not found.' });
    }
    const host = hostRes.rows[0];

    const regRes = await db.query(
      `UPDATE registrations 
       SET host_id = $1, status = 'PENDING_L1' 
       WHERE id = $2 
       RETURNING *`,
      [host_id, registration_id]
    );

    if (regRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Spot registration not found.' });
    }

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'ASSIGN_SPOT_HOST', 'REGISTRATION', registration_id, `Guard assigned host ${host.name} (${host.department}) to spot registration #${registration_id}. ${remarks || ''}`]
    );

    await db.query('COMMIT');

    broadcastSyncEvent('SPOT_HOST_ASSIGNED', {
      registration_id,
      host_id,
      host_name: host.name,
      status: 'PENDING_L1',
    });

    res.json({
      success: true,
      message: `Assigned host ${host.name} to spot registration. Approval notification sent to host!`,
      registration: regRes.rows[0],
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error assigning host to spot registration:', err);
    res.status(500).json({ success: false, message: 'Failed to assign host to spot registration.' });
  }
}

module.exports = {
  verifyGatePass,
  processGateMovement,
  getVisitorsInsideCampus,
  getSpotRegistrationsQueue,
  assignHostToSpotRegistration,
};
