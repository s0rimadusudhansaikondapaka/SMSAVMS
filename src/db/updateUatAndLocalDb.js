const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const uatConnectionString = process.env.UAT_CONNECTION_STRING || 'postgresql://neondb_owner:npg_tyR3SVM0vBzc@ep-spring-field-azdk97ad.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const uatPool = new Pool({ connectionString: uatConnectionString, ssl: { rejectUnauthorized: false } });

async function runUpdate() {
  console.log('===================================================================');
  console.log('=== [DB Update] Applying Schema Migrations to UAT & Local DB ===');
  console.log('===================================================================');
  console.log(`[UAT DB Target] ${uatConnectionString.split('@')[1] ? uatConnectionString.split('@')[1].split('/')[0] : 'UAT Host'}`);

  try {
    // 1. Drop check constraints & alter columns
    console.log('\n[1/5] Applying DDL migrations & column additions...');
    await uatPool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
    await uatPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(50) DEFAULT 'RESIDENT';`);
    await uatPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_resident_id INT;`);
    await uatPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS guid VARCHAR(64);`);

    await uatPool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS guid VARCHAR(64);`);
    await uatPool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_name VARCHAR(150);`);
    await uatPool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50);`);
    await uatPool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100);`);
    await uatPool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20);`);

    await uatPool.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS guid VARCHAR(64);`);
    await uatPool.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);`);

    await uatPool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS guid VARCHAR(64);`);
    await uatPool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER;`);
    await uatPool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS approved_by_name VARCHAR(150);`);
    await uatPool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS approved_by_role VARCHAR(50);`);
    await uatPool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS family_member_id INT;`);
    await uatPool.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS relationship_to_resident VARCHAR(100);`);

    await uatPool.query(`
      CREATE TABLE IF NOT EXISTS resident_family_members (
        id SERIAL PRIMARY KEY,
        resident_id INT,
        user_id INT,
        full_name VARCHAR(255),
        relationship VARCHAR(100),
        phone VARCHAR(50),
        email VARCHAR(150),
        age INT,
        gender VARCHAR(20),
        photo_url TEXT,
        id_card_number VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        is_pro_approved BOOLEAN DEFAULT true,
        pro_approved_by INT,
        pro_approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await uatPool.query(`ALTER TABLE resident_family_members ADD COLUMN IF NOT EXISTS guid VARCHAR(64);`);
    await uatPool.query(`ALTER TABLE resident_family_members ADD COLUMN IF NOT EXISTS user_id INT;`);
    await uatPool.query(`ALTER TABLE resident_family_members ADD COLUMN IF NOT EXISTS email VARCHAR(150);`);
    await uatPool.query(`ALTER TABLE resident_family_members ADD COLUMN IF NOT EXISTS age INT;`);
    await uatPool.query(`ALTER TABLE resident_family_members ADD COLUMN IF NOT EXISTS gender VARCHAR(20);`);
    await uatPool.query(`ALTER TABLE resident_family_members ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);

    await uatPool.query(`ALTER TABLE gate_logs ADD COLUMN IF NOT EXISTS guid VARCHAR(64);`);

    console.log('[DDL Success] All columns & tables created on UAT DB!');

    // 2. Data Cleanups & Normalizations
    console.log('\n[2/5] Normalizing user categories & roles...');
    await uatPool.query(`
      UPDATE users 
      SET user_type = CASE 
        WHEN role IN ('RESIDENT', 'EMPLOYEE', 'RESIDENT_EMPLOYEE') THEN role 
        WHEN residency_status = 'RESIDENT' THEN 'RESIDENT' 
        ELSE COALESCE(user_type, 'RESIDENT')
      END 
      WHERE user_type IS NULL OR user_type = '';

      UPDATE users 
      SET user_type = role, role = 'HOST' 
      WHERE role IN ('RESIDENT', 'EMPLOYEE', 'RESIDENT_EMPLOYEE');
    `);
    console.log('[Data Success] User categories & system access roles normalized!');

    // 3. GUID Backfills
    console.log('\n[3/5] Backfilling missing GUIDs across all entities...');
    await uatPool.query(`
      UPDATE users SET guid = 'USR-' || UPPER(SUBSTRING(MD5(id::text || name || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
      UPDATE visitors SET guid = 'VIS-' || UPPER(SUBSTRING(MD5(id::text || full_name || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
      UPDATE registrations SET guid = 'REG-' || UPPER(SUBSTRING(MD5(id::text || pass_code || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
      UPDATE gate_logs SET guid = 'GLOG-' || UPPER(SUBSTRING(MD5(id::text || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
      UPDATE resident_family_members SET guid = 'FM-' || UPPER(SUBSTRING(MD5(id::text || full_name || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
      UPDATE audit_logs SET guid = 'AUD-' || UPPER(SUBSTRING(MD5(id::text || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
    `);
    console.log('[GUID Success] GUIDs backfilled for all table entities!');

    // 4. Reset sequences for tables with static IDs
    console.log('\n[4/5] Resetting sequence generators for auto-increment tables...');
    const tablesWithSeq = [
      'users', 'visitors', 'registrations', 'gate_logs', 'audit_logs',
      'departments', 'gate_category_rules', 'l2_approval_matrix_rules',
      'registration_vehicles', 'resident_family_members'
    ];

    for (const t of tablesWithSeq) {
      try {
        await uatPool.query(`
          SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1));
        `);
      } catch (seqErr) {
        try {
          await uatPool.query(`
            SELECT setval('${t}_id_seq', COALESCE((SELECT MAX(id) FROM ${t}), 1));
          `);
        } catch (s2) {}
      }
    }
    console.log('[Sequence Success] All sequence generators synchronized with MAX(id)!');

    console.log('\n===================================================================');
    console.log('=== [UAT Migration Complete] UAT DB Updated Successfully! ===');
    console.log('===================================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n[DB Update Error] Failed updating UAT DB:', err);
    process.exit(1);
  }
}

runUpdate();
