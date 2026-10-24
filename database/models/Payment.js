import mongoose from 'mongoose';

const { Schema } = mongoose;

const patientSchema = new Schema(
  { name: { type: String, trim: true }, age: Number, phone: { type: String, trim: true }, address: { type: String, trim: true } },
  { _id: false }
);

/**
 * One document per booking attempt/payment.
 *  online + fee   : (gateway razorpay, or demo in PAYMENT_MODE=demo) created (slot reserved, Razorpay order open) -> paid (token issued) | expired | refunded
 *  online + free  : paid immediately (gateway "none", amount 0)
 *  offline/counter: paid immediately (gateway "none", fee collected by staff)
 * Amounts are in rupees. Razorpay works in paise, converted at the edge.
 */
const schema = new Schema(
  {
    receipt: String, // RC-1001
    gateway: { type: String, enum: ['razorpay', 'demo', 'none'], required: true },
    orderId: String, // Razorpay order_...
    paymentId: String, // Razorpay pay_...
    signature: { type: String, select: false },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    method: String, // UPI | Card | Net Banking | Wallet | Cash | Free ...
    status: { type: String, enum: ['created', 'paid', 'expired', 'refunded'], default: 'created' },
    source: { type: String, enum: ['online', 'offline'], required: true },
    day: { type: String, required: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    departmentName: String,
    patient: { type: patientSchema, select: false },
    reservationHeld: { type: Boolean, default: false }, // is a quota slot currently held for this booking
    expiresAt: Date, // when an unpaid reservation is released
    token: String,
    tokenId: Schema.Types.ObjectId,
    paidAt: Date,
    refundId: String,
    refundedAt: Date,
    failureReason: String,
    receivedBy: String, // staff username for counter bookings
  },
  { timestamps: true }
);

const unique = (field) => ({ unique: true, partialFilterExpression: { [field]: { $type: 'string' } } });
schema.index({ orderId: 1 }, unique('orderId'));
schema.index({ paymentId: 1 }, unique('paymentId'));
schema.index({ receipt: 1 }, unique('receipt'));
schema.index({ day: 1, status: 1 });
schema.index({ status: 1, reservationHeld: 1, expiresAt: 1 });

export const Payment = mongoose.model('Payment', schema);
