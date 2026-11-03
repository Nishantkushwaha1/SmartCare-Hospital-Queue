import mongoose from 'mongoose';

const { Schema } = mongoose;

export const LAB_STATUSES = ['Booked', 'Sample Collected', 'Report Ready', 'Cancelled'];
export const LAB_FLAGS = ['Normal', 'High', 'Low', 'Abnormal'];

const resultSchema = new Schema(
  {
    key: String,
    name: String,
    unit: String,
    value: String,
    ref: String, // "12 – 17.5" or "Negative" (printed on the report)
    flag: { type: String, enum: LAB_FLAGS, default: 'Normal' },
  },
  { _id: false }
);

const schema = new Schema(
  {
    code: { type: String, required: true }, // LB-K7M2QX4R : the booking code the patient keeps (random, not guessable)
    testId: { type: String, required: true },
    testName: { type: String, required: true },
    category: { type: String, required: true },
    sample: { type: String, required: true },
    room: { type: String, required: true }, // L-101
    roomName: { type: String, required: true },
    day: { type: String, required: true }, // 2026-11-04 (hospital local day of the test)
    slot: { type: String, required: true }, // "09:15" (24 h start of the slot)
    slotLabel: { type: String, required: true }, // "09:15 AM – 09:30 AM"
    // Seat inside the slot (1..room capacity). The unique index below is what stops overbooking when
    // two patients pick the last seat at the same moment. Removed on cancel so the seat is freed.
    seat: Number,
    patient: { name: { type: String, trim: true }, phone: { type: String, trim: true }, age: Number },
    status: { type: String, enum: LAB_STATUSES, default: 'Booked' },
    collectedAt: Date,
    report: {
      code: String, // LR-7KQ3M9XA2B : this is what the report QR code carries
      results: [resultSchema],
      remarks: String,
      issuedAt: Date,
      issuedBy: String,
    },
  },
  { timestamps: true }
);

schema.index({ code: 1 }, { unique: true });
schema.index({ room: 1, day: 1, slot: 1, seat: 1 }, { unique: true, partialFilterExpression: { seat: { $exists: true } } });
schema.index({ 'report.code': 1 }, { unique: true, partialFilterExpression: { 'report.code': { $type: 'string' } } });
schema.index({ day: 1, status: 1 });
schema.index({ 'patient.phone': 1, day: 1 });

export const LabBooking = mongoose.model('LabBooking', schema);
