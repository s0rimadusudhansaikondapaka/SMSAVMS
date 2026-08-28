const db = require('../config/db');

async function initL2ApprovalMatrix() {
  try {
    console.log('[DB Migration] Initializing L2 Approval Matrix Rules table...');

    await db.query(`
      CREATE TABLE IF NOT EXISTS l2_approval_matrix_rules (
        id SERIAL PRIMARY KEY,
        host_category VARCHAR(50) NOT NULL,
        visit_type_category VARCHAR(50) NOT NULL,
        approver_type VARCHAR(50) NOT NULL,
        is_enabled BOOLEAN DEFAULT true,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (host_category, visit_type_category)
      );
    `);

    // Seed default L2 rules as specified by user:
    // 1. Resident Host: Resident -> PRO, Ashram -> PRO
    // 2. Employee Host: Employee -> SAME_DEPARTMENT_HOD, Ashram -> PRO
    // 3. Both (Employee + Resident): Resident -> PRO, Employee -> SAME_DEPARTMENT_HOD, Ashram -> PRO
    const defaultRules = [
      ['RESIDENT', 'RESIDENT_VISIT', 'DEPARTMENT_PRO'],
      ['RESIDENT', 'ASHRAM_VISIT', 'DEPARTMENT_PRO'],
      ['EMPLOYEE', 'EMPLOYEE_OFFICIAL_VISIT', 'SAME_DEPARTMENT_HOD'],
      ['EMPLOYEE', 'ASHRAM_VISIT', 'DEPARTMENT_PRO'],
      ['BOTH', 'RESIDENT_VISIT', 'DEPARTMENT_PRO'],
      ['BOTH', 'EMPLOYEE_OFFICIAL_VISIT', 'SAME_DEPARTMENT_HOD'],
      ['BOTH', 'ASHRAM_VISIT', 'DEPARTMENT_PRO'],
    ];

    for (const [hostCat, visitCat, approver] of defaultRules) {
      await db.query(`
        INSERT INTO l2_approval_matrix_rules (host_category, visit_type_category, approver_type, is_enabled)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (host_category, visit_type_category) 
        DO UPDATE SET approver_type = EXCLUDED.approver_type, updated_at = CURRENT_TIMESTAMP;
      `, [hostCat, visitCat, approver]);
    }

    console.log('[DB Migration] L2 Approval Matrix Rules seeded successfully!');
  } catch (err) {
    console.error('[DB Migration Error]:', err);
  }
}

if (require.main === module) {
  initL2ApprovalMatrix().then(() => process.exit(0));
}

module.exports = initL2ApprovalMatrix;
