const db = require('../config/db');
const { broadcastSyncEvent } = require('../sockets/syncServer');
const { logSystemAction } = require('../services/auditLogger');

function isPermanentPass(reg) {
  if (!reg) return false;
  if (reg.is_permanent_pass === true) return true;
  const pCode = String(reg.pass_code || '').toUpperCase();
  if (pCode.startsWith('MAID-PERM') || pCode.startsWith('DEVOTEE-PERM') || pCode.startsWith('FAM-PERM') || pCode.startsWith('HOST-') || pCode.startsWith('PERM-')) {
    return true;
  }
  const category = String(reg.visitor_category || '').toUpperCase();
  if (['MAID', 'CARETAKER', 'DEVOTEE', 'FREQUENT_VISITOR', 'FAMILY_MEMBER'].includes(category)) {
    return true;
  }
  return false;
}

// 1. Lookup Registration by Passcode, QR Code Hash, Phone Number, or Vehicle No
async function verifyGatePass(req, res) {
  const { query } = req.query; // passcode, qr content, phone number, or vehicle_no
  if (!query) {
    return res.status(400).json({ success: false, message: 'Search parameter required.' });
  }

  let cleanQuery = query.trim().replace(/^["']|["']$/g, '');

  // Parse scanned QR content if JSON payload e.g. {"passCode":"PASS-1001", ...}
  if (cleanQuery.includes('passCode') || cleanQuery.includes('pass_code')) {
    const jsonMatch = cleanQuery.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.passCode || parsed.pass_code) {
          cleanQuery = String(parsed.passCode || parsed.pass_code).trim();
        }
      } catch (e) {
        // Ignore JSON parse error and proceed
      }
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
              v.photo_url, v.id_type, v.id_number, v.id_card_number, v.id_card_image_url, v.visitor_category, v.company_name, v.is_frequent_visitor, v.has_smartphone,
              u.name as host_name, u.phone as host_phone, u.flat_info as host_flat_info, u.role as host_role,
              rfm.relationship as family_relationship
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       LEFT JOIN users u ON r.host_id = u.id 
       LEFT JOIN resident_family_members rfm ON r.family_member_id = rfm.id
       LEFT JOIN registration_vehicles rv ON rv.registration_id = r.id
       WHERE LOWER(r.pass_code) = LOWER($1) 
          OR LOWER(COALESCE(r.guid, '')) = LOWER($1) 
          OR LOWER(COALESCE(v.vehicle_no, '')) = LOWER($1) 
          OR LOWER(COALESCE(rv.plate_number, '')) = LOWER($1)
          OR v.phone = $1 
          OR CAST(r.id AS TEXT) = $1
       ORDER BY r.created_at DESC LIMIT 1`,
      [cleanQuery]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No matching gate pass found for query: ' + cleanQuery });
    }

    const reg = result.rows[0];

    let auditApproverName = null;
    let auditApproverRole = null;
    try {
      const appLog = await db.query(
        `SELECT u.name, u.role FROM audit_logs al JOIN users u ON al.actor_id = u.id WHERE al.entity_id = $1 AND (al.action LIKE '%APPROVE%' OR al.action LIKE '%CREATE%') ORDER BY al.id DESC LIMIT 1`,
        [reg.id]
      );
      if (appLog.rows.length > 0) {
        auditApproverName = appLog.rows[0].name;
        auditApproverRole = appLog.rows[0].role;
      }
    } catch (e) {}

    reg.approved_by_display = reg.approved_by_name 
      ? `${reg.approved_by_name} (${reg.approved_by_role || 'Approver'})` 
      : auditApproverName 
      ? `${auditApproverName} (${auditApproverRole || 'Approver'})` 
      : reg.bypassed_by_admin 
      ? 'Super Admin (Direct Auto-Approve)' 
      : reg.host_name 
      ? `${reg.host_name} (Host Pre-Approval)` 
      : 'System Approved';

    // Fetch multiple vehicles associated with this registration pass
    const vehRes = await db.query(
      `SELECT * FROM registration_vehicles WHERE registration_id = $1`,
      [reg.id]
    );
    reg.vehicles = vehRes.rows;

    // Fetch detailed Gate Movement Logs (Which guard allowed, members present, ID & address proof confirmation)
    const logsRes = await db.query(
      `SELECT gl.*, 
              u.name as guard_name, u.role as guard_role
       FROM gate_logs gl
       LEFT JOIN users u ON gl.recorded_by_guard_id = u.id
       WHERE gl.registration_id = $1
       ORDER BY gl.id DESC`,
      [reg.id]
    );
    reg.gate_movement_logs = logsRes.rows;

    // Gatewise Visitor Category Permission Check
    const visitorCategory = (reg.visitor_category || 'GENERAL').toUpperCase();
    const rulesRes = await db.query(
      `SELECT gate_name, is_allowed FROM gate_category_rules WHERE visitor_category = $1`,
      [visitorCategory]
    );

    const allGates = ['NORTH_GATE', 'SOUTH_GATE', 'EAST_GATE', 'WEST_GATE', 'STAFF_GATE'];
    let allowedGates = [];
    if (rulesRes.rows.length === 0) {
      allowedGates = [...allGates];
    } else {
      allowedGates = rulesRes.rows.filter((r) => r.is_allowed).map((r) => r.gate_name);
    }

    const currentGate = (req.query.gateName || 'NORTH_GATE').toUpperCase();
    const isCurrentGateAllowed = allowedGates.includes(currentGate);

    // Privacy Masking: Mask host phone for standard guards
    const maskedHostPhone = reg.host_phone ? reg.host_phone.replace(/(\+\d{2}\s?\d{2})\d{4}(\d{4})/, '$1****$2') : '';

    // 8-Hour Time Window Grace Period Calculation (Permanent passes are valid 24/7 unlimited)
    const isPerm = isPermanentPass(reg);
    const graceHours = await getGraceHoursWindow();
    const now = new Date();
    const validFrom = new Date(reg.valid_from);
    const validUntil = new Date(reg.valid_until);

    const windowStart = new Date(validFrom.getTime() - graceHours * 60 * 60 * 1000);
    const windowEnd = new Date(validUntil.getTime() + graceHours * 60 * 60 * 1000);

    let arrivalStatus = 'VALID_FOR_ENTRY';
    let arrivalMessage = isPerm
      ? 'Permanent Multi-Entry Passcard - Valid 24/7 for unlimited entry & exit'
      : `Pass valid for entry (Allowed from ${graceHours}h before arrival until ${graceHours}h after departure)`;

    if (!isPerm) {
      if (now < windowStart) {
        arrivalStatus = 'TOO_EARLY';
        arrivalMessage = `⛔ Pass Arrival Window Not Open. Earliest entry allowed: ${windowStart.toLocaleString()}`;
      } else if (now > windowEnd && reg.status !== 'INSIDE_CAMPUS' && reg.status !== 'CHECKED_OUT') {
        arrivalStatus = 'ARRIVAL_EXPIRED';
        arrivalMessage = `⚠️ Pass Arrival Window Expired (Window ended: ${windowEnd.toLocaleString()})`;
      }
    }

    let egressStatus = 'NORMAL_EXIT';
    if (!isPerm && reg.status === 'INSIDE_CAMPUS' && now > windowEnd) {
      egressStatus = 'OVERSTAY';
    }

    res.json({
      success: true,
      pass: {
        ...reg,
        host_phone_masked: maskedHostPhone,
        allowed_gates: allowedGates,
        restricted_gates: allGates.filter((g) => !allowedGates.includes(g)),
        is_current_gate_allowed: isCurrentGateAllowed,
        current_gate_checked: currentGate,
        grace_hours: graceHours,
        earliest_allowed_entry: windowStart.toISOString(),
        latest_allowed_entry: windowEnd.toISOString(),
        overstay_threshold: windowEnd.toISOString(),
        arrival_status: arrivalStatus,
        arrival_message: arrivalMessage,
        egress_status: egressStatus,
      },
    });
  } catch (err) {
    console.error('Error verifying gate pass:', err);
    res.status(500).json({ success: false, message: 'Gate pass lookup failed.' });
  }
}

// Helper to get time window grace hours setting (default 8 hours)
async function getGraceHoursWindow() {
  try {
    const res = await db.query("SELECT value FROM system_settings WHERE key = 'PASS_TIME_WINDOW_GRACE_HOURS'");
    return res.rows.length > 0 ? parseFloat(res.rows[0].value) || 8 : 8;
  } catch (err) {
    return 8;
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
    // Enforce Super Admin Configured Gate Direction Mode (BOTH, IN_ONLY, OUT_ONLY, CLOSED)
    const dirRes = await db.query(
      `SELECT direction_mode FROM gate_direction_config WHERE gate_name = $1 AND is_active = true`,
      [gate_name]
    );
    const dirMode = dirRes.rows.length > 0 ? dirRes.rows[0].direction_mode : 'BOTH';

    if (dirMode === 'CLOSED') {
      return res.status(403).json({ success: false, message: `Gate '${gate_name}' is currently CLOSED by Super Admin.` });
    }
    if (dirMode === 'IN_ONLY' && direction === 'OUT') {
      return res.status(403).json({ success: false, message: `Gate '${gate_name}' is configured for INGRESS ONLY (Entry). Outbound movement is disabled.` });
    }
    if (dirMode === 'OUT_ONLY' && direction === 'IN') {
      return res.status(403).json({ success: false, message: `Gate '${gate_name}' is configured for EGRESS ONLY (Exit). Inbound movement is disabled.` });
    }

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

    const isPerm = isPermanentPass(reg);
    const graceHours = await getGraceHoursWindow();
    const now = new Date();
    const validFrom = new Date(reg.valid_from);
    const validUntil = new Date(reg.valid_until);
    const windowStart = new Date(validFrom.getTime() - graceHours * 60 * 60 * 1000);
    const windowEnd = new Date(validUntil.getTime() + graceHours * 60 * 60 * 1000);

    if (direction === 'IN') {
      if (!isPerm && reg.status !== 'APPROVED' && reg.status !== 'CHECKED_OUT' && reg.status !== 'INSIDE_CAMPUS' && !reg.is_vvip && !reg.bypassed_by_admin) {
        await db.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `Cannot process IN entry. Pass status is ${reg.status}` });
      }

      // Check if current time is within allowed entry to departure end window for non-permanent passes
      if (!isPerm && (now < windowStart || now > windowEnd)) {
        const isAuthorizedGuard = ['GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN', 'HOD'].includes(req.user?.role);
        if (!req.body.override_expired && !isAuthorizedGuard) {
          await db.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Entry window expired. Re-entry allowed until departure window end (${windowEnd.toLocaleString()}).`,
          });
        }
      }
    }

    const menCount = adult_men_count !== undefined ? parseInt(adult_men_count) : reg.adult_men_count;
    const womenCount = adult_women_count !== undefined ? parseInt(adult_women_count) : reg.adult_women_count;
    const boysCount = req.body.boys_count !== undefined ? parseInt(req.body.boys_count) : (reg.boys_count || 0);
    const girlsCount = req.body.girls_count !== undefined ? parseInt(req.body.girls_count) : (reg.girls_count || 0);
    const kidsCount = children_count !== undefined ? parseInt(children_count) : (boysCount + girlsCount);
    const totalCount = menCount + womenCount + boysCount + girlsCount;

    const maxIdRes = await db.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM gate_logs');
    const nextLogId = parseInt(maxIdRes.rows[0].next_id, 10);
    const gateLogGuid = `GLOG-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    // Insert Gate Log
    const logRes = await db.query(
      `INSERT INTO gate_logs (id, guid, registration_id, visitor_id, gate_name, direction, person_count, adult_men_count, adult_women_count, children_count, boys_count, girls_count, vehicle_no, recorded_by_guard_id, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [nextLogId, gateLogGuid, registration_id, reg.visitor_id, gate_name, direction, totalCount, menCount, womenCount, kidsCount, boysCount, girlsCount, vehicle_no || '', req.user.id, remarks || '']
    );

    // Permanent Passcodes for Maids/Frequent Visitors reset to APPROVED upon exit for repeated daily entry!
    let newStatus = direction === 'IN' ? 'INSIDE_CAMPUS' : 'CHECKED_OUT';
    if (direction === 'OUT' && isPerm) {
      newStatus = 'APPROVED'; // Resets to APPROVED so permanent passcode works every day!
    }

    await db.query(
      `UPDATE registrations SET status = $1, adult_men_count = $2, adult_women_count = $3, children_count = $4, boys_count = $5, girls_count = $6, person_count = $7 WHERE id = $8`,
      [newStatus, menCount, womenCount, kidsCount, boysCount, girlsCount, totalCount, registration_id]
    );

    await logSystemAction(req, {
      action: `GATE_${direction}`,
      entity_type: 'REGISTRATION',
      entity_id: registration_id,
      status: 'SUCCESS',
      remarks: `Gate ${direction} recorded at ${gate_name} for ${reg.visitor_name} (Pass: ${reg.pass_code}). Breakdown - Men: ${menCount}, Women: ${womenCount}, Children: ${kidsCount}`
    });

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
              u.name as host_name, u.phone as host_phone, d.name as department
       FROM registrations r 
       JOIN visitors v ON r.visitor_id = v.id 
       LEFT JOIN users u ON r.host_id = u.id 
       LEFT JOIN departments d ON u.department_id = d.id
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
    
    const hostRes = await db.query('SELECT name, flat_info, role FROM users WHERE id = $1', [host_id]);
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

    const reg = regRes.rows[0];

    // Fetch visitor details
    const vRes = await db.query('SELECT full_name FROM visitors WHERE id = $1', [reg.visitor_id]);
    const visitorName = vRes.rows.length > 0 ? vRes.rows[0].full_name : 'Visitor';

    await logSystemAction(req, {
      action: 'ASSIGN_SPOT_HOST',
      entity_type: 'REGISTRATION',
      entity_id: registration_id,
      remarks: `Guard assigned host ${host.name} to spot registration #${registration_id}. ${remarks || ''}`,
    });

    await db.query('COMMIT');

    broadcastSyncEvent('SPOT_HOST_ASSIGNED', {
      registration_id,
      host_id,
      host_name: host.name,
      visitor_name: visitorName,
      pass_code: reg.pass_code,
      status: 'PENDING_L1',
      assigned_by_guard: req.user.name,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: `Assigned ${host.name} (${host.role === 'PRO' ? 'PRO' : 'Host'}) to spot registration. Approval notification sent!`,
      registration: reg,
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error assigning host to spot registration:', err);
    res.status(500).json({ success: false, message: 'Failed to assign host to spot registration.' });
  }
}

// Get Top 20 Recent Gate Lookups / Verified Passes
async function getRecentGateLookups(req, res) {
  try {
    const result = await db.query(
      `SELECT r.id, r.pass_code, r.status, v.visitor_category, r.created_at,
              v.full_name as visitor_name, v.phone as visitor_phone, v.vehicle_no,
              COALESCE(gl.timestamp, r.created_at) as last_activity
       FROM registrations r
       JOIN visitors v ON r.visitor_id = v.id
       LEFT JOIN (
         SELECT registration_id, MAX(timestamp) as timestamp 
         FROM gate_logs 
         GROUP BY registration_id
       ) gl ON gl.registration_id = r.id
       ORDER BY last_activity DESC
       LIMIT 20`
    );
    res.json({ success: true, recent_passes: result.rows });
  } catch (err) {
    console.error('Error fetching recent gate lookups:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch recent lookups.' });
  }
}

// Get Gatewise Movement Stats & Self-Registered Visitor List for Security Guards
async function getGatewiseStatsAndSelfRegistered(req, res) {
  const gateName = req.query.gateName || 'NORTH_GATE';
  try {
    // 1. Gatewise Movement Logs & Counts for active gate today
    const statsRes = await db.query(
      `SELECT 
         COUNT(*) FILTER (WHERE direction = 'IN') as in_count,
         COUNT(*) FILTER (WHERE direction = 'OUT') as out_count
       FROM gate_logs
       WHERE gate_name = $1 AND timestamp >= CURRENT_DATE`,
      [gateName]
    );

    const logsRes = await db.query(
      `SELECT gl.*, 
              v.full_name as visitor_name, v.phone as visitor_phone,
              u.name as guard_name, u.role as guard_role
       FROM gate_logs gl
       JOIN registrations r ON gl.registration_id = r.id
       JOIN visitors v ON r.visitor_id = v.id
       LEFT JOIN users u ON gl.recorded_by_guard_id = u.id
       WHERE gl.gate_name = $1
       ORDER BY gl.id DESC
       LIMIT 100`,
      [gateName]
    );

    // 2. Self-Registered / Spot Visitors List & Count
    const selfRegRes = await db.query(
      `SELECT r.id, r.pass_code, r.status, r.registration_type, r.created_at,
              v.full_name as visitor_name, v.phone as visitor_phone, v.visitor_category,
              u.name as host_name
       FROM registrations r
       JOIN visitors v ON r.visitor_id = v.id
       LEFT JOIN users u ON r.host_id = u.id
       WHERE r.registration_type = 'SPOT_REGISTRATION'
       ORDER BY r.id DESC
       LIMIT 100`
    );

    res.json({
      success: true,
      gate_name: gateName,
      gate_in_count: parseInt(statsRes.rows[0]?.in_count || 0),
      gate_out_count: parseInt(statsRes.rows[0]?.out_count || 0),
      gate_movement_list: logsRes.rows,
      self_registered_count: selfRegRes.rows.length,
      self_registered_list: selfRegRes.rows,
    });
  } catch (err) {
    console.error('Error fetching gatewise stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch gatewise stats.' });
  }
}

module.exports = {
  verifyGatePass,
  processGateMovement,
  getVisitorsInsideCampus,
  getSpotRegistrationsQueue,
  assignHostToSpotRegistration,
  getRecentGateLookups,
  getGatewiseStatsAndSelfRegistered,
};
