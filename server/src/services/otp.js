import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';
import { Otp } from '../db.js';

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const hash = (phone, code) => crypto.createHmac('sha256', env.JWT_SECRET).update(`${phone}:${code}`).digest('hex');

// Plug your SMS provider in here (MSG91, Twilio, Fast2SMS ...). Until then the OTP is printed in the
// server console, and when SHOW_DEV_OTP is on (default outside production) it is also returned to the browser so the flow can be tried.
async function deliver(phone, code) {
  console.log(`[OTP] ${phone}: ${code} (valid 5 minutes)`);
}

export async function sendOtp(phone, purpose) {
  const old = await Otp.findOne({ phone, purpose });
  if (old && old.expiresAt.getTime() - Date.now() > TTL_MS - 30 * 1000) {
    throw new HttpError(429, 'OTP was just sent. Please wait 30 seconds before asking for a new one.');
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await Otp.findOneAndUpdate(
    { phone, purpose },
    { codeHash: hash(phone, code), attempts: 0, expiresAt: new Date(Date.now() + TTL_MS) },
    { upsert: true }
  );
  await deliver(phone, code);
  return env.SHOW_DEV_OTP ? { devOtp: code } : {};
}

// Checks and consumes the OTP (it cannot be used twice).
export async function verifyOtp(phone, purpose, code) {
  const row = await Otp.findOne({ phone, purpose });
  if (!row || row.expiresAt < new Date()) throw new HttpError(400, 'OTP expired. Please request a new OTP.');
  if (row.attempts >= MAX_ATTEMPTS) {
    await row.deleteOne();
    throw new HttpError(429, 'Too many wrong attempts. Please request a new OTP.');
  }
  const a = Buffer.from(row.codeHash);
  const b = Buffer.from(hash(phone, code));
  if (!crypto.timingSafeEqual(a, b)) {
    row.attempts += 1;
    await row.save();
    throw new HttpError(400, 'Incorrect OTP.');
  }
  await row.deleteOne();
}
