import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, trim: true }, // 10-digit Indian mobile number
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

export const Patient = mongoose.model('Patient', schema);
