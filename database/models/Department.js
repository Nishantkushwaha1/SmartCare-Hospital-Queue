import mongoose from 'mongoose';

export const DEPT_STATUSES = ['Available', 'Busy', 'Unavailable'];

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Token prefix, e.g. GM -> GM-001. Immutable after creation (tokens already carry it).
    code: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z]{2,3}$/ },
    room: { type: String, required: true, trim: true, maxlength: 12 },
    doctor: { type: String, trim: true, maxlength: 60, default: '' }, // printed on the parcha, e.g. "Dr. Sharma"
    status: { type: String, enum: DEPT_STATUSES, default: 'Available' },
    timing: { type: String, default: '9:00 AM - 1:00 PM', trim: true, maxlength: 40 },
    fee: { type: Number, min: 0, max: 5000, default: 10 }, // rupees
    dailyCap: { type: Number, min: 10, max: 500, default: 50 }, // tokens per day (online + counter)
  },
  { timestamps: true }
);

// Case-insensitive unique department names.
schema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
schema.index({ code: 1 }, { unique: true });

export const Department = mongoose.model('Department', schema);
