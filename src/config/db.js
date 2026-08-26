const { Pool } = require('pg');
const { newDb } = require('pg-mem');
require('dotenv').config();

let pool = null;
let isMemoryMode = false;

// 1. Connection string configuration per environment
const env = (process.env.APP_ENV || process.env.NODE_ENV || 'local').toLowerCase();

const connectionStrings = {
  local: process.env.LOCAL_CONNECTION_STRING || process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/vm',
  uat: process.env.UAT_CONNECTION_STRING || process.env.UAT_DATABASE_URL || 'postgresql://neondb_owner:npg_tyR3SVM0vBzc@ep-spring-field-azdk97ad.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  beta: process.env.BETA_CONNECTION_STRING || process.env.BETA_DATABASE_URL || '',
  production: process.env.PROD_CONNECTION_STRING || process.env.PRODUCTION_CONNECTION_STRING || process.env.PROD_DATABASE_URL || '',
  prod: process.env.PROD_CONNECTION_STRING || process.env.PRODUCTION_CONNECTION_STRING || process.env.PROD_DATABASE_URL || '',
};

// Select active environment and database connection string
const activeEnv = ['uat', 'beta', 'production', 'prod'].includes(env) ? env : 'local';
const selectedEnvString = connectionStrings[activeEnv] || connectionStrings.local;

// DATABASE_URL acts as explicit override if specified in environment
const connectionString = process.env.DATABASE_URL || selectedEnvString;
const uatConnectionString = connectionStrings.uat;
const betaConnectionString = connectionStrings.beta;
const prodConnectionString = connectionStrings.production;
const localConnectionString = connectionStrings.local;

console.log(`[PostgreSQL DB] Active Environment: '${activeEnv.toUpperCase()}'. Selected connection string configured.`);

const realPool = new Pool({
  connectionString,
  connectionTimeoutMillis: 3000,
});

async function initDb() {
  if (pool) return pool;

  try {
    const res = await realPool.query('SELECT 1');
    console.log(`[PostgreSQL DB] Successfully connected to PostgreSQL database in '${activeEnv.toUpperCase()}' environment.`);
    pool = realPool;
  } catch (err) {
    console.log(`[PostgreSQL DB Notice] Remote/Native PostgreSQL connection error (${err.message}). Initializing embedded PostgreSQL engine for database '${process.env.DB_NAME || 'vm'}'...`);
    isMemoryMode = true;
    const memDb = newDb();
    const adapter = memDb.adapters.createPg();
    pool = new adapter.Pool();

    // Auto-seed schema & sample data
    const fs = require('fs');
    const path = require('path');
    try {
      const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
      const seedSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
      await pool.query(schemaSql);
      await pool.query(seedSql);
      console.log(`[PostgreSQL DB] Embedded PostgreSQL engine initialized with schema and sample data for database '${process.env.DB_NAME || 'vm'}'.`);
    } catch (sErr) {
      console.error('[PostgreSQL DB Error] Error seeding embedded PostgreSQL engine:', sErr);
    }
  }
  return pool;
}

// Initialize immediately
initDb();

module.exports = {
  query: async (text, params) => {
    if (!pool) {
      await initDb();
    }
    return pool.query(text, params);
  },
  getPool: () => pool,
  activeEnv,
  connectionString,
  connectionStrings,
  localConnectionString,
  uatConnectionString,
  betaConnectionString,
  prodConnectionString,
};
