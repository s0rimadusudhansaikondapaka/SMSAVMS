const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const uatConnectionString = process.env.UAT_CONNECTION_STRING || 'postgresql://neondb_owner:npg_tyR3SVM0vBzc@ep-spring-field-azdk97ad.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const localConnectionString = process.env.LOCAL_CONNECTION_STRING || 'postgresql://postgres:postgres@localhost:5432/vm';

const uatPool = new Pool({ connectionString: uatConnectionString, ssl: { rejectUnauthorized: false } });

async function syncUatToLocal() {
  console.log('=== [UAT DB Sync] Starting UAT to Local DB Structure & Data Sync ===');
  console.log(`[UAT DB] Host: ${uatConnectionString.split('@')[1] ? uatConnectionString.split('@')[1].split('/')[0] : 'UAT Host'}`);

  try {
    // 1. Get all public tables from UAT DB
    const tablesRes = await uatPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const tableNames = tablesRes.rows.map(r => r.table_name);
    console.log(`[UAT DB] Discovered ${tableNames.length} tables in UAT DB:\n  ${tableNames.join(', ')}`);

    let localPool = null;
    let isLocalServerAvailable = false;
    try {
      localPool = new Pool({ connectionString: localConnectionString, connectionTimeoutMillis: 3000 });
      await localPool.query('SELECT 1');
      isLocalServerAvailable = true;
      console.log(`[Local DB] Local PostgreSQL server connected at ${localConnectionString.split('@')[1] || 'localhost:5432'}`);
    } catch (lErr) {
      console.log(`[Local DB Notice] Local PostgreSQL server not reachable (${lErr.message}). Syncing schema.sql & seed.sql files for local embedded database...`);
    }

    const schemaStatements = [];
    const seedStatements = [];

    const formatSqlVal = (val) => {
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'boolean') return val ? 'true' : 'false';
      if (typeof val === 'number') return val;
      if (val instanceof Date) return `'${val.toISOString()}'`;
      if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
      return `'${String(val).replace(/'/g, "''")}'`;
    };

    for (const tableName of tableNames) {
      console.log(`\n--- Fetching structure & rows for table: '${tableName}' ---`);
      
      const colsRes = await uatPool.query(`
        SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [tableName]);

      const cols = colsRes.rows;
      const colDefs = cols.map(c => {
        let typeStr = c.data_type.toUpperCase();
        if (typeStr === 'USER-DEFINED') typeStr = 'VARCHAR(255)';
        else if (typeStr === 'CHARACTER VARYING') typeStr = c.character_maximum_length ? `VARCHAR(${c.character_maximum_length})` : 'VARCHAR(255)';
        else if (typeStr === 'ARRAY') typeStr = 'TEXT[]';
        
        let defStr = c.column_default ? ` DEFAULT ${c.column_default}` : '';
        let nullStr = c.is_nullable === 'NO' ? ' NOT NULL' : '';
        if (c.column_name === 'id' && (c.data_type.includes('int') || c.column_default?.includes('nextval'))) {
          return `  id SERIAL PRIMARY KEY`;
        }
        return `  ${c.column_name} ${typeStr}${nullStr}${defStr}`;
      });

      const createTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (\n${colDefs.join(',\n')}\n);`;
      schemaStatements.push(createTableSql);

      const rowsRes = await uatPool.query(`SELECT * FROM ${tableName} ORDER BY id ASC`).catch(() => uatPool.query(`SELECT * FROM ${tableName}`));
      const rows = rowsRes.rows;
      console.log(`[UAT DB] Table '${tableName}': ${rows.length} rows fetched.`);

      if (rows.length > 0) {
        const colNames = Object.keys(rows[0]);
        const insertHead = `INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES`;
        const valueTuples = rows.map(r => `(${colNames.map(c => formatSqlVal(r[c])).join(', ')})`);
        
        const chunkSize = 100;
        for (let i = 0; i < valueTuples.length; i += chunkSize) {
          const chunk = valueTuples.slice(i, i + chunkSize);
          seedStatements.push(`${insertHead}\n  ${chunk.join(',\n  ')};`);
        }
      }

      if (isLocalServerAvailable && localPool) {
        try {
          await localPool.query(`DROP TABLE IF EXISTS ${tableName} CASCADE;`);
          await localPool.query(createTableSql);
          if (rows.length > 0) {
            const colNames = Object.keys(rows[0]);
            for (const r of rows) {
              const vals = colNames.map(c => r[c]);
              const placeholders = colNames.map((_, idx) => `$${idx + 1}`).join(', ');
              await localPool.query(`INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES (${placeholders})`, vals);
            }
          }
          console.log(`[Local DB] Successfully synced table '${tableName}' structure and ${rows.length} rows.`);
        } catch (lTableErr) {
          console.error(`[Local DB Error] Failed syncing table '${tableName}':`, lTableErr.message);
        }
      }
    }

    const schemaFilePath = path.join(__dirname, 'schema.sql');
    const seedFilePath = path.join(__dirname, 'seed.sql');

    const fullSchemaContent = `-- Exported UAT Schema DDL\n-- Generated on ${new Date().toISOString()}\n\n` + schemaStatements.join('\n\n');
    const fullSeedContent = `-- Exported UAT Data Seed\n-- Generated on ${new Date().toISOString()}\n\n` + seedStatements.join('\n\n');

    fs.writeFileSync(schemaFilePath, fullSchemaContent, 'utf8');
    fs.writeFileSync(seedFilePath, fullSeedContent, 'utf8');

    console.log(`\n==================================================`);
    console.log(`✅ [UAT DB Sync Finished Successfully]`);
    console.log(`   - Saved updated UAT schema DDL to: ${schemaFilePath}`);
    console.log(`   - Saved updated UAT seed data to:   ${seedFilePath}`);
    if (isLocalServerAvailable) {
      console.log(`   - Pushed all UAT tables and data to Local PostgreSQL Server.`);
    } else {
      console.log(`   - Both schema.sql & seed.sql are updated, embedded PostgreSQL engine will auto-load exact UAT state.`);
    }
    console.log(`==================================================\n`);

    process.exit(0);
  } catch (err) {
    console.error('❌ [UAT DB Sync Error]:', err);
    process.exit(1);
  }
}

syncUatToLocal();
