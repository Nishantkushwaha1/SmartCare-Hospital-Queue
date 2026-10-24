// cd database && npm install
// npm run seed                 -> create default departments (if empty) and the first staff account (if none)
// npm run seed:reset-admin     -> set the staff password from ADMIN_USERNAME / ADMIN_PASSWORD
// Reads MONGODB_URI, ADMIN_* from the environment, falling back to ../server/.env or ./.env for local use.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { connectDB, disconnectDB, bootstrap } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of [path.join(here, '.env'), path.join(here, '..', 'server', '.env')]) if (fs.existsSync(f)) dotenv.config({ path: f });

try {
  await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smartcare');
  await bootstrap({
    adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim(),
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminName: process.env.ADMIN_NAME || 'Hospital Admin',
    autoSeed: process.env.AUTO_SEED !== 'false',
    resetAdminPassword: process.argv.includes('--reset-admin'),
  });
} catch (e) {
  console.error('Seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
