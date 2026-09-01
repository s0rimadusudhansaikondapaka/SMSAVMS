const db = require('../config/db');

function extractClientIp(req) {
  if (!req) return '127.0.0.1';

  // 1. Check standard proxy headers (Render, AWS ALB, Nginx, Cloudflare)
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const ips = String(forwarded).split(',').map((ip) => ip.trim());
    if (ips[0] && ips[0] !== '::1' && ips[0] !== '127.0.0.1') {
      return ips[0].replace(/^::ffff:/, '');
    }
  }

  const realIp = req.headers?.['x-real-ip'] || req.headers?.['cf-connecting-ip'] || req.headers?.['fastly-client-ip'] || req.headers?.['true-client-ip'];
  if (realIp) {
    return String(realIp).trim().replace(/^::ffff:/, '');
  }

  // 2. Express req.ip or socket connection IP
  let rawIp = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
  rawIp = String(rawIp).replace(/^::ffff:/, '');
  if (rawIp === '::1') return '127.0.0.1';

  return rawIp;
}

async function logSystemAction(req, { action, entity_type = 'GENERAL', entity_id = null, remarks = '', status = 'SUCCESS' }) {
  try {
    const actorId = req?.user?.id || null;
    const actorName = req?.user?.name || (actorId ? 'System User' : 'Guest / Visitor');
    const actorRole = req?.user?.role || 'SYSTEM';
    const ipAddress = extractClientIp(req);

    const maxIdRes = await db.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM audit_logs');
    const nextId = parseInt(maxIdRes.rows[0].next_id, 10);
    const logGuid = `AUD-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    await db.query(
      `INSERT INTO audit_logs (id, guid, actor_id, actor_name, actor_role, action, entity_type, entity_id, ip_address, status, remarks, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)`,
      [nextId, logGuid, actorId, actorName, actorRole, action, entity_type, entity_id, String(ipAddress), status, remarks]
    );
  } catch (err) {
    console.error('[Audit Logger Error]: Failed to write audit log:', err.message || err);
  }
}

module.exports = { logSystemAction, extractClientIp };
