const db = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function fixPasswords() {
  console.log('[Password Fix] Generating genuine bcrypt hash for password123...');
  const genuineHash = await bcrypt.hash('password123', 10);
  console.log('[Password Fix] Generated genuine hash:', genuineHash);

  const query = `
    UPDATE users 
    SET password_hash = $1 
    WHERE password_hash = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW'
       OR password_hash = '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW'
       OR email IN ('resident1@ashram.org', 'admin@ashram.org', 'guard1@ashram.org', 'supervisor1@ashram.org', 'securityhead@ashram.org', 'employee1@ashram.org', 'viphost1@ashram.org', 'pro1@ashram.org', 'resident_employee1@ashram.org', 'resident_vip1@ashram.org', 'employee_vip1@ashram.org', 'resident_emp_vip1@ashram.org', 'guard2@ashram.org', 'guard3@ashram.org');
  `;

  const res = await db.query(query, [genuineHash]);
  console.log(`[Password Fix] Successfully updated ${res.rowCount} users with genuine bcrypt hash for 'password123'.`);
  process.exit(0);
}

fixPasswords().catch(err => {
  console.error('[Password Fix Error]:', err);
  process.exit(1);
});
