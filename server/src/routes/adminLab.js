import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { todayKey, fmtDateTime } from '../utils/time.js';
import { bookingsForDay, collectSample, issueReport, reportByCode, labCatalogForStaff } from '../services/lab.js';
import { Feedback } from '../db.js';

// Staff / doctor endpoints for the lab and the feedback inbox. Mounted at /api/admin/lab and /api/admin/feedback.
export const labAdminRouter = Router();
export const feedbackAdminRouter = Router();
labAdminRouter.use(requireAdmin);
feedbackAdminRouter.use(requireAdmin);

const bookingCode = z.string().trim().toUpperCase().regex(/^LB-[A-Z0-9]{8}$/, 'Invalid lab booking code');
const reportCode = z.string().trim().toUpperCase().regex(/^LR-[A-Z0-9]{10}$/, 'This is not a lab report QR code');

labAdminRouter.get('/tests', (req, res) => res.json(labCatalogForStaff()));

labAdminRouter.get(
  '/bookings',
  validate(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), 'query'),
  asyncHandler(async (req, res) => res.json({ day: req.query.day || todayKey(), bookings: await bookingsForDay(req.query.day || todayKey()) }))
);

labAdminRouter.post(
  '/bookings/:code/collect',
  validate(z.object({ code: bookingCode }), 'params'),
  asyncHandler(async (req, res) => res.json(await collectSample(req.params.code)))
);

labAdminRouter.post(
  '/bookings/:code/report',
  validate(z.object({ code: bookingCode }), 'params'),
  validate(z.object({ values: z.record(z.string().max(40), z.union([z.string(), z.number()])), remarks: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => res.status(201).json(await issueReport(req.params.code, req.body, req.admin)))
);

// Doctor panel: the scanned QR code carries the report code.
labAdminRouter.get(
  '/reports/:code',
  validate(z.object({ code: reportCode }), 'params'),
  asyncHandler(async (req, res) => res.json(await reportByCode(req.params.code)))
);

feedbackAdminRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows, agg] = await Promise.all([
      Feedback.find().sort({ createdAt: -1 }).limit(200).lean(),
      Feedback.aggregate([{ $group: { _id: '$rating', n: { $sum: 1 } } }]),
    ]);
    const byRating = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    agg.forEach((a) => (byRating[a._id] = a.n));
    const count = Object.values(byRating).reduce((a, b) => a + b, 0);
    const avg = count ? Object.entries(byRating).reduce((s, [r, n]) => s + Number(r) * n, 0) / count : 0;
    res.json({
      summary: { count, average: Math.round(avg * 10) / 10, byRating },
      items: rows.map((f) => ({ id: String(f._id), rating: f.rating, category: f.category, department: f.department, message: f.message, name: f.name, phone: f.phone, at: fmtDateTime(f.createdAt) })),
    });
  })
);
