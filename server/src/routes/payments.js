import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError, asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { rzp, verifyCheckoutSignature, verifyWebhookSignature, mapMethod } from '../services/razorpay.js';
import { finalizePaidOnline, cancelPendingBooking } from '../services/booking.js';
import { describeToken } from '../services/queue.js';
import { Payment, Token } from '../db.js';

const router = Router();

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
router.use(limiter);

const orderId = z.string().trim().regex(/^(demo_)?order_[A-Za-z0-9]{6,40}$/, 'Invalid order');
const paymentId = z.string().trim().regex(/^pay_[A-Za-z0-9]{6,40}$/, 'Invalid payment');

/**
 * Called by the browser after Razorpay Checkout succeeds.
 * 1) verifies the HMAC signature  2) re-checks the payment with Razorpay  3) issues the token.
 */
router.post(
  '/verify',
  validate(z.object({ orderId, paymentId, signature: z.string().trim().min(10).max(256) })),
  asyncHandler(async (req, res) => {
    const { orderId: oid, paymentId: pid, signature } = req.body;
    if (!verifyCheckoutSignature(oid, pid, signature)) throw new HttpError(400, 'Payment verification failed.');

    let p;
    try {
      p = await rzp().payments.fetch(pid);
      if (p.status === 'authorized') p = await rzp().payments.capture(pid, p.amount, p.currency); // if auto-capture is off
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error('Razorpay fetch/capture failed:', e?.error || e);
      throw new HttpError(502, 'Could not confirm the payment yet. If money was deducted your token will be issued automatically within a minute.');
    }
    if (p.order_id !== oid) throw new HttpError(400, 'This payment does not belong to the booking.');
    if (p.status !== 'captured') throw new HttpError(402, `Payment is not completed (${p.status}).`);

    res.json(await finalizePaidOnline({ orderId: oid, paymentId: pid, method: mapMethod(p.method), signature, amountPaise: p.amount }));
  })
);

// Checkout window closed without paying: release the reserved token straight away.
router.post(
  '/cancel',
  validate(z.object({ orderId })),
  asyncHandler(async (req, res) => res.json({ released: await cancelPendingBooking(req.body.orderId) }))
);

// Lets the browser find out whether the webhook already issued the token (e.g. after a network drop).
router.get(
  '/status/:orderId',
  validate(z.object({ orderId }), 'params'),
  asyncHandler(async (req, res) => {
    const p = await Payment.findOne({ orderId: req.params.orderId }).select('status token');
    if (!p) throw new HttpError(404, 'Unknown order');
    const t = p.token ? await Token.findOne({ payment: p._id }) : null;
    res.json({ status: p.status, ticket: t ? await describeToken(t) : null });
  })
);

// ---- DEMO MODE only: this route does not exist unless PAYMENT_MODE=demo (and never in production) ----
if (env.PAYMENT_MODE === 'demo') {
  router.post(
    '/demo/confirm',
    validate(z.object({ orderId, method: z.enum(['UPI', 'Card', 'Net Banking']).default('UPI') })),
    asyncHandler(async (req, res) => {
      const p = await Payment.findOne({ orderId: req.body.orderId }).select('gateway');
      if (!p || p.gateway !== 'demo') throw new HttpError(404, 'Unknown demo order');
      res.json(
        await finalizePaidOnline({
          orderId: req.body.orderId,
          paymentId: `demo_pay_${crypto.randomBytes(8).toString('hex')}`,
          method: req.body.method,
        })
      );
    })
  );
}

/**
 * Razorpay -> server webhook (mounted in app.js with express.raw so the signature is computed over
 * the exact bytes Razorpay sent). Issues the token even if the browser never came back.
 */
export const webhookHandler = asyncHandler(async (req, res) => {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook is not configured' });
  if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, req.get('x-razorpay-signature'))) {
    return res.status(400).json({ error: 'Invalid signature' });
  }
  let evt;
  try {
    evt = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const entity = evt?.payload?.payment?.entity;

  try {
    if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && entity?.order_id) {
      await finalizePaidOnline({ orderId: entity.order_id, paymentId: entity.id, method: mapMethod(entity.method), amountPaise: entity.amount });
    } else if (evt.event === 'payment.failed' && entity?.order_id) {
      // keep the reservation: Checkout lets the patient retry on the same order until it expires
      await Payment.updateOne({ orderId: entity.order_id, status: 'created' }, { $set: { failureReason: entity.error_description || 'Payment failed' } });
    }
  } catch (e) {
    if (e instanceof HttpError && e.status < 500) console.warn(`Webhook ${evt.event} ignored: ${e.message}`);
    else throw e; // 5xx -> Razorpay retries later
  }
  res.json({ received: true });
});

export default router;
