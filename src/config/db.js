const { Pool } = require('pg');
const { newDb } = require('pg-mem');
require('dotenv').config();

let pool = null;
let isMemoryMode = false;

const NEON_DEFAULT_URL = 'postgresql://neondb_owner:npg_tyR3SVM0vBzc@ep-spring-field-azdk97ad.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

// 1. Connection string configuration per environment
const env = (process.env.APP_ENV || process.env.NODE_ENV || 'local').toLowerCase();
const isHosted = !!(process.env.RENDER || process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.HEROKU);

const connectionStrings = {
  local: process.env.LOCAL_CONNECTION_STRING || process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/vm',
  uat: process.env.UAT_CONNECTION_STRING || process.env.UAT_DATABASE_URL || NEON_DEFAULT_URL,
  beta: process.env.BETA_CONNECTION_STRING || process.env.BETA_DATABASE_URL || NEON_DEFAULT_URL,
  production: process.env.PROD_CONNECTION_STRING || process.env.PRODUCTION_CONNECTION_STRING || process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || NEON_DEFAULT_URL,
  prod: process.env.PROD_CONNECTION_STRING || process.env.PRODUCTION_CONNECTION_STRING || process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || NEON_DEFAULT_URL,
};

// Select active environment and database connection string
const activeEnv = ['uat', 'beta', 'production', 'prod'].includes(env) ? env : (isHosted ? 'production' : 'local');
let selectedEnvString = connectionStrings[activeEnv] || (isHosted ? NEON_DEFAULT_URL : connectionStrings.local);

// If running in hosted/production cloud environment, never allow falling back to localhost:5432
if (isHosted && (!selectedEnvString || selectedEnvString.includes('localhost') || selectedEnvString.includes('127.0.0.1'))) {
  console.log('[PostgreSQL DB] Hosted cloud environment detected. Directing connection to primary Neon cloud database.');
  selectedEnvString = NEON_DEFAULT_URL;
}

// DATABASE_URL acts as explicit override if specified in environment
const connectionString = process.env.DATABASE_URL || selectedEnvString || NEON_DEFAULT_URL;
const uatConnectionString = connectionStrings.uat;
const betaConnectionString = connectionStrings.beta;
const prodConnectionString = connectionStrings.production;
const localConnectionString = connectionStrings.local;

console.log(`[PostgreSQL DB] Active Environment: '${activeEnv.toUpperCase()}'. Host: ${connectionString.includes('@') ? connectionString.split('@')[1].split('/')[0] : 'local'}`);

const isRemote = connectionString.includes('neon.tech') || connectionString.includes('sslmode=require') || connectionString.includes('amazonaws.com') || isHosted;

const realPool = new Pool({
  connectionString,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 20,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
});

let initPromise = null;

async function initDb() {
  if (pool) return pool;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[PostgreSQL DB] Connecting to PostgreSQL database (attempt ${attempt}/3)...`);
        await realPool.query('SELECT 1');
        console.log(`[PostgreSQL DB] Successfully connected to PostgreSQL database in '${activeEnv.toUpperCase()}' environment.`);
        pool = realPool;
        try {
          const runAutoMigrations = require('../db/autoMigrate');
          await runAutoMigrations();
        } catch (mErr) {
          console.error('[PostgreSQL DB Error] Error executing auto-migrations on real DB:', mErr.message || mErr);
        }
        return pool;
      } catch (err) {
        lastErr = err;
        console.warn(`[PostgreSQL DB Warning] Connection attempt ${attempt} failed: ${err.message}`);
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
      }
    }

    console.error(`[PostgreSQL DB CRITICAL] Remote/Native PostgreSQL connection error (${lastErr?.message}). Initializing embedded PostgreSQL engine for database '${process.env.DB_NAME || 'vm'}'...`);
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
        try {
          await pool.query(seedSql);
        } catch (s2Err) {
          // Ignore duplicate seed row insertions on embedded DB
        }
        console.log(`[PostgreSQL DB] Embedded PostgreSQL engine initialized with schema and sample data for database '${process.env.DB_NAME || 'vm'}'.`);
      } catch (sErr) {
        console.error('[PostgreSQL DB Error] Error seeding embedded PostgreSQL engine:', sErr.message || sErr);
      }
      // Trigger safe idempotent auto-migrations
      try {
        const runAutoMigrations = require('../db/autoMigrate');
        await runAutoMigrations();
      } catch (mErr) {
        console.error('[PostgreSQL DB Error] Error executing auto-migrations:', mErr);
    }
    return pool;
  })();

  return initPromise;
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
