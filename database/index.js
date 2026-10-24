// SmartCare database layer (MongoDB via Mongoose).
// The server imports ONLY from here (through server/src/db.js), so there is exactly one Mongoose instance.
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Admin } from './models/Admin.js';
import { Counter } from './models/Counter.js';
import { Department, DEPT_STATUSES } from './models/Department.js';
import { Notification, NOTIFICATION_KINDS } from './models/Notification.js';
import { Otp } from './models/Otp.js';
import { Patient } from './models/Patient.js';
import { Payment } from './models/Payment.js';
import { Token, TOKEN_STATUSES } from './models/Token.js';
import { DEPARTMENTS } from './data/departments.js';

mongoose.set('strictQuery', true);

export { Admin, Counter, Department, DEPT_STATUSES, Notification, NOTIFICATION_KINDS, Otp, Patient, Payment, Token, TOKEN_STATUSES, DEPARTMENTS };

export async function connectDB(uri) {
  if (!uri) throw new Error('MONGODB_URI is empty. Set it in the environment (Render: Environment tab).');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  // Build indexes before serving traffic: the unique indexes are what make booking race-safe.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

export const disconnectDB = () => mongoose.disconnect();
export const dbConnected = () => mongoose.connection.readyState === 1;

/**
 * First-run data: the 15 default departments (if the collection is empty) and one staff account (if none).
 * @param {{adminUsername:string, adminPassword:string, adminName?:string, autoSeed?:boolean, resetAdminPassword?:boolean}} opts
 */
export async function bootstrap({ adminUsername = 'admin', adminPassword = '', adminName = 'Hospital Admin', autoSeed = true, resetAdminPassword = false } = {}) {
  if (autoSeed && (await Department.estimatedDocumentCount()) === 0) {
    await Department.insertMany(DEPARTMENTS, { ordered: true });
    console.log(`Seeded ${DEPARTMENTS.length} departments`);
  }

  const hasAdmin = (await Admin.estimatedDocumentCount()) > 0;
  if (hasAdmin && !resetAdminPassword) return;
  if (adminPassword.length < 8) {
    console.warn('No staff account yet. Set ADMIN_USERNAME and ADMIN_PASSWORD (8+ characters) in the environment, then restart.');
    return;
  }
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await Admin.findOneAndUpdate(
    { username: adminUsername.toLowerCase() },
    { $set: { passwordHash, name: adminName } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`Staff account ready: "${adminUsername}"${resetAdminPassword ? ' (password reset)' : ''}`);
}
