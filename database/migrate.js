import fs from 'node:fs';
import path from 'node:path';
import { env } from '../backend/src/config/env.js';
import { getPgPool, loadLocalStore } from '../backend/src/config/db.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'database', 'migrations');
const SEEDS_DIR = path.resolve(process.cwd(), 'database', 'seeds');

async function runSqlDirectory(pool, dirPath, label) {
  const files = fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dirPath, file), 'utf8');
    console.log(`[${label}] Applying ${file}...`);
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw new Error(`Failed on ${file}: ${error.message}`);
    }
  }
}

async function main() {
  if (env.pg.enabled) {
    const pool = getPgPool();
    try {
      await runSqlDirectory(pool, MIGRATIONS_DIR, 'MIGRATION');
      await runSqlDirectory(pool, SEEDS_DIR, 'SEED');
      console.log('PostgreSQL + PostGIS migrations and seeds completed successfully.');
    } finally {
      await pool.end();
    }
    return;
  }

  const store = loadLocalStore();
  console.log(
    `PG_ENABLED is false — initialized container prototype store with ${
      Object.keys(store.tables).length
    } tables, ${store.tables.roles.length} roles, and ${
      store.tables.ownership_records.length
    } sample institutional records.`
  );
}

main().catch((err) => {
  console.error('Database migration error:', err.message);
  process.exit(1);
});
