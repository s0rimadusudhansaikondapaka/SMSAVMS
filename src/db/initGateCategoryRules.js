const db = require('../config/db');

async function initGateCategoryRules() {
  try {
    console.log('[initGateCategoryRules] Creating table gate_category_rules if not exists...');
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS gate_category_rules (
          id SERIAL PRIMARY KEY,
          gate_name VARCHAR(50),
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

    const gates = ['NORTH_GATE', 'SOUTH_GATE', 'EAST_GATE', 'WEST_GATE', 'STAFF_GATE'];
    const categories = ['GENERAL', 'VVIP', 'VIP', 'VENDOR', 'CONTRACTOR', 'FOREIGN_NATIONAL', 'DELIVERY', 'CAB', 'MAID', 'FREQUENT_VISITOR'];

    console.log('[initGateCategoryRules] Seeding default rules for all gate-category matrix...');
    for (const gate of gates) {
      for (const cat of categories) {
        // By default all allowed, except DELIVERY on SOUTH_GATE for testing
        const defaultAllowed = !(gate === 'SOUTH_GATE' && cat === 'DELIVERY');
        const existing = await db.query(
          `SELECT id FROM gate_category_rules WHERE gate_name = $1 AND visitor_category = $2`,
          [gate, cat]
        );
        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO gate_category_rules (gate_name, visitor_category, is_allowed, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
            [gate, cat, defaultAllowed]
          );
        }
      }
    }

    console.log('✅ [initGateCategoryRules] Gate category rules initialized successfully!');
  } catch (err) {
    console.error('❌ Error initializing gate category rules:', err);
  }
}

if (require.main === module) {
  initGateCategoryRules().then(() => process.exit(0));
}

module.exports = initGateCategoryRules;
