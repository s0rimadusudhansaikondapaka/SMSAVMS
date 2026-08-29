const db = require('../config/db');

async function initFamilyMembersTable() {
  try {
    console.log('[Migration] Creating resident_family_members table and adding contact columns...');
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS resident_family_members (
        id SERIAL PRIMARY KEY,
        resident_id INT REFERENCES users(id) ON DELETE CASCADE,
        full_name VARCHAR(255) NOT NULL,
        relationship VARCHAR(100) NOT NULL,
        phone VARCHAR(50),
        photo_url TEXT,
        id_card_number VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      ALTER TABLE resident_family_members 
      ADD COLUMN IF NOT EXISTS is_pro_approved BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS pro_approved_by INT,
      ADD COLUMN IF NOT EXISTS pro_approved_at TIMESTAMP;

      ALTER TABLE registrations 
      ADD COLUMN IF NOT EXISTS family_member_id INT,
      ADD COLUMN IF NOT EXISTS relationship_to_resident VARCHAR(100);

      INSERT INTO system_settings (key, value)
      VALUES ('REQUIRE_FIRST_TIME_FAMILY_PRO_APPROVAL', 'true')
      ON CONFLICT (key) DO NOTHING;
    `);

    console.log('[Migration] resident_family_members table & columns initialized successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Migration] Failed to initialize family members table:', err);
    process.exit(1);
  }
}

initFamilyMembersTable();
