import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load server/.env no matter where the process is started from. On Render there is no .env file:
// the values come from the dashboard's Environment tab and are already in process.env.
const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (fs.existsSync(envFile)) dotenv.config({ path: envFile });

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);

const NODE_ENV = process.env.NODE_ENV || 'development';
const wantsDemo = (process.env.PAYMENT_MODE || '').trim().toLowerCase() === 'demo';
// Demo payments are blocked in production unless you explicitly allow them (hackathon / college demo on Render).
const allowDemoInProd = (process.env.ALLOW_DEMO_PAYMENTS || '').trim().toLowerCase() === 'true';

export const env = Object.freeze({
  NODE_ENV,
  PORT: num(process.env.PORT, 5000),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smartcare',
  CLIENT_ORIGINS: list(process.env.CLIENT_ORIGIN, 'http://localhost:5173'),
  // Render (and most hosts) put a reverse proxy in front: needed for correct client IPs / rate limiting.
  TRUST_PROXY: num(process.env.TRUST_PROXY, process.env.RENDER ? 1 : 0),

  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  ADMIN_USERNAME: (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase(),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  ADMIN_NAME: process.env.ADMIN_NAME || 'Hospital Admin',

  // 'demo' = practice payment window, no gateway account needed, no real money. Ignored in production.
  PAYMENT_MODE: wantsDemo && (NODE_ENV !== 'production' || allowDemoInProd) ? 'demo' : 'razorpay',
  // No SMS provider is wired in, so on a deployed demo the OTP must be shown on screen. Real production: leave unset/false.
  SHOW_DEV_OTP: process.env.SHOW_DEV_OTP ? process.env.SHOW_DEV_OTP.trim().toLowerCase() === 'true' : NODE_ENV !== 'production',
  RAZORPAY_KEY_ID: (process.env.RAZORPAY_KEY_ID || '').trim(),
  RAZORPAY_KEY_SECRET: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
  RAZORPAY_WEBHOOK_SECRET: (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim(),

  // TinyFish web agent (optional). Leave the key empty to keep the feature off.
  TINYFISH_API_KEY: (process.env.TINYFISH_API_KEY || '').trim(),
  TINYFISH_BASE_URL: (process.env.TINYFISH_BASE_URL || 'https://agent.tinyfish.ai/v1').trim().replace(/\/$/, ''),
  // TinyFish Search API, used by the patient chatbot's "search the web" fallback.
  TINYFISH_SEARCH_URL: (process.env.TINYFISH_SEARCH_URL || 'https://api.search.tinyfish.ai').trim().replace(/\/$/, ''),

  // GroqCloud LLM (optional). Powers the patient chatbot's "ask AI" answers. Empty key = feature off.
  GROQ_API_KEY: (process.env.GROQ_API_KEY || '').trim(),
  GROQ_MODEL: (process.env.GROQ_MODEL || 'openai/gpt-oss-120b').trim(),
  GROQ_BASE_URL: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').trim().replace(/\/$/, ''),
  // Speech-to-text for the chatbot's mic button (Whisper on Groq, auto-detects the spoken language). Same GROQ_API_KEY.
  GROQ_STT_MODEL: (process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo').trim(),

  // Fetch.ai uAgents Concierge (REST). Empty = chatbot works without the agent.
  AGENT_URL: (process.env.AGENT_URL || '').trim().replace(/\/$/, ''),

  TIMEZONE: 'Asia/Kolkata',
  RESERVATION_MINUTES: num(process.env.RESERVATION_MINUTES, 10),
  AVG_CONSULT_MIN: num(process.env.AVG_CONSULT_MIN, 6),
  ONLINE_SHARE: Math.min(1, Math.max(0, num(process.env.ONLINE_SHARE, 0.7))),
  AUTO_SEED: process.env.AUTO_SEED !== 'false',
});

export const isProd = env.NODE_ENV === 'production';

if (wantsDemo && isProd && !allowDemoInProd) {
  console.warn('PAYMENT_MODE=demo is ignored in production (set ALLOW_DEMO_PAYMENTS=true to allow it for a demo). Using Razorpay.');
}

if (env.JWT_SECRET.length < 16 || (isProd && env.JWT_SECRET.startsWith('change-me'))) {
  console.error('FATAL: set JWT_SECRET in server/.env to a long random string (16+ characters).');
  process.exit(1);
}