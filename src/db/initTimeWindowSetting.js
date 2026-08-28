const db = require('../config/db');

async function initTimeWindowSetting() {
  try {
    console.log('[Migration] Seeding PASS_TIME_WINDOW_GRACE_HOURS setting...');
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key VARCHAR(100),
          value VARCHAR(255),
          description TEXT,
          updated_at TIMESTAMP
        );
      `);
    } catch (e) {}

    await db.query(`
      INSERT INTO system_settings (key, value, description)
      VALUES ('PASS_TIME_WINDOW_GRACE_HOURS', '8', 'Grace period in hours before/after arrival and departure time windows')
    `);

    console.log('[Migration] PASS_TIME_WINDOW_GRACE_HOURS set to 8 hours!');
    process.exit(0);
  } catch (err) {
    // If key already exists
    console.log('[Migration] Setting already initialized or inserted.');
    process.exit(0);
  }
}

initTimeWindowSetting();
