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
      ADD COLUMN IF NOT EXISTS vehicle_no VARCHAR(100),
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

      // Clean up any duplicate ON_DUTY records for the same guard on the same device
      try {
        await db.query(`
          UPDATE device_duty_sessions
          SET status = 'OFF_DUTY', checked_out_at = CURRENT_TIMESTAMP
          WHERE id NOT IN (
            SELECT DISTINCT ON (UPPER(device_id), guard_id) id
            FROM device_duty_sessions
            WHERE status = 'ON_DUTY'
            ORDER BY UPPER(device_id), guard_id, checked_in_at DESC
          ) AND status = 'ON_DUTY';
        `);
      } catch (cleanupErr) {
        console.warn('[AutoMigration Notice] Duty session deduplication notice:', cleanupErr.message);
      }

      // Ensure at least one sample active duty session exists for DEV-NORTH-01
      const checkDuty = await db.query(`SELECT id FROM device_duty_sessions WHERE UPPER(device_id) = 'DEV-NORTH-01' AND status = 'ON_DUTY'`);
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
    // 12. Seed Sample Invited Visitors Arriving Today (+8 Hours Window)
      console.log('[AutoMigration] Refreshing/seeding realistic sample invited visitors for today (+8h window)...');

      const sampleVisitors = [
          {
            name: 'Gayatri Devi (Family Devotee)',
            phone: '+91 9876543221',
            email: 'gayatri.devi@ashramdevotee.org',
            gender: 'Female',
            photo_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
            id_card_number: '9876-1122-3344',
            visitor_category: 'GENERAL',
            vehicle_no: 'KA-01-AB-1234',
            pass_code: 'PASS-INV-8821',
            host_id: 1, // Srinivas Rao
            purpose: 'Darshan, Bhajan & Family Meeting with Resident Host',
            visit_type: 'HOME',
            valid_from_offset_hours: 1, // 1 hour from now
            valid_until_offset_hours: 6,
            status: 'APPROVED',
            lifecycle_status: 'Yet to Arrive',
            presence_status: 'currently_outside',
            men: 2, women: 2, kids: 1, total: 5
          },
          {
            name: 'Dr. Raghavan Nair (Medical Consultant)',
            phone: '+91 9845112233',
            email: 'raghavan.nair@hospital.org',
            gender: 'Male',
            photo_url: 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=150',
            id_card_number: '8877-2233-4455',
            visitor_category: 'VIP',
            vehicle_no: 'KA-04-ME-5678',
            pass_code: 'PASS-INV-4512',
            host_id: 2, // Dr. Kumar
            purpose: 'Ashram Healthcare & Hospital Consultation',
            visit_type: 'OFFICE',
            valid_from_offset_hours: 3, // 3 hours from now
            valid_until_offset_hours: 8,
            status: 'APPROVED',
            lifecycle_status: 'Yet to Arrive',
            presence_status: 'currently_outside',
            men: 1, women: 1, kids: 0, total: 2
          },
          {
            name: 'Srikanth Varma (Invited Devotee)',
            phone: '+91 9886007788',
            email: 'srikanth.varma@devotee.org',
            gender: 'Male',
            photo_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
            id_card_number: '7766-3344-5566',
            visitor_category: 'GENERAL',
            vehicle_no: 'KA-53-Z-9009',
            pass_code: 'PASS-INV-9904',
            host_id: 1, // Srinivas Rao
            purpose: 'Ashram Seva & Temple Darshan',
            visit_type: 'HOME',
            valid_from_offset_hours: -0.5, // Arrived 30 mins ago
            valid_until_offset_hours: 5,
            status: 'APPROVED',
            lifecycle_status: 'Yet to Arrive',
            presence_status: 'currently_outside',
            men: 1, women: 0, kids: 0, total: 1
          },
          {
            name: 'Meenakshi Sundaram (Checked-In Guest)',
            phone: '+91 9448113355',
            email: 'meenakshi.s@ashramtrust.org',
            gender: 'Female',
            photo_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
            id_card_number: '6655-4455-6677',
            visitor_category: 'GENERAL',
            vehicle_no: 'KA-05-NB-7711',
            pass_code: 'PASS-INV-3355',
            host_id: 3, // Swami Nathan
            purpose: 'Spiritual Discourses & Library Research',
            visit_type: 'OFFICE',
            valid_from_offset_hours: -2, // Entered 2 hours ago
            valid_until_offset_hours: 4,
            status: 'INSIDE_CAMPUS',
            lifecycle_status: 'CHECKED-IN',
            presence_status: 'currently_inside',
            men: 2, women: 1, kids: 1, total: 4
          },
          {
            name: 'Rajeshwari Patel (Re-entry Guest)',
            phone: '+91 9900224466',
            email: 'rajeshwari.patel@guest.org',
            gender: 'Female',
            photo_url: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=150',
            id_card_number: '5544-5566-7788',
            visitor_category: 'GENERAL',
            vehicle_no: 'KA-03-MK-3322',
            pass_code: 'PASS-INV-4466',
            host_id: 1, // Srinivas Rao
            purpose: 'Resident Family Lunch & Afternoon Bhajans',
            visit_type: 'HOME',
            valid_from_offset_hours: -3,
            valid_until_offset_hours: 3,
            status: 'APPROVED',
            lifecycle_status: 'CHECKED-IN',
            presence_status: 'currently_outside',
            men: 1, women: 1, kids: 0, total: 2
          }
        ];

        for (const item of sampleVisitors) {
          let vId;
          const vCheck = await db.query('SELECT id FROM visitors WHERE phone = $1 OR full_name = $2', [item.phone, item.name]);
          if (vCheck.rows.length > 0) {
            vId = vCheck.rows[0].id;
            await db.query(
              'UPDATE visitors SET full_name = $1, vehicle_no = $2, visitor_category = $3 WHERE id = $4',
              [item.name, item.vehicle_no, item.visitor_category, vId]
            );
          } else {
            const maxV = await db.query('SELECT COALESCE(MAX(id), 500) as max_id FROM visitors');
            const nextVId = Math.max(500, parseInt(maxV.rows[0].max_id, 10)) + 1;
            try {
              const insV = await db.query(
                `INSERT INTO visitors (id, full_name, phone, email, gender, photo_url, id_type, id_number, id_card_number, visitor_category, vehicle_no)
                 VALUES ($1, $2, $3, $4, $5, $6, 'Aadhaar', $7, $7, $8, $9) RETURNING id`,
                [nextVId, item.name, item.phone, item.email, item.gender, item.photo_url, item.id_card_number, item.visitor_category, item.vehicle_no]
              );
              vId = insV.rows[0].id;
            } catch (insVErr) {
              const recV = await db.query('SELECT id FROM visitors WHERE phone = $1 OR full_name = $2', [item.phone, item.name]);
              if (recV.rows.length > 0) vId = recV.rows[0].id;
            }
          }

          if (!vId) continue;

          const validFrom = new Date(Date.now() + item.valid_from_offset_hours * 3600000);
          const validUntil = new Date(Date.now() + item.valid_until_offset_hours * 3600000);

          const rCheck = await db.query('SELECT id FROM registrations WHERE pass_code = $1', [item.pass_code]);
          if (rCheck.rows.length > 0) {
            await db.query(
              `UPDATE registrations 
               SET valid_from = $1, valid_until = $2, status = $3, lifecycle_status = $4, presence_status = $5, vehicle_no = $6
               WHERE id = $7`,
              [validFrom, validUntil, item.status, item.lifecycle_status, item.presence_status, item.vehicle_no, rCheck.rows[0].id]
            );
          } else {
            const maxR = await db.query('SELECT COALESCE(MAX(id), 500) as max_id FROM registrations');
            const nextRId = Math.max(500, parseInt(maxR.rows[0].max_id, 10)) + 1;
            await db.query(
              `INSERT INTO registrations (
                id, visitor_id, host_id, purpose, registration_mode, registration_type, visit_type,
                stay_required, accommodation_approved, priority, status, pass_code, valid_from, valid_until,
                adult_men_count, adult_women_count, children_count, boys_count, girls_count, person_count,
                lifecycle_status, presence_status, vehicle_no
              ) VALUES (
                $1, $2, $3, $4, 'Single', 'PRE_APPROVAL', $5,
                false, false, 'P2', $6, $7, $8, $9,
                $10, $11, $12, 0, 0, $13,
                $14, $15, $16
              )`,
              [
                nextRId, vId, item.host_id, item.purpose, item.visit_type,
                item.status, item.pass_code, validFrom, validUntil,
                item.men, item.women, item.kids, item.total,
                item.lifecycle_status, item.presence_status, item.vehicle_no
              ]
            );
          }
        }
        console.log('[AutoMigration] Successfully seeded sample invited visitors for today!');
    } catch (seedInvErr) {
      console.error('[AutoMigration Notice] Error seeding sample invited visitors:', seedInvErr.message || seedInvErr);
    }

    console.log('[AutoMigration] All DB auto-migrations and seeds completed successfully!');
    return true;
  } catch (err) {
    console.error('[AutoMigration Error] Failed executing schema auto-migrations:', err.message);
    return false;
  }
}

module.exports = runAutoMigrations;
