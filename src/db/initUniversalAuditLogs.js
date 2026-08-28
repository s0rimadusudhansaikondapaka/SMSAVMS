const db = require('../config/db');

async function initUniversalAuditLogs() {
  try {
    console.log('[DB Migration] Expanding audit_logs table schema for universal audit tracking...');

    await db.query(`
      ALTER TABLE audit_logs 
      ADD COLUMN IF NOT EXISTS actor_name VARCHAR(150),
      ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50),
      ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100),
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'SUCCESS';
    `);

    // Backfill actor_name and actor_role from users table where actor_id exists
    await db.query(`
      UPDATE audit_logs
      SET actor_name = users.name,
          actor_role = users.role
      FROM users
      WHERE audit_logs.actor_id = users.id AND audit_logs.actor_name IS NULL;
    `);

    console.log('[DB Migration] audit_logs table expanded and backfilled successfully!');
  } catch (err) {
    console.error('[DB Migration Error]:', err);
  }
}

if (require.main === module) {
  initUniversalAuditLogs().then(() => process.exit(0));
}

module.exports = initUniversalAuditLogs;
