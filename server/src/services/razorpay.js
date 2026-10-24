import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

let client = null;

export const gatewayReady = () => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

// Can paid bookings be taken right now (demo mode needs no gateway)?
export const paymentsAvailable = () => env.PAYMENT_MODE === 'demo' || gatewayReady();

export function rzp() {
  if (!gatewayReady()) {
    throw new HttpError(503, 'Online payment is not available right now (payment gateway is not configured).');
  }
  client ??= new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  return client;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Checkout callback signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

// Webhook signature: HMAC_SHA256(raw request body, webhook_secret)
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

const METHODS = { upi: 'UPI', card: 'Card', netbanking: 'Net Banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay Later' };
export const mapMethod = (m) => METHODS[m] || 'Online';
