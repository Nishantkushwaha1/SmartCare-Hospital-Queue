import mongoose from 'mongoose';

export const NOTIFICATION_KINDS = ['appointment', 'token', 'queue', 'doctor', 'room', 'emergency', 'payment'];

const schema = new mongoose.Schema(
  {
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
    message: { type: String, required: true, maxlength: 300 },
    // 'all' = visible to every patient (OPD status, room changes, emergencies),
    // 'token' = only the patient who holds that token. Messages never contain personal data.
    audience: { type: String, enum: ['all', 'token'], default: 'all' },
    token: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schema.index({ audience: 1, token: 1, createdAt: -1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }); // keep a week

export const Notification = mongoose.model('Notification', schema);
