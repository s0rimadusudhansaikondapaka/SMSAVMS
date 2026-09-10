const db = require('../config/db');
const { broadcastSyncEvent } = require('../sockets/syncServer');
const { logSystemAction } = require('../services/auditLogger');
const { checkSystematicCheckouts } = require('./expiryService');

function computeVisitorStatuses(reg) {
  const now = new Date();
  const validFrom = reg.valid_from ? new Date(reg.valid_from) : new Date();
  const validUntil = new Date(reg.valid_until);
  const departureTimePassed = now > validUntil;

  // Arrival window: 8 hours prior to arrival
  const eightHoursPrior = new Date(validFrom.getTime() - 8 * 60 * 60 * 1000);
  const isWithinArrivalWindow = now >= eightHoursPrior;

  // Category 1: Lifecycle Status (Yet to Arrive, CHECKED-IN, CHECKED-OUT)
  let lifecycleStatus = 'Yet to Arrive';
  if (reg.lifecycle_status) {
    lifecycleStatus = reg.lifecycle_status;
  } else if (reg.status === 'CHECKED_OUT') {
    lifecycleStatus = 'CHECKED-OUT';
  } else if (reg.status === 'INSIDE_CAMPUS' || reg.first_entry_at) {
    lifecycleStatus = 'CHECKED-IN';
  } else if (['APPROVED', 'PENDING_L1', 'PENDING_L2'].includes(reg.status)) {
    lifecycleStatus = 'Yet to Arrive';
  }

  // Category 2: Physical Presence Status (currently_inside, currently_outside, over_stayed)
  let presenceStatus = 'currently_outside';
  if (reg.status === 'INSIDE_CAMPUS' || reg.presence_status === 'currently_inside' || reg.presence_status === 'over_stayed') {
    if (departureTimePassed) {
      presenceStatus = 'over_stayed';
    } else {
      presenceStatus = 'currently_inside';
    }
  } else {
    presenceStatus = 'currently_outside';
  }

  // Systematic checkout rule: If currently_outside and estimated departure time has passed while checked-in
  if (presenceStatus === 'currently_outside' && departureTimePassed && lifecycleStatus === 'CHECKED-IN') {
    lifecycleStatus = 'CHECKED-OUT';
  }

  // IN button rule: enabled only if within 8 hours prior arrival AND till Visitor's estimated departure time AND not currently inside
  const isInEnabled = isWithinArrivalWindow && !departureTimePassed && presenceStatus !== 'currently_inside';
  // OUT button rule: enabled if Visitor's status is 'currently_inside' or 'over_stayed'
  const isOutEnabled = presenceStatus === 'currently_inside' || presenceStatus === 'over_stayed';

  return {
    lifecycle_status: lifecycleStatus,
    presence_status: presenceStatus,
    departure_time_passed: departureTimePassed,
    is_within_arrival_window: isWithinArrivalWindow,
    is_in_enabled: isInEnabled,
    is_out_enabled: isOutEnabled,
  };
}

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
  const query = req.params.query || req.params.passCode || req.query.query; // passcode, qr content, phone number, or vehicle_no
  if (!query) {
    return res.status(400).json({ success: false, message: 'Search parameter required.' });
  }

  let cleanQuery = String(query).trim().replace(/^["']|["']$/g, '');

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
    // Allows searching by Passcode, Phone Number, Vehicle No, Visitor Name, or Registration ID
    const result = await db.query(
      `SELECT * FROM (
        SELECT DISTINCT ON (COALESCE(r.pass_code, CAST(r.id AS VARCHAR)))
          r.*, 
          v.full_name as visitor_name, v.phone as visitor_phone, v.email as visitor_email, v.gender as visitor_gender,
          v.photo_url, v.id_type, v.id_number, v.id_card_number, v.id_card_image_url, v.visitor_category, v.company_name, v.is_frequent_visitor, v.has_smartphone,
          u.name as host_name, u.phone as host_phone, u.flat_info as host_flat_info, u.role as host_role,
          rfm.relationship as family_relationship,
          rv.plate_number as registered_plate_number,
          rv.vehicle_type as registered_vehicle_type
        FROM registrations r 
        JOIN visitors v ON r.visitor_id = v.id 
        LEFT JOIN users u ON r.host_id = u.id 
        LEFT JOIN resident_family_members rfm ON r.family_member_id = rfm.id
        LEFT JOIN registration_vehicles rv ON rv.registration_id = r.id
        WHERE LOWER(r.pass_code) = LOWER($1) 
           OR LOWER(r.pass_code) = LOWER('PASS-' || $1)
           OR r.pass_code ILIKE '%' || $1 || '%'
           OR LOWER(COALESCE(r.guid, '')) = LOWER($1) 
           OR LOWER(COALESCE(v.vehicle_no, '')) ILIKE '%' || $1 || '%' 
           OR LOWER(COALESCE(r.vehicle_no, '')) ILIKE '%' || $1 || '%' 
           OR LOWER(COALESCE(rv.plate_number, '')) ILIKE '%' || $1 || '%'
           OR v.phone ILIKE '%' || $1
           OR v.full_name ILIKE '%' || $1 || '%'
           OR CAST(r.id AS TEXT) = $1
        ORDER BY COALESCE(r.pass_code, CAST(r.id AS VARCHAR)), r.id DESC
      ) sub
      ORDER BY 
        CASE 
          WHEN LOWER(sub.pass_code) = LOWER($1) OR LOWER(sub.pass_code) = LOWER('PASS-' || $1) THEN 1
          WHEN sub.visitor_phone = $1 THEN 2
          ELSE 3
        END,
        sub.id DESC
      LIMIT 25`,
      [cleanQuery]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No matching gate pass found for query: ' + cleanQuery });
    }

    const allGates = ['NORTH_GATE', 'SOUTH_GATE', 'EAST_GATE', 'WEST_GATE', 'STAFF_GATE'];
    const currentGate = (req.query.gateName || 'NORTH_GATE').toUpperCase();
    const graceHours = await getGraceHoursWindow();
    const now = new Date();

    const matches = result.rows.map((reg) => {
      let auditApproverName = null;
      let auditApproverRole = null;
      reg.approved_by_display = reg.approved_by_name 
        ? `${reg.approved_by_name} (${reg.approved_by_role || 'Approver'})` 
        : reg.bypassed_by_admin 
        ? 'Super Admin (Direct Auto-Approve)' 
        : reg.host_name 
        ? `${reg.host_name} (Host Pre-Approval)` 
        : 'System Approved';

      const isPerm = isPermanentPass(reg);
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

      const computedStatuses = computeVisitorStatuses(reg);
      const maskedHostPhone = reg.host_phone ? reg.host_phone.replace(/(\+\d{2}\s?\d{2})\d{4}(\d{4})/, '$1****$2') : '';

      return {
        ...reg,
        ...computedStatuses,
        host_phone_masked: maskedHostPhone,
        vehicle_details: reg.vehicle_no || reg.registered_plate_number || reg.visitor_vehicle_no || 'None',
        allowed_gates: allGates,
        restricted_gates: [],
        is_current_gate_allowed: true,
        current_gate_checked: currentGate,
        grace_hours: graceHours,
        earliest_allowed_entry: windowStart.toISOString(),
        latest_allowed_entry: windowEnd.toISOString(),
        overstay_threshold: windowEnd.toISOString(),
        arrival_status: arrivalStatus,
        arrival_message: arrivalMessage,
        egress_status: egressStatus,
      };
    });

    const primaryPass = matches[0];

    // Fetch multiple vehicles & logs for primary pass
    try {
      const vehRes = await db.query(`SELECT * FROM registration_vehicles WHERE registration_id = $1`, [primaryPass.id]);
      primaryPass.vehicles = vehRes.rows;
      const logsRes = await db.query(
        `SELECT gl.*, u.name as guard_name, u.role as guard_role
         FROM gate_logs gl
         LEFT JOIN users u ON gl.recorded_by_guard_id = u.id
         WHERE gl.registration_id = $1
         ORDER BY gl.id DESC`,
        [primaryPass.id]
      );
      primaryPass.gate_movement_logs = logsRes.rows;
    } catch (vErr) {}

    res.json({
      success: true,
      pass: primaryPass,
      matches,
      count: matches.length,
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

      // Rule 7: IN button should be only enabled till the Visitor's estimated departure time. After that IN button should be disabled.
      if (!isPerm && now > validUntil) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Estimated departure time (${validUntil.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}) has passed. IN entry is disabled.`,
        });
      }

      // Check if current time is before allowed arrival window
      if (!isPerm && now < windowStart) {
        const isAuthorizedGuard = ['GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN', 'HOD'].includes(req.user?.role);
        if (!req.body.override_expired && !isAuthorizedGuard) {
          await db.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Entry window not yet open. Earliest allowed entry: ${windowStart.toLocaleString()}.`,
          });
        }
      }
    }

    if (direction === 'OUT') {
      // Rule 8: OUT button should be enabled if Visitor's status is 'currently_inside'
      const isInside = reg.status === 'INSIDE_CAMPUS' || reg.presence_status === 'currently_inside' || reg.presence_status === 'over_stayed';
      if (!isInside && !isPerm && reg.status === 'CHECKED_OUT') {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Visitor is already marked as CHECKED-OUT.',
        });
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

    // Rule 5, 9, 10:
    // IN: lifecycle_status = 'CHECKED-IN', presence_status = 'currently_inside', status = 'INSIDE_CAMPUS'
    // OUT: guest going out is just 'currently_outside', lifecycle remains 'CHECKED-IN' (unless departure time already passed -> 'CHECKED-OUT')
    let newStatus = reg.status;
    let newLifecycle = reg.lifecycle_status || 'CHECKED-IN';
    let newPresence = 'currently_inside';
    let firstEntryAt = reg.first_entry_at;
    let lastEntryAt = reg.last_entry_at;
    let lastExitAt = reg.last_exit_at;

    if (direction === 'IN') {
      newStatus = 'INSIDE_CAMPUS';
      newLifecycle = 'CHECKED-IN';
      newPresence = 'currently_inside';
      if (!firstEntryAt) firstEntryAt = now;
      lastEntryAt = now;
    } else if (direction === 'OUT') {
      newPresence = 'currently_outside';
      lastExitAt = now;
      if (isPerm) {
        newStatus = 'APPROVED';
        newLifecycle = 'CHECKED-IN';
      } else {
        // Rule 10: If guest is going OUT and estimated departure time is passed, systematically check them OUT
        if (now > validUntil) {
          newStatus = 'CHECKED_OUT';
          newLifecycle = 'CHECKED-OUT';
        } else {
          // Temporary Exit (Rule 9): Still CHECKED-IN lifecycle, but currently_outside.
          // Set status = 'APPROVED' to allow re-entry before valid_until.
          newStatus = 'APPROVED';
          newLifecycle = 'CHECKED-IN';
        }
      }
    }

    await db.query(
      `UPDATE registrations 
       SET status = $1, 
           lifecycle_status = $2, 
           presence_status = $3, 
           first_entry_at = COALESCE(first_entry_at, $4),
           last_entry_at = COALESCE($5, last_entry_at),
           last_exit_at = COALESCE($6, last_exit_at),
           adult_men_count = $7, 
           adult_women_count = $8, 
           children_count = $9, 
           boys_count = $10, 
           girls_count = $11, 
           person_count = $12,
           vehicle_no = COALESCE($13, vehicle_no)
       WHERE id = $14`,
      [newStatus, newLifecycle, newPresence, firstEntryAt, lastEntryAt, lastExitAt, menCount, womenCount, kidsCount, boysCount, girlsCount, totalCount, vehicle_no || null, registration_id]
    );

    if (vehicle_no) {
      await db.query(`UPDATE visitors SET vehicle_no = $1 WHERE id = $2`, [vehicle_no, reg.visitor_id]);
    }

    await logSystemAction(req, {
      action: `GATE_${direction}`,
      entity_type: 'REGISTRATION',
      entity_id: registration_id,
      status: 'SUCCESS',
      remarks: `Gate ${direction} recorded at ${gate_name} for ${reg.visitor_name} (Pass: ${reg.pass_code}). Lifecycle: ${newLifecycle}, Presence: ${newPresence}. Breakdown - Men: ${menCount}, Women: ${womenCount}, Children: ${kidsCount}`
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
      lifecycle_status: newLifecycle,
      presence_status: newPresence,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: direction === 'IN' 
        ? `Visitor successfully checked IN at ${gate_name}. Status: Inside Campus` 
        : `Visitor stepped OUT at ${gate_name}. Status: ${newLifecycle} (${newPresence})`,
      status: newStatus,
      lifecycle_status: newLifecycle,
      presence_status: newPresence,
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
      `SELECT r.*, v.full_name as visitor_name, v.phone as visitor_phone, v.photo_url, v.id_card_image_url, v.id_type, v.id_number, v.id_card_number, v.visitor_category, u.name as host_name 
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
       WHERE gate_name = $1 AND timestamp >= CAST(CURRENT_DATE AS TIMESTAMP)`,
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

// 4. Get Invited Visitors (+8 hours upcoming & already checked-in) with search
async function getInvitedVisitors(req, res) {
  try {
    // Run systematic checkouts check first
    try {
      await checkSystematicCheckouts();
    } catch (e) {
      console.warn('Systematic checkouts check warning:', e.message);
    }

    const { search = '' } = req.query;
    const cleanSearch = String(search).trim();

    let queryParams = [];
    let whereClauses = [];

    // Filter 1: Valid time window (+8 hours upcoming) OR already checked-in visitors
    // Upcoming: valid_from <= (NOW() + INTERVAL '8 hours') AND valid_until >= (NOW() - INTERVAL '2 hours')
    // Checked-in: lifecycle_status = 'CHECKED-IN' OR status = 'INSIDE_CAMPUS' OR presence_status = 'currently_inside' OR first_entry_at IS NOT NULL
    whereClauses.push(`(
      (
        r.status IN ('APPROVED', 'INSIDE_CAMPUS')
        AND r.pass_code IS NOT NULL
        AND r.registration_type NOT IN ('DELIVERY_COURIER')
        AND COALESCE(v.visitor_category, '') NOT IN ('MAID', 'DELIVERY')
        AND r.valid_from <= (CURRENT_TIMESTAMP + INTERVAL '8 hours')
        AND r.valid_until >= (CURRENT_TIMESTAMP - INTERVAL '2 hours')
      )
      OR (
        r.status = 'INSIDE_CAMPUS'
        OR r.presence_status = 'currently_inside'
        OR ((r.lifecycle_status = 'CHECKED-IN' OR r.first_entry_at IS NOT NULL) AND r.valid_until >= (CURRENT_TIMESTAMP - INTERVAL '4 hours'))
      )
    )`);

    // Filter 2: Search by visitor name, last 4 digits phone, or vehicle number, or passcode
    if (cleanSearch) {
      queryParams.push(`%${cleanSearch}%`);
      const searchIdx = queryParams.length;
      whereClauses.push(`(
        v.full_name ILIKE $${searchIdx}
        OR v.phone ILIKE $${searchIdx}
        OR v.phone LIKE '%' || $${searchIdx}
        OR COALESCE(v.vehicle_no, '') ILIKE $${searchIdx}
        OR COALESCE(r.vehicle_no, '') ILIKE $${searchIdx}
        OR COALESCE(rv.plate_number, '') ILIKE $${searchIdx}
        OR r.pass_code ILIKE $${searchIdx}
      )`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT * FROM (
        SELECT DISTINCT ON (COALESCE(r.pass_code, CAST(r.id AS VARCHAR)))
          r.*,
          v.full_name as visitor_name,
          v.phone as visitor_phone,
          v.email as visitor_email,
          v.gender as visitor_gender,
          v.photo_url,
          v.id_type,
          v.id_number,
          v.id_card_number,
          v.id_card_image_url,
          v.visitor_category,
          v.company_name,
          v.vehicle_no as visitor_vehicle_no,
          u.name as host_name,
          u.phone as host_phone,
          u.flat_info as host_flat_info,
          rv.plate_number as registered_plate_number,
          rv.vehicle_type as registered_vehicle_type
        FROM registrations r
        JOIN visitors v ON r.visitor_id = v.id
        LEFT JOIN users u ON r.host_id = u.id
        LEFT JOIN registration_vehicles rv ON rv.registration_id = r.id
        ${whereSql}
        ORDER BY COALESCE(r.pass_code, CAST(r.id AS VARCHAR)), r.id DESC
      ) sub
      ORDER BY sub.id DESC
      LIMIT 150
    `;

    const result = await db.query(sql, queryParams);

    const seenPassCodes = new Set();
    const uniqueRows = result.rows.filter((row) => {
      const code = row.pass_code || `id_${row.id}`;
      if (seenPassCodes.has(code)) return false;
      seenPassCodes.add(code);
      return true;
    });

    const visitors = uniqueRows.map((row) => {
      const computed = computeVisitorStatuses(row);
      const maskedHostPhone = row.host_phone ? row.host_phone.replace(/(\+\d{2}\s?\d{2})\d{4}(\d{4})/, '$1****$2') : '';
      return {
        ...row,
        ...computed,
        host_phone_masked: maskedHostPhone,
        vehicle_details: row.vehicle_no || row.registered_plate_number || row.visitor_vehicle_no || 'None',
      };
    });

    res.json({
      success: true,
      count: visitors.length,
      visitors,
    });
  } catch (err) {
    console.error('Error fetching invited visitors:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch invited visitors.' });
  }
}

// 5. Guard restricted edit: ONLY edit 'number of people' and 'vehicle details'
async function updateVisitorGateDetails(req, res) {
  const { id } = req.params;
  const { adult_men_count, adult_women_count, boys_count, girls_count, children_count, vehicle_no, vehicle_type } = req.body;

  try {
    const regRes = await db.query(
      `SELECT r.*, v.id as visitor_id, v.full_name as visitor_name FROM registrations r JOIN visitors v ON r.visitor_id = v.id WHERE r.id = $1`,
      [id]
    );

    if (regRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    const reg = regRes.rows[0];

    const men = adult_men_count !== undefined ? Math.max(0, parseInt(adult_men_count) || 0) : reg.adult_men_count;
    const women = adult_women_count !== undefined ? Math.max(0, parseInt(adult_women_count) || 0) : reg.adult_women_count;
    const boys = boys_count !== undefined ? Math.max(0, parseInt(boys_count) || 0) : (reg.boys_count || 0);
    const girls = girls_count !== undefined ? Math.max(0, parseInt(girls_count) || 0) : (reg.girls_count || 0);
    const kids = children_count !== undefined ? Math.max(0, parseInt(children_count) || 0) : (boys + girls);
    const total = men + women + boys + girls;

    const newVehicleNo = vehicle_no !== undefined ? String(vehicle_no).trim() : reg.vehicle_no;

    await db.query(
      `UPDATE registrations 
       SET adult_men_count = $1, 
           adult_women_count = $2, 
           children_count = $3, 
           boys_count = $4, 
           girls_count = $5, 
           person_count = $6,
           vehicle_no = $7
       WHERE id = $8`,
      [men, women, kids, boys, girls, total, newVehicleNo, id]
    );

    if (newVehicleNo !== undefined) {
      await db.query(`UPDATE visitors SET vehicle_no = $1 WHERE id = $2`, [newVehicleNo, reg.visitor_id]);
      
      const rvCheck = await db.query(`SELECT id FROM registration_vehicles WHERE registration_id = $1 LIMIT 1`, [id]);
      if (rvCheck.rows.length > 0) {
        await db.query(
          `UPDATE registration_vehicles SET plate_number = $1, vehicle_type = COALESCE($2, vehicle_type) WHERE id = $3`,
          [newVehicleNo, vehicle_type || null, rvCheck.rows[0].id]
        );
      } else if (newVehicleNo) {
        const maxRv = await db.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM registration_vehicles');
        const nextRvId = parseInt(maxRv.rows[0].next_id, 10);
        await db.query(
          `INSERT INTO registration_vehicles (id, registration_id, plate_number, vehicle_type) VALUES ($1, $2, $3, $4)`,
          [nextRvId, id, newVehicleNo, vehicle_type || 'FOUR_WHEELER']
        );
      }
    }

    await logSystemAction(req, {
      action: 'GUARD_EDIT_VISITOR_DETAILS',
      entity_type: 'REGISTRATION',
      entity_id: id,
      status: 'SUCCESS',
      remarks: `Guard updated people count (Men:${men}, Women:${women}, Kids:${kids}, Total:${total}) and vehicle (${newVehicleNo || 'None'}) for ${reg.visitor_name}`
    });

    broadcastSyncEvent('VISITOR_DETAILS_UPDATED', {
      registration_id: id,
      total_count: total,
      adult_men_count: men,
      adult_women_count: women,
      children_count: kids,
      boys_count: boys,
      girls_count: girls,
      vehicle_no: newVehicleNo,
    });

    res.json({
      success: true,
      message: 'Visitor details updated successfully.',
      updated: {
        id,
        adult_men_count: men,
        adult_women_count: women,
        children_count: kids,
        boys_count: boys,
        girls_count: girls,
        person_count: total,
        vehicle_no: newVehicleNo,
      }
    });
  } catch (err) {
    console.error('Error updating visitor gate details:', err);
    res.status(500).json({ success: false, message: 'Failed to update visitor details.' });
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
  getInvitedVisitors,
  updateVisitorGateDetails,
};
