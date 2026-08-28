const db = require('../config/db');

async function logSystemAction(req, { action, entity_type = 'GENERAL', entity_id = null, remarks = '', status = 'SUCCESS' }) {
  try {
    const actorId = req?.user?.id || null;
    const actorName = req?.user?.name || (actorId ? 'System User' : 'Guest / Visitor');
    const actorRole = req?.user?.role || 'SYSTEM';
    
    // Extract Client IP
    let ipAddress = '127.0.0.1';
    if (req) {
      ipAddress = req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1';
      if (typeof ipAddress === 'string' && ipAddress.includes(',')) {
        ipAddress = ipAddress.split(',')[0].trim();
      }
    }

    await db.query(
      `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, ip_address, status, remarks, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
      [actorId, actorName, actorRole, action, entity_type, entity_id, String(ipAddress), status, remarks]
    );
  } catch (err) {
    console.error('[Audit Logger Error]: Failed to write audit log:', err);
  }
}

module.exports = { logSystemAction };
