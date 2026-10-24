import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: 'Hospital Admin', trim: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

export const Admin = mongoose.model('Admin', schema);
