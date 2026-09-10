const db = require('../config/db');
const { broadcastSyncEvent } = require('../sockets/syncServer');

async function getSettingValue(key, defaultVal) {
  try {
    const res = await db.query('SELECT value FROM system_settings WHERE key = $1', [key]);
    return res.rows.length > 0 ? res.rows[0].value : defaultVal;
  } catch (e) {
    return defaultVal;
  }
}

// 1. Check and expire requests where valid_from has passed and status is still pending
async function checkExpiredRequests() {
  try {
    const result = await db.query(
      `UPDATE registrations 
       SET status = 'EXPIRED' 
       WHERE status IN ('PENDING_L1', 'PENDING_L2', 'PENDING_ACCOMMODATION') 
       AND valid_until < CURRENT_TIMESTAMP
       RETURNING id, pass_code`
    );
    if (result.rows.length > 0) {
      console.log(`[Expiry Service] Expired ${result.rows.length} registration(s):`, result.rows.map(r => r.pass_code));
      for (const reg of result.rows) {
        await db.query(
          `INSERT INTO audit_logs (action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4)`,
          ['AUTO_EXPIRED', 'REGISTRATION', reg.id, `Request auto-expired: arrival window passed without approval`]
        );
      }
      broadcastSyncEvent('REQUESTS_EXPIRED', { count: result.rows.length, ids: result.rows.map(r => r.id) });
    }
    return result.rows;
  } catch (err) {
    console.error('[Expiry Service] Error checking expired requests:', err);
    return [];
  }
}

// 2. Auto-reject if host hasn't responded within X minutes
async function checkHostTimeout() {
  try {
    const timeoutMinutes = parseInt(await getSettingValue('HOST_TIMEOUT_MINUTES', '30'));
    const result = await db.query(
      `UPDATE registrations 
       SET status = 'REJECTED' 
       WHERE status = 'PENDING_L1' 
       AND host_notified_at IS NOT NULL 
       AND host_notified_at < CURRENT_TIMESTAMP - INTERVAL '1 minute' * $1
       RETURNING id, pass_code, host_id`,
      [timeoutMinutes]
    );
    if (result.rows.length > 0) {
      console.log(`[Expiry Service] Auto-rejected ${result.rows.length} request(s) due to host timeout:`, result.rows.map(r => r.pass_code));
      for (const reg of result.rows) {
        await db.query(
          `INSERT INTO audit_logs (action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4)`,
          ['HOST_TIMEOUT_REJECT', 'REGISTRATION', reg.id, `Auto-rejected: host did not respond within ${timeoutMinutes} minutes`]
        );
      }
      broadcastSyncEvent('HOST_TIMEOUT', { count: result.rows.length, ids: result.rows.map(r => r.id) });
    }
    return result.rows;
  } catch (err) {
    console.error('[Expiry Service] Error checking host timeout:', err);
    return [];
  }
}

// 3. Send reminders for requests approaching their arrival time without approval
async function checkReminders() {
  try {
    const reminderMinutes = parseInt(await getSettingValue('REMINDER_BEFORE_ARRIVAL_MINUTES', '300')); // Default 300 mins (5 hours prior to arrival)
    const result = await db.query(
      `SELECT r.id, r.pass_code, r.valid_from, r.host_id, v.full_name as visitor_name
       FROM registrations r
       JOIN visitors v ON r.visitor_id = v.id
       WHERE r.status IN ('PENDING_L1', 'PENDING_L2', 'PENDING_ACCOMMODATION')
       AND r.reminder_sent_at IS NULL
       AND r.valid_from <= CURRENT_TIMESTAMP + INTERVAL '1 minute' * $1
       AND r.valid_from > CURRENT_TIMESTAMP`,
      [reminderMinutes]
    );
    if (result.rows.length > 0) {
      console.log(`[Expiry Service] Sending reminders for ${result.rows.length} request(s):`, result.rows.map(r => r.pass_code));
      for (const reg of result.rows) {
        await db.query(
          `UPDATE registrations SET reminder_sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [reg.id]
        );
        await db.query(
          `INSERT INTO audit_logs (action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4)`,
          ['REMINDER_SENT', 'REGISTRATION', reg.id, `Approval reminder sent: visitor ${reg.visitor_name} arriving soon`]
        );
      }
      broadcastSyncEvent('REMINDERS_SENT', { count: result.rows.length, passes: result.rows.map(r => r.pass_code) });
    }
    return result.rows;
  } catch (err) {
    console.error('[Expiry Service] Error checking reminders:', err);
    return [];
  }
}

// 4. Systematic checkout: If visitor is currently_outside and valid_until (Estimated Departure Time) has passed, they are systematically CHECKED-OUT.
// Also, if visitor is inside campus and valid_until has passed, update presence_status = 'over_stayed'.
async function checkSystematicCheckouts() {
  try {
    // 4A. Visitors currently_outside whose Estimated Departure Time (valid_until) has passed
    const checkoutRes = await db.query(
      `UPDATE registrations 
       SET lifecycle_status = 'CHECKED-OUT',
           presence_status = 'currently_outside',
           status = 'CHECKED_OUT'
       WHERE (presence_status = 'currently_outside' OR status != 'INSIDE_CAMPUS')
       AND lifecycle_status = 'CHECKED-IN'
       AND valid_until < CURRENT_TIMESTAMP
       RETURNING id, pass_code`
    );

    if (checkoutRes.rows.length > 0) {
      console.log(`[Expiry Service] Systematic CHECKED-OUT executed for ${checkoutRes.rows.length} registration(s):`, checkoutRes.rows.map(r => r.pass_code));
      for (const reg of checkoutRes.rows) {
        await db.query(
          `INSERT INTO audit_logs (action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4)`,
          ['SYSTEMATIC_CHECKOUT', 'REGISTRATION', reg.id, `Visitor systematically CHECKED-OUT: estimated departure time elapsed while currently outside campus`]
        );
      }
      broadcastSyncEvent('SYSTEMATIC_CHECKOUT', { count: checkoutRes.rows.length, passes: checkoutRes.rows.map(r => r.pass_code) });
    }

    // 4B. Visitors currently_inside whose valid_until has passed -> presence_status = 'over_stayed'
    const overstayRes = await db.query(
      `UPDATE registrations 
       SET presence_status = 'over_stayed'
       WHERE (status = 'INSIDE_CAMPUS' OR presence_status = 'currently_inside')
       AND presence_status != 'over_stayed'
       AND valid_until < CURRENT_TIMESTAMP
       RETURNING id, pass_code`
    );

    if (overstayRes.rows.length > 0) {
      console.log(`[Expiry Service] Updated presence to over_stayed for ${overstayRes.rows.length} visitor(s):`, overstayRes.rows.map(r => r.pass_code));
      broadcastSyncEvent('VISITOR_OVERSTAYED', { count: overstayRes.rows.length, passes: overstayRes.rows.map(r => r.pass_code) });
    }

    return checkoutRes.rows;
  } catch (err) {
    console.error('[Expiry Service] Error executing systematic checkout:', err);
    return [];
  }
}

// Start the periodic expiry check service (runs every 2 minutes for fast systematic checkout & reminders)
function startExpiryService() {
  console.log('[Expiry Service] Starting periodic request expiry, reminder & systematic checkout service...');
  
  // Run immediately on startup
  setTimeout(async () => {
    await checkExpiredRequests();
    await checkHostTimeout();
    await checkReminders();
    await checkSystematicCheckouts();
  }, 5000); // 5 second delay after startup
  
  // Then run every 2 minutes
  setInterval(async () => {
    await checkExpiredRequests();
    await checkHostTimeout();
    await checkReminders();
    await checkSystematicCheckouts();
  }, 2 * 60 * 1000);
}

module.exports = {
  checkExpiredRequests,
  checkHostTimeout,
  checkReminders,
  checkSystematicCheckouts,
  startExpiryService,
};

