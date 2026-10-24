import mongoose from 'mongoose';

// One live OTP per phone + purpose. The code is stored hashed; Mongo deletes the row after it expires.
const schema = new mongoose.Schema({
  phone: { type: String, required: true },
  purpose: { type: String, enum: ['register', 'reset', 'booking'], required: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});
schema.index({ phone: 1, purpose: 1 }, { unique: true });

export const Otp = mongoose.model('Otp', schema);
