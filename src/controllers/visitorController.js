const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../config/db');
const { broadcastSyncEvent } = require('../sockets/syncServer');
const { sendVisitorApprovalEmail, sendHostL1NotificationEmail } = require('../services/emailService');
const { logSystemAction } = require('../services/auditLogger');

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

  // Link-based invitations must include a visitor photo so guards can verify
  // the visitor at entry. ID proof remains optional and is handled below.
  if (!is_spot_registration && !photo_url) {
    return res.status(400).json({
      success: false,
      message: 'Visitor photo is required for invite link registrations.'
    });
  }

  try {
    await db.query('BEGIN');

    // 1. Insert or update visitor
    let visitorId;
    const existingVisitor = await db.query('SELECT id FROM visitors WHERE phone = $1', [phone]);
    const idCardNo = id_card_number || id_number || '';
    const visitorGender = gender || 'Male';
    const companyName = req.body.company_name || req.body.companyName || '';

    if (existingVisitor.rows.length > 0) {
      visitorId = existingVisitor.rows[0].id;
      await db.query(
        `UPDATE visitors 
         SET full_name = $1, email = $2, gender = $3, photo_url = $4, id_type = $5, id_number = $6, id_card_number = $7, id_card_image_url = $8, visitor_category = $9, company_name = $10
         WHERE id = $11`,
        [full_name, email || '', visitorGender, photo_url || '', id_type || 'Aadhaar', idCardNo, idCardNo, id_card_image_url || '', visitor_category || 'GENERAL', companyName, visitorId]
      );
    } else {
      const maxV = await db.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM visitors');
      const nextVisId = parseInt(maxV.rows[0].next_id, 10);
      const newVisitor = await db.query(
        `INSERT INTO visitors (id, full_name, phone, email, gender, photo_url, id_type, id_number, id_card_number, id_card_image_url, visitor_category, company_name) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [nextVisId, full_name, phone, email || '', visitorGender, photo_url || '', id_type || 'Aadhaar', idCardNo, idCardNo, id_card_image_url || '', visitor_category || 'GENERAL', companyName]
      );
      visitorId = newVisitor.rows[0].id;
    }

    const validFromTime = valid_from ? new Date(valid_from) : new Date();
    let validUntilTime;
    if (valid_until) {
      validUntilTime = new Date(valid_until);
    } else {
      validUntilTime = new Date(validFromTime);
      validUntilTime.setDate(validUntilTime.getDate() + 1);
      validUntilTime.setHours(21, 0, 0, 0); // Default to Tomorrow 9:00 PM
    }

    if (!is_spot_registration) {
      const now = new Date();
      if (validFromTime < new Date(now.getTime() - 10 * 60 * 1000)) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Arrival Date/Time (ETA) cannot be in the past or already expired.'
        });
      }

      if (validUntilTime <= validFromTime) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Departure Date/Time (ETD) must be after Arrival Date/Time.'
        });
      }

      const fromHour = validFromTime.getHours();
      const fromMin = validFromTime.getMinutes();
      const untilHour = validUntilTime.getHours();
      const untilMin = validUntilTime.getMinutes();

      if (fromHour < 5 || fromHour > 22 || (fromHour === 22 && fromMin > 0)) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Estimated Time of Arrival (ETA) must be between 5:00 AM and 10:00 PM.'
        });
      }

      if (untilHour < 5 || untilHour > 22 || (untilHour === 22 && untilMin > 0)) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Estimated Time of Departure (ETD) must be between 5:00 AM and 10:00 PM.'
        });
      }
    }

    // Determine initial status based on approval matrix & L2 setting
    const l2Enabled = await isL2Enabled();
    // Enhanced approval routing with time-based L2 and approvers_config
    let initialStatus = 'PENDING_L1';
    const arrivalHour = validFromTime.getHours();
