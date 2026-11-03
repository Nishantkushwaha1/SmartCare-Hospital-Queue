import mongoose from 'mongoose';

export const FEEDBACK_CATEGORIES = ['Doctor & consultation', 'Queue & waiting time', 'Staff behaviour', 'Cleanliness', 'Lab services', 'Website / token booking', 'Other'];

const schema = new mongoose.Schema(
  {
    rating: { type: Number, required: true, min: 1, max: 5 },
    category: { type: String, enum: FEEDBACK_CATEGORIES, default: 'Other' },
    department: { type: String, trim: true, maxlength: 60, default: '' },
    message: { type: String, trim: true, maxlength: 1000, default: '' },
    name: { type: String, trim: true, maxlength: 80, default: '' },
    phone: { type: String, trim: true, maxlength: 15, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schema.index({ createdAt: -1 });

export const Feedback = mongoose.model('Feedback', schema);
