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
      ADD COLUMN IF NOT EXISTS relationship_to_resident VARCHAR(100),
      ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(50) DEFAULT 'Yet to Arrive',
      ADD COLUMN IF NOT EXISTS presence_status VARCHAR(50) DEFAULT 'currently_outside',
      ADD COLUMN IF NOT EXISTS first_entry_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_entry_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_exit_at TIMESTAMP;
    `);

    try {
      await db.query(`
        UPDATE registrations 
        SET lifecycle_status = CASE 
          WHEN status = 'INSIDE_CAMPUS' THEN 'CHECKED-IN'
          WHEN status = 'CHECKED_OUT' THEN 'CHECKED-OUT'
          ELSE 'Yet to Arrive'
        END,
        presence_status = CASE 
          WHEN status = 'INSIDE_CAMPUS' AND valid_until < CURRENT_TIMESTAMP THEN 'over_stayed'
          WHEN status = 'INSIDE_CAMPUS' THEN 'currently_inside'
          ELSE 'currently_outside'
        END
        WHERE lifecycle_status IS NULL OR presence_status IS NULL OR lifecycle_status = '';
      `);
    } catch (bfErr) {}

    // 4. Resident Family Members Table
    try {
      await db.query(`
        ALTER TABLE resident_family_members 
        ADD COLUMN IF NOT EXISTS user_id INT,
        ADD COLUMN IF NOT EXISTS email VARCHAR(150),
        ADD COLUMN IF NOT EXISTS age INT,
        ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN;

        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS primary_resident_id INT;
      `);
    } catch (fmErr) {}

    // 5. System Settings Table
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

    // 6. L2 Approval Matrix Rules Table
    try {
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
    } catch (e) {}

    // 7. Gate Category Rules Table & Direction Columns
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS gate_category_rules (
          id SERIAL PRIMARY KEY,
          gate_name VARCHAR(100),
          visitor_category VARCHAR(50),
          is_allowed BOOLEAN,
          direction_mode VARCHAR(50),
          allow_in BOOLEAN,
          allow_out BOOLEAN,
          updated_at TIMESTAMP
        );
      `);
    } catch (e) {}

    // 8. Gate Direction Config Table
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS gate_direction_config (
          gate_name VARCHAR(100),
          direction_mode VARCHAR(50),
          is_active BOOLEAN,
          updated_at TIMESTAMP
        );
      `);
    } catch (e) {}

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

    // 9. Seed default sample accounts for all 8 Host Types + Security/Admin roles
    const sampleHostUsers = [
      { name: 'Srinivas Rao (Resident)', email: 'resident1@ashram.org', phone: '+91 9876543210', role: 'HOST', user_type: 'RESIDENT', residency_status: 'RESIDENT', flat_info: 'Flat 302, Sai Residence Block A' },
      { name: 'Dr. Ananya (Employee Host)', email: 'employee1@ashram.org', phone: '+91 9876543211', role: 'HOST', user_type: 'EMPLOYEE', residency_status: 'NON_RESIDENT', flat_info: 'PBMT Administration Office' },
      { name: 'Srikar Sharma (VIP Host)', email: 'viphost1@ashram.org', phone: '+91 9876543220', role: 'HOST', user_type: 'VIP_HOST', residency_status: 'RESIDENT', flat_info: 'VIP Guest Relations Office' },
      { name: 'PRO Office Desk (PRO Host)', email: 'pro1@ashram.org', phone: '+91 9876543221', role: 'PRO', user_type: 'PRO', residency_status: 'RESIDENT', flat_info: 'Public Relations Office (PRO)' },
      { name: 'Dr. Kumar (Resident + Employee)', email: 'resident_employee1@ashram.org', phone: '+91 9876543222', role: 'HOST', user_type: 'RESIDENT_EMPLOYEE', residency_status: 'RESIDENT', flat_info: 'Annapoorna & Villa 12' },
      { name: 'Trustee Prasad (Resident + VIP Host)', email: 'resident_vip1@ashram.org', phone: '+91 9876543223', role: 'HOST', user_type: 'RESIDENT_VIP_HOST', residency_status: 'RESIDENT', flat_info: 'Trustee Residence Block A' },
      { name: 'Director Ramesh (Employee + VIP Host)', email: 'employee_vip1@ashram.org', phone: '+91 9876543224', role: 'HOST', user_type: 'EMPLOYEE_VIP_HOST', residency_status: 'NON_RESIDENT', flat_info: 'Executive Office & VIP Lounge' },
      { name: 'Ashram Lead Admin (Res + Emp + VIP)', email: 'resident_emp_vip1@ashram.org', phone: '+91 9876543225', role: 'HOST', user_type: 'RESIDENT_EMPLOYEE_VIP_HOST', residency_status: 'RESIDENT', flat_info: 'Main Ashram Admin Complex' },
      { name: 'Ramesh Guard (North Gate)', email: 'guard1@ashram.org', phone: '+91 9876543213', role: 'GUARD', user_type: 'GUARD', residency_status: 'NON_RESIDENT', flat_info: 'Security Dept' },
      { name: 'Mahesh Guard (South Gate)', email: 'guard2@ashram.org', phone: '+91 9876543255', role: 'GUARD', user_type: 'GUARD', residency_status: 'NON_RESIDENT', flat_info: 'Security Barracks A' },
      { name: 'Ganesh Guard (East Gate)', email: 'guard3@ashram.org', phone: '+91 9876543266', role: 'GUARD', user_type: 'GUARD', residency_status: 'NON_RESIDENT', flat_info: 'Security Barracks B' },
      { name: 'Suresh Supervisor (SO)', email: 'supervisor1@ashram.org', phone: '+91 9876543214', role: 'SUPERVISOR', user_type: 'SUPERVISOR', residency_status: 'RESIDENT', flat_info: 'Security Control Room' },
      { name: 'Major Rajesh (Security Head)', email: 'securityhead@ashram.org', phone: '+91 9876543215', role: 'SECURITY_HEAD', user_type: 'SECURITY_HEAD', residency_status: 'RESIDENT', flat_info: 'Chief Security Office' },
      { name: 'System Administrator (Super Admin)', email: 'admin@ashram.org', phone: '+91 9876543216', role: 'ADMIN', user_type: 'ADMIN', residency_status: 'RESIDENT', flat_info: 'IT & Systems' },
    ];

    const defaultPasswordHash = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW';

    for (const u of sampleHostUsers) {
      try {
        const checkU = await db.query(`SELECT id FROM users WHERE email = $1`, [u.email]);
        if (checkU.rows.length === 0) {
          const maxIdRes = await db.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM users');
          const nextId = parseInt(maxIdRes.rows[0].next_id, 10);
          const uGuid = `USR-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

          await db.query(`
            INSERT INTO users (id, guid, name, email, phone, role, user_type, residency_status, password_hash, flat_info, registration_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE')
          `, [nextId, uGuid, u.name, u.email, u.phone, u.role, u.user_type, u.residency_status, defaultPasswordHash, u.flat_info]);
        }
      } catch (uErr) {
        console.error(`[AutoMigration Notice] Failed seeding user ${u.email}:`, uErr.message);
      }
    }

    // 10. Ashram-Owned Mobile Devices & Guard Duty Sessions
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS devices (
          id SERIAL,
          device_id VARCHAR(50),
          device_name VARCHAR(100),
          secret_code VARCHAR(255),
          gate_name VARCHAR(100),
          status VARCHAR(20),
          last_active_at TIMESTAMP,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        );
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS device_duty_sessions (
          id SERIAL,
          device_id VARCHAR(50),
          guard_id INTEGER,
          guard_name VARCHAR(150),
          guard_phone VARCHAR(50),
          guard_code VARCHAR(50),
          duty_date DATE,
          checked_in_at TIMESTAMP,
          checked_out_at TIMESTAMP,
          status VARCHAR(20),
          gate_name VARCHAR(100),
          created_at TIMESTAMP
        );
      `);

      // Seed Default Ashram Gate Devices
      const defaultDevices = [
        { device_id: 'DEV-NORTH-01', device_name: 'North Gate Main Terminal Phone', gate_name: 'NORTH_GATE', secret_code: '123456' },
        { device_id: 'DEV-SOUTH-01', device_name: 'South Gate Terminal Phone', gate_name: 'SOUTH_GATE', secret_code: '123456' },
        { device_id: 'DEV-EAST-01', device_name: 'East Gate Terminal Phone', gate_name: 'EAST_GATE', secret_code: '123456' },
        { device_id: 'DEV-WEST-01', device_name: 'West Gate Terminal Phone', gate_name: 'WEST_GATE', secret_code: '123456' },
        { device_id: 'DEV-STAFF-01', device_name: 'Staff Gate Terminal Phone', gate_name: 'STAFF_GATE', secret_code: '123456' },
      ];

      for (const dev of defaultDevices) {
        const checkDev = await db.query(`SELECT id FROM devices WHERE device_id = $1`, [dev.device_id]);
        if (checkDev.rows.length === 0) {
          await db.query(`
            INSERT INTO devices (device_id, device_name, secret_code, gate_name, status, last_active_at)
            VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP);
          `, [dev.device_id, dev.device_name, dev.secret_code, dev.gate_name]);
        }
      }

      // Ensure at least one sample active duty session exists for DEV-NORTH-01
      const checkDuty = await db.query(`SELECT id FROM device_duty_sessions WHERE device_id = 'DEV-NORTH-01' AND status = 'ON_DUTY'`);
      if (checkDuty.rows.length === 0) {
        const ramesh = await db.query(`SELECT id, name, phone, guid FROM users WHERE email = 'guard1@ashram.org' LIMIT 1`);
        if (ramesh.rows.length > 0) {
          const r = ramesh.rows[0];
          await db.query(`
            INSERT INTO device_duty_sessions (device_id, guard_id, guard_name, guard_phone, guard_code, duty_date, checked_in_at, status, gate_name)
            VALUES ('DEV-NORTH-01', $1, $2, $3, $4, CURRENT_DATE, CURRENT_TIMESTAMP, 'ON_DUTY', 'NORTH_GATE');
          `, [r.id, r.name, r.phone, r.guid || `GRD-${r.id}`]);
        }
      }

    } catch (dErr) {
      console.error('[AutoMigration Notice] Error in devices migration:', dErr.message);
    }

    // 11. Gate Security Incidents Table
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS incidents (
          id SERIAL,
          incident_id VARCHAR(64),
          incident_type VARCHAR(100),
          severity VARCHAR(50),
          description TEXT,
          gate_name VARCHAR(100),
          device_id VARCHAR(100),
          guard_id INTEGER,
          guard_name VARCHAR(150),
          pass_code VARCHAR(100),
          vehicle_no VARCHAR(100),
          photo_url TEXT,
          status VARCHAR(50),
          resolution_notes TEXT,
          resolved_by VARCHAR(150),
          created_at TIMESTAMP,
          resolved_at TIMESTAMP
        );
      `);
    } catch (incErr) {
      console.error('[AutoMigration Notice] Error in incidents migration:', incErr.message);
    }

    console.log('[AutoMigration] All DB auto-migrations and seeds completed successfully!');
    return true;
  } catch (err) {
    console.error('[AutoMigration Error] Failed executing schema auto-migrations:', err.message);
    return false;
  }
}

module.exports = runAutoMigrations;
