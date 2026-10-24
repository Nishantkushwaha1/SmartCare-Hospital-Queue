import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';
import { todayKey, fmtTime } from '../utils/time.js';
import { rzp, paymentsAvailable } from './razorpay.js';
import { reserveSlot, releaseSlot, issueToken, nextReceipt, notify, describeToken } from './queue.js';
import { Department, Token, Payment } from '../db.js';

const rupees = (n) => `₹${n}`;

// ---------------------------------------------------------------------------
// Token issuing (idempotent per payment)
// ---------------------------------------------------------------------------
async function ensureToken(payment) {
  const existing = await Token.findOne({ payment: payment._id });
  if (existing) return { token: existing, created: false };

  const dept = await Department.findById(payment.department);
  if (!dept) throw new HttpError(409, 'This department no longer exists.');

  const patient = payment.patient && typeof payment.patient.toObject === 'function' ? payment.patient.toObject() : payment.patient;
  let token;
  let created = true;
  try {
    token = await issueToken({ dept, source: payment.source, patient, payment, day: payment.day });
  } catch (e) {
    if (e.code !== 11000) throw e;
    // Verify and webhook raced: the other request already issued it.
    token = await Token.findOne({ payment: payment._id });
    created = false;
    if (!token) throw e;
  }
  await Payment.updateOne({ _id: payment._id }, { $set: { token: token.token, tokenId: token._id } });
  return { token, created };
}

async function announce(token, payment) {
  const info = await describeToken(token);
  await notify('appointment', `Appointment confirmed: token ${token.token}, ${token.departmentName}, Room ${info.room}`, token.token);
  if (payment.amount > 0) {
    await notify('payment', `Payment received: ${rupees(payment.amount)} via ${payment.method}. Receipt ${payment.receipt} for token ${token.token}`, token.token);
  }
  if (info.estimate) {
    await notify('queue', `Queue status: ${info.ahead} patient(s) ahead of ${token.token}. Estimated time ${info.estimate.text}`, token.token);
  }
}

// ---------------------------------------------------------------------------
// Online booking, step 1: reserve a slot, create the Razorpay order
// ---------------------------------------------------------------------------
export async function startOnlineBooking({ departmentId, patient }) {
  const dept = await Department.findById(departmentId);
  if (!dept) throw new HttpError(404, 'Department not found.');
  if (dept.fee > 0 && !paymentsAvailable()) {
    throw new HttpError(503, 'Online payment is not available right now. Please take a counter token at the hospital.');
  }

  // Stop one phone number from hoarding slots with unpaid reservations.
  const pending = await Payment.countDocuments({ 'patient.phone': patient.phone, status: 'created', expiresAt: { $gt: new Date() } });
  if (pending >= 3) throw new HttpError(429, 'You have unfinished bookings. Please complete the payment or wait a few minutes.');

  const day = todayKey();
  if (!(await reserveSlot(dept, 'online', day))) {
    throw new HttpError(409, `Online tokens for ${dept.name} are full. Please take a counter (offline) token at the hospital.`);
  }

  const base = {
    gateway: dept.fee ? (env.PAYMENT_MODE === 'demo' ? 'demo' : 'razorpay') : 'none',
    amount: dept.fee,
    currency: 'INR',
    source: 'online',
    day,
    department: dept._id,
    departmentName: dept.name,
    patient,
    reservationHeld: true,
  };

  // Free department: no payment step, token straight away.
  if (!dept.fee) {
    let payment;
    try {
      payment = await Payment.create({ ...base, method: 'Free', status: 'paid', paidAt: new Date(), receipt: await nextReceipt() });
      const { token } = await ensureToken(payment);
      await announce(token, payment);
      return { free: true, ticket: await describeToken(token) };
    } catch (e) {
      if (payment) await Payment.deleteOne({ _id: payment._id }).catch(() => {});
      await releaseSlot(dept._id, 'online', day);
      throw e;
    }
  }

  // Paid department: hold the slot while the patient pays.
  const payment = await Payment.create({
    ...base,
    status: 'created',
    expiresAt: new Date(Date.now() + env.RESERVATION_MINUTES * 60000),
  });
  try {
    if (payment.gateway === 'demo') {
      // Practice payment: no gateway call. The browser shows a demo window and confirms via /payments/demo/confirm.
      const orderId = `demo_order_${crypto.randomBytes(8).toString('hex')}`;
      await Payment.updateOne({ _id: payment._id }, { $set: { orderId } });
      return { free: false, demo: true, fee: dept.fee, expiresAt: payment.expiresAt, order: { id: orderId, amount: dept.fee * 100, currency: 'INR' } };
    }
    const order = await rzp().orders.create({
      amount: dept.fee * 100, // paise
      currency: 'INR',
      receipt: `SC-${payment._id}`,
      notes: { booking: String(payment._id), department: dept.name },
    });
    await Payment.updateOne({ _id: payment._id }, { $set: { orderId: order.id } });
    return {
      free: false,
      fee: dept.fee,
      expiresAt: payment.expiresAt,
      order: { id: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID },
    };
  } catch (e) {
    await Payment.deleteOne({ _id: payment._id }).catch(() => {});
    await releaseSlot(dept._id, 'online', day);
    if (e instanceof HttpError) throw e;
    console.error('Razorpay order creation failed:', e?.error || e);
    throw new HttpError(502, 'Could not start the payment. Please try again in a moment.');
  }
}

// ---------------------------------------------------------------------------
// Online booking, step 2: payment confirmed (called by /verify AND the webhook; idempotent)
// ---------------------------------------------------------------------------
async function autoRefund(payment, reason) {
  try {
    const r =
      payment.gateway === 'razorpay'
        ? await rzp().payments.refund(payment.paymentId, { amount: payment.amount * 100, speed: 'normal', notes: { reason } })
        : { id: null };
    await Payment.updateOne(
      { _id: payment._id },
      { $set: { status: 'refunded', refundId: r.id, refundedAt: new Date(), failureReason: reason } }
    );
  } catch (e) {
    console.error('AUTO-REFUND FAILED - refund manually:', payment.paymentId, e?.error || e);
    await Payment.updateOne({ _id: payment._id }, { $set: { failureReason: `${reason}. AUTO-REFUND FAILED: refund manually.` } });
  }
}

export async function finalizePaidOnline({ orderId, paymentId, method, signature, amountPaise }) {
  const existing = await Payment.findOne({ orderId }).select('+patient');
  if (!existing) throw new HttpError(404, 'Unknown payment order.');
  if (amountPaise != null && amountPaise !== existing.amount * 100) throw new HttpError(400, 'Payment amount does not match the order.');
  if (existing.status === 'refunded') throw new HttpError(409, 'This payment was refunded.');

  let payment = existing;
  if (existing.status !== 'paid') {
    // Atomic claim. 'expired' is allowed on purpose: the money arrived after we released the slot.
    const claimed = await Payment.findOneAndUpdate(
      { _id: existing._id, status: { $in: ['created', 'expired'] } },
      { $set: { status: 'paid', paymentId, method: method || 'Online', paidAt: new Date(), ...(signature ? { signature } : {}) } },
      { new: true }
    ).select('+patient');
    payment = claimed || (await Payment.findById(existing._id).select('+patient'));
  }
  if (!payment || payment.status !== 'paid') throw new HttpError(409, `Payment is ${payment ? payment.status : 'missing'}.`);

  if (!payment.receipt) {
    const receipt = await nextReceipt();
    const withReceipt = await Payment.findOneAndUpdate(
      { _id: payment._id, receipt: { $exists: false } },
      { $set: { receipt } },
      { new: true }
    ).select('+patient');
    payment = withReceipt || (await Payment.findById(payment._id).select('+patient'));
  }

  // The reservation may have been released (patient was slow / closed the window). Take a slot again.
  if (!payment.reservationHeld) {
    const day = todayKey();
    const claim = await Payment.findOneAndUpdate(
      { _id: payment._id, reservationHeld: false },
      { $set: { reservationHeld: true, day } },
      { new: true }
    ).select('+patient');
    if (claim) {
      payment = claim;
      const dept = await Department.findById(payment.department);
      if (!dept || !(await reserveSlot(dept, 'online', day))) {
        await Payment.updateOne({ _id: payment._id }, { $set: { reservationHeld: false } });
        await autoRefund(payment, 'Tokens ran out before the payment completed');
        throw new HttpError(409, 'Sorry, the tokens ran out before your payment completed. Your money is being refunded automatically.');
      }
    } else {
      payment = await Payment.findById(payment._id).select('+patient');
    }
  }

  const { token, created } = await ensureToken(payment);
  if (created) await announce(token, payment);
  return { ticket: await describeToken(token) };
}

// Patient closed the Checkout window without paying: free the slot right away.
export async function cancelPendingBooking(orderId) {
  const p = await Payment.findOneAndUpdate(
    { orderId, status: 'created', reservationHeld: true },
    { $set: { status: 'expired', reservationHeld: false } },
    { new: false }
  );
  if (p) await releaseSlot(p.department, 'online', p.day);
  return Boolean(p);
}

// Run every minute: release reservations whose payment window ran out.
export async function expireStaleReservations() {
  for (;;) {
    const p = await Payment.findOneAndUpdate(
      { status: 'created', reservationHeld: true, expiresAt: { $lt: new Date() } },
      { $set: { status: 'expired', reservationHeld: false } },
      { new: false }
    );
    if (!p) break;
    await releaseSlot(p.department, 'online', p.day);
  }
}

// ---------------------------------------------------------------------------
// Counter (offline) parcha: staff only, fee collected at the counter
// ---------------------------------------------------------------------------
export async function issueCounterToken({ departmentId, mode, admin, name, phone, address }) {
  const dept = await Department.findById(departmentId);
  if (!dept) throw new HttpError(404, 'Department not found.');
  const day = todayKey();
  if (!(await reserveSlot(dept, 'offline', day))) throw new HttpError(409, `Counter tokens for ${dept.name} are full.`);

  let payment;
  try {
    let patient = undefined;
    if (name || phone || address) {
      patient = {};
      if (name) patient.name = name;
      if (phone) patient.phone = phone;
      if (address) patient.address = address;
    }

    payment = await Payment.create({
      gateway: 'none',
      amount: dept.fee,
      currency: 'INR',
      method: dept.fee ? mode : 'Free',
      status: 'paid',
      paidAt: new Date(),
      source: 'offline',
      day,
      department: dept._id,
      departmentName: dept.name,
      patient,
      reservationHeld: true,
      receivedBy: admin.username,
      receipt: await nextReceipt(),
    });
    const { token } = await ensureToken(payment);
    const ticket = await describeToken(token);
    if (token.patient) {
      if (token.patient.name) ticket.name = token.patient.name;
      if (token.patient.address) ticket.address = token.patient.address;
    }
    return {
      ticket,
      payment: { receipt: payment.receipt, amount: payment.amount, method: payment.method, time: fmtTime(payment.paidAt) },
    };
  } catch (e) {
    if (payment) await Payment.deleteOne({ _id: payment._id }).catch(() => {});
    await releaseSlot(dept._id, 'offline', day);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Refund (staff): Razorpay refund for online payments, manual record for counter payments
// ---------------------------------------------------------------------------
export async function refundPayment(paymentDocId, { reason } = {}) {
  const payment = await Payment.findById(paymentDocId);
  if (!payment) throw new HttpError(404, 'Payment not found.');
  if (payment.status !== 'paid') throw new HttpError(409, 'Only paid payments can be refunded.');
  if (payment.amount === 0) throw new HttpError(400, 'Free tokens have nothing to refund.');

  const token = await Token.findOne({ payment: payment._id });
  if (token && !['Waiting', 'Emergency', 'Cancelled'].includes(token.status)) {
    throw new HttpError(409, 'The patient has already been seen, so this payment cannot be refunded.');
  }

  let refundId = null;
  if (payment.gateway === 'razorpay') {
    try {
      const r = await rzp().payments.refund(payment.paymentId, {
        amount: payment.amount * 100,
        speed: 'normal',
        notes: { reason: reason || 'Refund by hospital staff' },
      });
      refundId = r.id;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error('Refund failed:', e?.error || e);
      throw new HttpError(502, e?.error?.description || 'The payment gateway rejected the refund.');
    }
  }

  await Payment.updateOne(
    { _id: payment._id },
    { $set: { status: 'refunded', refundId, refundedAt: new Date(), ...(reason ? { failureReason: reason } : {}) } }
  );
  if (token && token.status !== 'Cancelled') {
    token.status = 'Cancelled';
    await token.save();
    await notify('payment', `Refund of ${rupees(payment.amount)} initiated for token ${token.token}. Receipt ${payment.receipt}`, token.token);
  }
  return { status: 'refunded', refundId };
}
