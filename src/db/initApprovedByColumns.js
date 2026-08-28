const db = require('../config/db');

async function initApprovedByColumns() {
  try {
    console.log('[DB Migration] Adding approved_by columns to registrations table...');

    await db.query(`
      ALTER TABLE registrations 
      ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER,
      ADD COLUMN IF NOT EXISTS approved_by_name VARCHAR(150),
      ADD COLUMN IF NOT EXISTS approved_by_role VARCHAR(50);
    `);

    // Backfill existing approved registrations from audit_logs where possible
    await db.query(`
      UPDATE registrations r
      SET approved_by_name = app.name,
          approved_by_role = app.role,
          approved_by_user_id = app.id
      FROM (
        SELECT DISTINCT ON (al.entity_id) 
               al.entity_id, u.id, u.name, u.role
        FROM audit_logs al
        JOIN users u ON al.actor_id = u.id
        WHERE al.action LIKE '%APPROVE%' OR al.action LIKE '%CREATE_REGISTRATION%'
        ORDER BY al.entity_id, al.id DESC
      ) app
      WHERE r.id = app.entity_id AND r.status IN ('APPROVED', 'INSIDE_CAMPUS', 'CHECKED_OUT') AND r.approved_by_name IS NULL;
    `);

    console.log('[DB Migration] approved_by columns added and backfilled successfully!');
  } catch (err) {
    console.error('[DB Migration Error]:', err);
  }
}

if (require.main === module) {
  initApprovedByColumns().then(() => process.exit(0));
}

module.exports = initApprovedByColumns;
