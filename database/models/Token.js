import mongoose from 'mongoose';

const { Schema } = mongoose;

export const TOKEN_STATUSES = ['Waiting', 'Consultation', 'Completed', 'Emergency', 'Cancelled'];

// Personal data. Never selected by default so it cannot leak through a public endpoint by accident.
const patientSchema = new Schema(
  { name: { type: String, trim: true }, age: Number, phone: { type: String, trim: true }, address: { type: String, trim: true } },
  { _id: false }
);

const schema = new Schema(
  {
    token: { type: String, required: true }, // GM-001
    day: { type: String, required: true }, // 2026-10-07 (hospital local day)
    seq: { type: Number, required: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    departmentName: { type: String, required: true },
    departmentCode: { type: String, required: true },
    source: { type: String, enum: ['online', 'offline'], required: true },
    status: { type: String, enum: TOKEN_STATUSES, default: 'Waiting' },
    patient: { type: patientSchema, select: false },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    calledAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

schema.index({ day: 1, token: 1 }, { unique: true });
// One token per payment: makes "verify + webhook arrive together" idempotent.
schema.index({ payment: 1 }, { unique: true, partialFilterExpression: { payment: { $type: 'objectId' } } });
schema.index({ day: 1, department: 1, status: 1 });

export const Token = mongoose.model('Token', schema);
