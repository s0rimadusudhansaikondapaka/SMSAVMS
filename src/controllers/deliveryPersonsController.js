const db = require('../config/db');
const { broadcastSyncEvent } = require('../sockets/syncServer');
const { logSystemAction } = require('../services/auditLogger');

// Ensure delivery_persons table exists
async function ensureDeliveryTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS delivery_persons (
        id SERIAL PRIMARY KEY,
        guid VARCHAR(64),
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        company_name VARCHAR(255),
        id_type VARCHAR(100) DEFAULT 'Aadhaar',
        id_number VARCHAR(100),
        photo_url TEXT,
        vehicle_type VARCHAR(50) DEFAULT 'Two Wheeler',
        vehicle_number VARCHAR(100),
        destination_host_id INT REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'PENDING',
        created_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
        created_by_role VARCHAR(50),
        approved_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
        approved_by_name VARCHAR(255),
        supervisor_notified_at TIMESTAMP,
        approved_at TIMESTAMP,
        current_visit_status VARCHAR(50) DEFAULT 'OUT',
        last_entry_at TIMESTAMP,
        last_exit_at TIMESTAMP,
        active_registration_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (err) {
    console.error('[Delivery Module] Error initializing table:', err);
  }
}
ensureDeliveryTable();

// 1. Get Delivery Persons Report (Role-Aware & Overstay Detection)
async function getDeliveryPersons(req, res) {
  try {
    const result = await db.query(`
      SELECT dp.*, 
             u.name as destination_host_name, u.flat_info as destination_flat_info,
             cb.name as created_by_name
      FROM delivery_persons dp
      LEFT JOIN users u ON dp.destination_host_id = u.id
      LEFT JOIN users cb ON dp.created_by_user_id = cb.id
      ORDER BY dp.id DESC
    `);

    const now = new Date();
    const deliveryPersons = result.rows.map(dp => {
      let isOverstay = false;
      let stayDurationMinutes = 0;
      if (dp.current_visit_status === 'IN' && dp.last_entry_at) {
        const entryTime = new Date(dp.last_entry_at);
        stayDurationMinutes = Math.floor((now - entryTime) / (1000 * 60));
        if (stayDurationMinutes >= 120) { // 2 Hours overstay rule
          isOverstay = true;
        }
      }
      return {
        ...dp,
        is_overstay: isOverstay,
        stay_duration_minutes: stayDurationMinutes,
      };
    });

    res.json({ success: true, delivery_persons: deliveryPersons });
  } catch (err) {
    console.error('Error fetching delivery persons:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch delivery persons report.' });
  }
}

// 2. Create Delivery Person
// If Security Guard fills -> status = PENDING (Supervisor notified)
// If Supervisor / Admin fills -> status = APPROVED instantly
async function createDeliveryPerson(req, res) {
  const {
    full_name,
    phone,
    company_name,
    id_type,
    id_number,
    photo_url,
    vehicle_type,
    vehicle_number,
    destination_host_id,
  } = req.body;

  if (!full_name || !phone) {
    return res.status(400).json({ success: false, message: 'Full Name and Phone number are required.' });
  }

  const userRole = (req.user.role || 'GUARD').toUpperCase();
  const isSupervisorOrAbove = ['SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'].includes(userRole);

  const initialStatus = isSupervisorOrAbove ? 'APPROVED' : 'PENDING';
  const approvedByUserId = isSupervisorOrAbove ? req.user.id : null;
  const approvedByName = isSupervisorOrAbove ? req.user.name : null;
  const approvedAt = isSupervisorOrAbove ? new Date() : null;
  const supervisorNotifiedAt = isSupervisorOrAbove ? null : new Date();

  try {
    const guid = `DEL-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    const insertRes = await db.query(
      `INSERT INTO delivery_persons 
       (guid, full_name, phone, company_name, id_type, id_number, photo_url, vehicle_type, vehicle_number, destination_host_id, status, created_by_user_id, created_by_role, approved_by_user_id, approved_by_name, approved_at, supervisor_notified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        guid,
        full_name,
        phone,
        company_name || 'Delivery Agency',
        id_type || 'Aadhaar',
        id_number || '',
        photo_url || '',
        vehicle_type || 'Two Wheeler',
        vehicle_number || '',
        destination_host_id || null,
        initialStatus,
        req.user.id,
        userRole,
        approvedByUserId,
        approvedByName,
        approvedAt,
        supervisorNotifiedAt
      ]
    );

    const deliveryPerson = insertRes.rows[0];

    await logSystemAction(req, {
      action: 'CREATE_DELIVERY_PERSON',
      entity_type: 'DELIVERY_PERSON',
      entity_id: deliveryPerson.id,
      remarks: `Delivery person ${full_name} created by ${req.user.name} (${userRole}). Status: ${initialStatus}`,
    });

    broadcastSyncEvent('DELIVERY_PERSON_CREATED', {
      deliveryPerson,
      status: initialStatus,
      created_by: req.user.name
    });

    res.status(201).json({
      success: true,
      message: isSupervisorOrAbove
        ? 'Delivery person details registered and APPROVED successfully!'
        : 'Delivery person details submitted. Pending Supervisor approval.',
      delivery_person: deliveryPerson,
    });
  } catch (err) {
    console.error('Error creating delivery person:', err);
    res.status(500).json({ success: false, message: 'Failed to create delivery person record.' });
  }
}

// 3. Edit Delivery Person Details (Security Supervisor / Admin feature)
async function updateDeliveryPerson(req, res) {
  const { id } = req.params;
  const {
    full_name,
    phone,
    company_name,
    id_type,
    id_number,
    photo_url,
    vehicle_type,
    vehicle_number,
    destination_host_id,
  } = req.body;

  try {
    const updateRes = await db.query(
      `UPDATE delivery_persons 
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           company_name = COALESCE($3, company_name),
           id_type = COALESCE($4, id_type),
           id_number = COALESCE($5, id_number),
           photo_url = COALESCE($6, photo_url),
           vehicle_type = COALESCE($7, vehicle_type),
           vehicle_number = COALESCE($8, vehicle_number),
           destination_host_id = COALESCE($9, destination_host_id)
       WHERE id = $10
       RETURNING *`,
      [full_name, phone, company_name, id_type, id_number, photo_url, vehicle_type, vehicle_number, destination_host_id, id]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Delivery person record not found.' });
    }

    const updatedPerson = updateRes.rows[0];

    await logSystemAction(req, {
      action: 'UPDATE_DELIVERY_PERSON',
      entity_type: 'DELIVERY_PERSON',
      entity_id: id,
      remarks: `Delivery person details updated by Supervisor ${req.user.name}`,
    });

    broadcastSyncEvent('DELIVERY_PERSON_UPDATED', { deliveryPerson: updatedPerson });

    res.json({
      success: true,
      message: 'Delivery person details updated successfully.',
      delivery_person: updatedPerson,
    });
  } catch (err) {
    console.error('Error updating delivery person:', err);
    res.status(500).json({ success: false, message: 'Failed to update delivery person record.' });
  }
}

// 4. Supervisor Approve or Reject Delivery Person
async function approveOrRejectDeliveryPerson(req, res) {
  const { id } = req.params;
  const { action, remarks } = req.body; // 'APPROVE' or 'REJECT'

  if (!['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT.' });
  }

  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  try {
    const updateRes = await db.query(
      `UPDATE delivery_persons 
       SET status = $1, approved_by_user_id = $2, approved_by_name = $3, approved_at = CURRENT_TIMESTAMP 
       WHERE id = $4
       RETURNING *`,
      [newStatus, req.user.id, req.user.name, id]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Delivery person record not found.' });
    }

    const deliveryPerson = updateRes.rows[0];

    await logSystemAction(req, {
      action: `DELIVERY_${action}`,
      entity_type: 'DELIVERY_PERSON',
      entity_id: id,
      remarks: remarks || `Delivery person ${action}D by ${req.user.name} (${req.user.role})`,
    });

    broadcastSyncEvent('DELIVERY_PERSON_APPROVAL', {
      deliveryPersonId: id,
      status: newStatus,
      approvedBy: req.user.name
    });

    res.json({
      success: true,
      message: `Delivery person status updated to ${newStatus}.`,
      delivery_person: deliveryPerson,
    });
  } catch (err) {
    console.error('Error approving/rejecting delivery person:', err);
    res.status(500).json({ success: false, message: 'Failed to update delivery person approval status.' });
  }
}

// 5. Mark IN (Stateless Form Submission with editable vehicle details)
async function markDeliveryIn(req, res) {
  const { id } = req.params;
  const { vehicle_type, vehicle_number, gate_name } = req.body;

  try {
    const checkRes = await db.query('SELECT * FROM delivery_persons WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Delivery person not found.' });
    }

    const dp = checkRes.rows[0];

    if (dp.status !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Only APPROVED delivery persons can be checked IN.' });
    }

    // Update vehicle details if modified during IN
    const updatedVehicleType = vehicle_type || dp.vehicle_type;
    const updatedVehicleNumber = vehicle_number || dp.vehicle_number;

    // 1. Create or resolve visitor record in visitors table
    let visitorId;
    const existingVisitor = await db.query('SELECT id FROM visitors WHERE phone = $1', [dp.phone]);
    if (existingVisitor.rows.length > 0) {
      visitorId = existingVisitor.rows[0].id;
    } else {
      const newV = await db.query(
        `INSERT INTO visitors (full_name, phone, company_name, id_type, id_number, photo_url, visitor_category)
         VALUES ($1, $2, $3, $4, $5, $6, 'DELIVERY') RETURNING id`,
        [dp.full_name, dp.phone, dp.company_name, dp.id_type, dp.id_number, dp.photo_url]
      );
      visitorId = newV.rows[0].id;
    }

    // 2. Create Visit Request in registrations table with status = CHECKED-IN and 2-hour window
    const validFrom = new Date();
    const validUntil = new Date(validFrom.getTime() + 2 * 60 * 60 * 1000); // 2 Hours overstay window
    const passCode = `DELIVERY-${Math.floor(1000 + Math.random() * 9000)}`;

    const regRes = await db.query(
      `INSERT INTO registrations 
       (visitor_id, host_id, purpose, visit_type, visitor_category, status, pass_code, valid_from, valid_until, adult_men_count, person_count)
       VALUES ($1, $2, $3, 'OFFICE', 'DELIVERY', 'CHECKED-IN', $4, $5, $6, 1, 1)
       RETURNING id, pass_code`,
      [visitorId, dp.destination_host_id || null, `Delivery Visit (${dp.company_name})`, passCode, validFrom, validUntil]
    );

    const regId = regRes.rows[0].id;

    // 3. Create ENTRY Gate Log
    const gateNameUsed = gate_name || 'NORTH_GATE';
    await db.query(
      `INSERT INTO gate_logs 
       (registration_id, visitor_id, verified_by_user_id, verified_by_name, log_type, gate_name, entry_time, remarks, vehicle_no)
       VALUES ($1, $2, $3, $4, 'ENTRY', $5, CURRENT_TIMESTAMP, $6, $7)`,
      [regId, visitorId, req.user.id, req.user.name, gateNameUsed, `Delivery Visit IN for ${dp.company_name}`, updatedVehicleNumber]
    );

    // 4. Update delivery_persons current_visit_status = IN
    await db.query(
      `UPDATE delivery_persons 
       SET current_visit_status = 'IN', 
           last_entry_at = CURRENT_TIMESTAMP, 
           active_registration_id = $1,
           vehicle_type = $2,
           vehicle_number = $3
       WHERE id = $4`,
      [regId, updatedVehicleType, updatedVehicleNumber, id]
    );

    await logSystemAction(req, {
      action: 'DELIVERY_MARK_IN',
      entity_type: 'DELIVERY_PERSON',
      entity_id: id,
      remarks: `Delivery person ${dp.full_name} (${dp.company_name}) marked IN at ${gateNameUsed} by ${req.user.name}`,
    });

    broadcastSyncEvent('DELIVERY_CHECK_IN', {
      deliveryPersonId: id,
      passCode,
      registrationId: regId,
      gateName: gateNameUsed
    });

    res.json({
      success: true,
      message: `Delivery Visit checked IN successfully! Pass Code: ${passCode}`,
      registration_id: regId,
      pass_code: passCode,
    });
  } catch (err) {
    console.error('Error marking delivery IN:', err);
    res.status(500).json({ success: false, message: 'Failed to mark delivery IN.' });
  }
}

// 6. Mark OUT (Includes Missed Entry Auto-IN Handling)
async function markDeliveryOut(req, res) {
  const { id } = req.params;
  const { auto_in, vehicle_number, gate_name } = req.body;

  try {
    const checkRes = await db.query('SELECT * FROM delivery_persons WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Delivery person not found.' });
    }

    const dp = checkRes.rows[0];

    // Check Human Error Condition: Guard forgot to click IN but clicked OUT
    if (dp.current_visit_status !== 'IN' && !auto_in) {
      return res.status(409).json({
        success: false,
        missed_entry: true,
        message: 'There is no record of IN. Would you like to mark Auto-IN along with OUT?',
      });
    }

    const gateNameUsed = gate_name || 'NORTH_GATE';
    let regId = dp.active_registration_id;

    // Handle Auto-IN for Missed Entry
    if (dp.current_visit_status !== 'IN' && auto_in) {
      // 1. Resolve visitor
      let visitorId;
      const existingVisitor = await db.query('SELECT id FROM visitors WHERE phone = $1', [dp.phone]);
      if (existingVisitor.rows.length > 0) {
        visitorId = existingVisitor.rows[0].id;
      } else {
        const newV = await db.query(
          `INSERT INTO visitors (full_name, phone, company_name, id_type, id_number, photo_url, visitor_category)
           VALUES ($1, $2, $3, $4, $5, $6, 'DELIVERY') RETURNING id`,
          [dp.full_name, dp.phone, dp.company_name, dp.id_type, dp.id_number, dp.photo_url]
        );
        visitorId = newV.rows[0].id;
      }

      const validFrom = new Date();
      const validUntil = new Date(validFrom.getTime() + 2 * 60 * 60 * 1000);
      const passCode = `DELIVERY-${Math.floor(1000 + Math.random() * 9000)}`;

      const regRes = await db.query(
        `INSERT INTO registrations 
         (visitor_id, host_id, purpose, visit_type, visitor_category, status, pass_code, valid_from, valid_until, adult_men_count, person_count)
         VALUES ($1, $2, $3, 'OFFICE', 'DELIVERY', 'CHECKED-OUT', $4, $5, $6, 1, 1)
         RETURNING id`,
        [visitorId, dp.destination_host_id || null, `Delivery Visit (${dp.company_name})`, passCode, validFrom, validUntil]
      );
      regId = regRes.rows[0].id;

      // Create ENTRY Gate Log with MISSED Entry remarks
      await db.query(
        `INSERT INTO gate_logs 
         (registration_id, visitor_id, verified_by_user_id, verified_by_name, log_type, gate_name, entry_time, remarks, vehicle_no)
         VALUES ($1, $2, $3, $4, 'ENTRY', $5, CURRENT_TIMESTAMP, 'MISSED Entry', $6)`,
        [regId, visitorId, req.user.id, req.user.name, gateNameUsed, vehicle_number || dp.vehicle_number]
      );
    } else if (regId) {
      // Regular OUT: Update visit request status to CHECKED-OUT
      await db.query(`UPDATE registrations SET status = 'CHECKED-OUT' WHERE id = $1`, [regId]);
    }

    // Create EXIT Gate Log
    await db.query(
      `INSERT INTO gate_logs 
       (registration_id, visitor_id, verified_by_user_id, verified_by_name, log_type, gate_name, exit_time, remarks, vehicle_no)
       VALUES ($1, $2, $3, $4, 'EXIT', $5, CURRENT_TIMESTAMP, $6, $7)`,
      [regId || null, null, req.user.id, req.user.name, gateNameUsed, `Delivery Visit OUT for ${dp.company_name}`, vehicle_number || dp.vehicle_number]
    );

    // Update delivery_persons current_visit_status = OUT
    await db.query(
      `UPDATE delivery_persons 
       SET current_visit_status = 'OUT', 
           last_exit_at = CURRENT_TIMESTAMP, 
           active_registration_id = NULL 
       WHERE id = $1`,
      [id]
    );

    await logSystemAction(req, {
      action: 'DELIVERY_MARK_OUT',
      entity_type: 'DELIVERY_PERSON',
      entity_id: id,
      remarks: `Delivery person ${dp.full_name} (${dp.company_name}) marked OUT at ${gateNameUsed} by ${req.user.name}`,
    });

    broadcastSyncEvent('DELIVERY_CHECK_OUT', {
      deliveryPersonId: id,
      registrationId: regId,
      gateName: gateNameUsed
    });

    res.json({
      success: true,
      message: auto_in
        ? 'Auto-IN (MISSED Entry) and OUT recorded successfully!'
        : 'Delivery Visit checked OUT successfully!',
    });
  } catch (err) {
    console.error('Error marking delivery OUT:', err);
    res.status(500).json({ success: false, message: 'Failed to mark delivery OUT.' });
  }
}

module.exports = {
  getDeliveryPersons,
  createDeliveryPerson,
  updateDeliveryPerson,
  approveOrRejectDeliveryPerson,
  markDeliveryIn,
  markDeliveryOut,
};
