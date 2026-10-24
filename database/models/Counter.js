import mongoose from 'mongoose';

/**
 * Tiny atomic counters (all updated with $inc, so they are safe under concurrency):
 *   _id "seq:GM:2026-10-07"      -> seq      (token numbers per department per day)
 *   _id "quota:<deptId>:<day>"   -> online / offline  (tokens booked so far today)
 *   _id "receipt"                -> seq      (global receipt numbers)
 */
const schema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
    online: { type: Number, default: 0 },
    offline: { type: Number, default: 0 },
  },
  { versionKey: false }
);

export const Counter = mongoose.model('Counter', schema);
