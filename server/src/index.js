import { env } from './config/env.js';
import { createApp } from './app.js';
import { connectDB, disconnectDB, bootstrap } from './db.js';
import { gatewayReady } from './services/razorpay.js';
import { expireStaleReservations } from './services/booking.js';
import { groqReady } from './services/groq.js';

async function main() {
  await connectDB(env.MONGODB_URI);
  console.log('MongoDB connected');
  await bootstrap({ adminUsername: env.ADMIN_USERNAME, adminPassword: env.ADMIN_PASSWORD, adminName: env.ADMIN_NAME, autoSeed: env.AUTO_SEED });

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`SmartCare API listening on http://localhost:${env.PORT}`);
    console.log(groqReady()
      ? `Groq AI: ON (model ${env.GROQ_MODEL})`
      : 'Groq AI: OFF. GROQ_API_KEY not found. Put it in server/.env (file name must be exactly ".env", not .env.txt / .env.example), then restart.');
    console.log(env.AGENT_URL ? `Fetch.ai agent: ${env.AGENT_URL} (needs: npm run agents, or npm run auto)` : 'Fetch.ai agent: OFF');
    if (env.PAYMENT_MODE === 'demo') console.log('Payments: DEMO mode (practice payment window, no real money, Razorpay not used)');
    else console.log(
      gatewayReady()
        ? `Razorpay: ${env.RAZORPAY_KEY_ID.startsWith('rzp_live') ? 'LIVE' : 'test'} mode${env.RAZORPAY_WEBHOOK_SECRET ? ' + webhook' : ' (no webhook secret set)'}`
        : 'Razorpay: NOT configured (free departments work; paid bookings return 503)'
    );
  });

  // Release unpaid reservations whose payment window ran out.
  const sweeper = setInterval(() => expireStaleReservations().catch((e) => console.error('reservation sweeper:', e.message)), 60 * 1000);
  sweeper.unref();

  const stop = async () => {
    clearInterval(sweeper);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
