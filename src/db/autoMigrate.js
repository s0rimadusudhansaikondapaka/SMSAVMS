const db = require('../config/db');

/**
 * Idempotent DB Auto-migration Runner
 * Ensures missing tables, columns, and seeds are automatically created on server boot.
 * Written with clean portable DDL compatible with PostgreSQL and pg-mem engines.
 */
async function runAutoMigrations() {
  try {
    console.log('[AutoMigration] Running database schema auto-migrations...');

    // 0. Drop strict users_role_check constraint and add user_type column
    try {
      await db.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
      await db.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS user_type VARCHAR(50) DEFAULT 'RESIDENT';
      `);
      await db.query(`
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
    } catch (rErr) {}

    // Sync sequence generators for tables seeded with explicit IDs
    const tablesWithSeq = [
      'users', 'visitors', 'registrations', 'gate_logs', 'audit_logs',
      'departments', 'gate_category_rules', 'l2_approval_matrix_rules',
      'registration_vehicles', 'resident_family_members', 'resident_absences', 'approvers_config'
    ];

    for (const t of tablesWithSeq) {
      try {
        await db.query(`
          SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1));
        `);
      } catch (seqErr) {
        try {
          await db.query(`
            SELECT setval('${t}_id_seq', COALESCE((SELECT MAX(id) FROM ${t}), 1));
          `);
        } catch (s2) {}
      }
    }

    // 1. Audit Logs Columns & GUID
    await db.query(`
      ALTER TABLE audit_logs 
      ADD COLUMN IF NOT EXISTS guid VARCHAR(64),
      ADD COLUMN IF NOT EXISTS actor_name VARCHAR(150),
      ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50),
      ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100),
      ADD COLUMN IF NOT EXISTS status VARCHAR(20);
    `);

    // 2. Visitors Table Columns & GUID
    await db.query(`
      ALTER TABLE visitors 
      ADD COLUMN IF NOT EXISTS guid VARCHAR(64),
      ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
    `);

    // 3. Registrations Table Columns & GUID
    await db.query(`
      ALTER TABLE registrations 
      ADD COLUMN IF NOT EXISTS guid VARCHAR(64),
      ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER,
      ADD COLUMN IF NOT EXISTS approved_by_name VARCHAR(150),
      ADD COLUMN IF NOT EXISTS approved_by_role VARCHAR(50),
      ADD COLUMN IF NOT EXISTS family_member_id INT,
      ADD COLUMN IF NOT EXISTS relationship_to_resident VARCHAR(100);
    `);

    // 4. Resident Family Members Table
    await db.query(`
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

      ALTER TABLE resident_family_members 
      ADD COLUMN IF NOT EXISTS user_id INT,
      ADD COLUMN IF NOT EXISTS email VARCHAR(150),
      ADD COLUMN IF NOT EXISTS age INT,
      ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS primary_resident_id INT;
    `);

    // 5. System Settings Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(100),
        value VARCHAR(255),
        description TEXT,
        updated_at TIMESTAMP
      );
    `);

    // 6. L2 Approval Matrix Rules Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS l2_approval_matrix_rules (
        id SERIAL PRIMARY KEY,
        host_category VARCHAR(50),
        visit_type_category VARCHAR(50),
        approver_type VARCHAR(50),
        is_enabled BOOLEAN,
        updated_at TIMESTAMP
      );
    `);

    // 7. Gate Category Rules Table & Direction Columns
    await db.query(`
      CREATE TABLE IF NOT EXISTS gate_category_rules (
        id SERIAL PRIMARY KEY,
        gate_name VARCHAR(100),
        visitor_category VARCHAR(50),
        is_allowed BOOLEAN,
        direction_mode VARCHAR(50) DEFAULT 'BOTH',
        allow_in BOOLEAN DEFAULT true,
        allow_out BOOLEAN DEFAULT true,
        updated_at TIMESTAMP
      );

      ALTER TABLE gate_category_rules 
      ADD COLUMN IF NOT EXISTS direction_mode VARCHAR(50) DEFAULT 'BOTH',
      ADD COLUMN IF NOT EXISTS allow_in BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS allow_out BOOLEAN DEFAULT true;
    `);

    // 8. Gate Direction Config Table (IN/OUT states configurable by Super Admin)
    await db.query(`
      CREATE TABLE IF NOT EXISTS gate_direction_config (
        gate_name VARCHAR(100),
        direction_mode VARCHAR(50),
        is_active BOOLEAN,
        updated_at TIMESTAMP
      );
    `);

    // Seed default L2 matrix rules
    const defaultL2Rules = [
      ['RESIDENT', 'RESIDENT_VISIT', 'DEPARTMENT_PRO'],
      ['RESIDENT', 'ASHRAM_VISIT', 'DEPARTMENT_PRO'],
      ['EMPLOYEE', 'EMPLOYEE_OFFICIAL_VISIT', 'SAME_DEPARTMENT_HOD'],
      ['EMPLOYEE', 'ASHRAM_VISIT', 'DEPARTMENT_PRO'],
      ['BOTH', 'RESIDENT_VISIT', 'DEPARTMENT_PRO'],
      ['BOTH', 'EMPLOYEE_OFFICIAL_VISIT', 'SAME_DEPARTMENT_HOD'],
      ['BOTH', 'ASHRAM_VISIT', 'DEPARTMENT_PRO'],
    ];

    for (const [hostCat, visitCat, approver] of defaultL2Rules) {
      try {
        const existing = await db.query(
          `SELECT id FROM l2_approval_matrix_rules WHERE host_category = $1 AND visit_type_category = $2`,
          [hostCat, visitCat]
        );
        if (existing.rows.length === 0) {
          await db.query(`
            INSERT INTO l2_approval_matrix_rules (host_category, visit_type_category, approver_type, is_enabled)
            VALUES ($1, $2, $3, true);
          `, [hostCat, visitCat, approver]);
        }
      } catch (e) {}
    }

    // Seed default gate direction states
    const defaultGateDirections = [
      ['NORTH_GATE', 'BOTH'],
      ['SOUTH_GATE', 'BOTH'],
      ['EAST_GATE', 'BOTH'],
      ['WEST_GATE', 'BOTH'],
      ['STAFF_GATE', 'BOTH'],
    ];

    for (const [gateName, mode] of defaultGateDirections) {
      try {
        const existing = await db.query(
          `SELECT gate_name FROM gate_direction_config WHERE gate_name = $1`,
          [gateName]
        );
        if (existing.rows.length === 0) {
          await db.query(`
            INSERT INTO gate_direction_config (gate_name, direction_mode, is_active)
            VALUES ($1, $2, true);
          `, [gateName, mode]);
        }
      } catch (e) {}
    }

    // Seed default system settings
    const defaultSettings = [
      ['L2_APPROVAL_ENABLED', 'true', 'Enable multi-tier L2 approval matrix routing'],
      ['REQUIRE_FIRST_TIME_FAMILY_PRO_APPROVAL', 'true', 'Require PRO approval for first time resident family members'],
      ['PASS_TIME_WINDOW_GRACE_HOURS', '8', 'Grace period in hours before/after arrival and departure time windows']
    ];

    for (const [sKey, sVal, sDesc] of defaultSettings) {
      try {
        const existing = await db.query(
          `SELECT key FROM system_settings WHERE key = $1`,
          [sKey]
        );
        if (existing.rows.length === 0) {
          await db.query(`
            INSERT INTO system_settings (key, value, description)
            VALUES ($1, $2, $3);
          `, [sKey, sVal, sDesc]);
        }
      } catch (e) {}
    }

    // 8. Backfill GUIDs for all entities where guid is NULL or empty
    try {
      await db.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS guid VARCHAR(64);
        ALTER TABLE visitors ADD COLUMN IF NOT EXISTS guid VARCHAR(64);
        ALTER TABLE registrations ADD COLUMN IF NOT EXISTS guid VARCHAR(64);
        ALTER TABLE gate_logs ADD COLUMN IF NOT EXISTS guid VARCHAR(64);
        ALTER TABLE resident_family_members ADD COLUMN IF NOT EXISTS guid VARCHAR(64);
        ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS guid VARCHAR(64);

        UPDATE users SET guid = 'USR-' || UPPER(SUBSTRING(MD5(id::text || name || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
        UPDATE visitors SET guid = 'VIS-' || UPPER(SUBSTRING(MD5(id::text || full_name || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
        UPDATE registrations SET guid = 'REG-' || UPPER(SUBSTRING(MD5(id::text || pass_code || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
        UPDATE gate_logs SET guid = 'GLOG-' || UPPER(SUBSTRING(MD5(id::text || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
        UPDATE resident_family_members SET guid = 'FM-' || UPPER(SUBSTRING(MD5(id::text || full_name || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
        UPDATE audit_logs SET guid = 'AUD-' || UPPER(SUBSTRING(MD5(id::text || random()::text) FROM 1 FOR 12)) WHERE guid IS NULL OR guid = '';
      `);
    } catch (gErr) {}

    console.log('[AutoMigration] All DB auto-migrations and seeds completed successfully!');
    return true;
  } catch (err) {
    console.error('[AutoMigration Error] Failed executing schema auto-migrations:', err.message);
    return false;
  }
}

module.exports = runAutoMigrations;
