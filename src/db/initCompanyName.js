const db = require('../config/db');

async function initCompanyName() {
  try {
    console.log('[Migration] Adding company_name column to visitors table...');
    await db.query(`
      ALTER TABLE visitors 
      ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
    `);
    console.log('[Migration] company_name column added successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Migration] Failed to add company_name column:', err);
    process.exit(1);
  }
}

initCompanyName();
