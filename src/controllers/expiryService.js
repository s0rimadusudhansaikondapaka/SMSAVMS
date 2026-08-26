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
       AND valid_until < NOW()
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
       AND host_notified_at < NOW() - INTERVAL '1 minute' * $1
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
    const reminderMinutes = parseInt(await getSettingValue('REMINDER_BEFORE_ARRIVAL_MINUTES', '30'));
    const result = await db.query(
      `SELECT r.id, r.pass_code, r.valid_from, r.host_id, v.full_name as visitor_name
       FROM registrations r
       JOIN visitors v ON r.visitor_id = v.id
       WHERE r.status IN ('PENDING_L1', 'PENDING_L2', 'PENDING_ACCOMMODATION')
       AND r.reminder_sent_at IS NULL
       AND r.valid_from <= NOW() + INTERVAL '1 minute' * $1
       AND r.valid_from > NOW()`,
      [reminderMinutes]
    );
    if (result.rows.length > 0) {
      console.log(`[Expiry Service] Sending reminders for ${result.rows.length} request(s):`, result.rows.map(r => r.pass_code));
      for (const reg of result.rows) {
        await db.query(
          `UPDATE registrations SET reminder_sent_at = NOW() WHERE id = $1`,
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

// Start the periodic expiry check service (runs every 5 minutes)
function startExpiryService() {
  console.log('[Expiry Service] Starting periodic request expiry & reminder service (every 5 minutes)...');
  
  // Run immediately on startup
  setTimeout(async () => {
    await checkExpiredRequests();
    await checkHostTimeout();
    await checkReminders();
  }, 10000); // 10 second delay after startup
  
  // Then run every 5 minutes
  setInterval(async () => {
    await checkExpiredRequests();
    await checkHostTimeout();
    await checkReminders();
  }, 5 * 60 * 1000);
}

module.exports = {
  checkExpiredRequests,
  checkHostTimeout,
  checkReminders,
  startExpiryService,
};
