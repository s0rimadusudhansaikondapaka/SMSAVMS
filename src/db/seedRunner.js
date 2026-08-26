const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();
const dbConfig = require('../config/db');

async function runSeed() {
  const connectionString = dbConfig.connectionString;
  const activeEnv = (dbConfig.activeEnv || 'LOCAL').toUpperCase();

  console.log(`[PostgreSQL Seed] Connecting to database [Env: ${activeEnv}]...`);

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    console.log(`[PostgreSQL Seed] Connected successfully. Executing schema.sql...`);
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    console.log(`[PostgreSQL Seed] Schema tables created successfully.`);

    console.log(`[PostgreSQL Seed] Executing seed.sql...`);
    const seedSql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    await client.query(seedSql);

    console.log(`[PostgreSQL Seed] Successfully created all tables and populated sample data in PostgreSQL [Env: ${activeEnv}] database!`);
    return true;
  } catch (err) {
    console.error(`[PostgreSQL Seed Error] Error running database scripts on PostgreSQL [Env: ${activeEnv}]:`, err.message);
    return false;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runSeed();
}

module.exports = runSeed;
