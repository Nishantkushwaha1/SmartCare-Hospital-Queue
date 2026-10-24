import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { fmtTime } from '../utils/time.js';
import { Notification } from '../db.js';

const router = Router();

// Broadcasts (OPD status, room changes, emergencies) + messages addressed to ?token=GM-048
router.get(
  '/',
  validate(z.object({ token: z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}-\d{3,5}$/).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { token } = req.query;
    const audience = token ? [{ audience: 'all' }, { audience: 'token', token }] : [{ audience: 'all' }];
    const rows = await Notification.find({ $or: audience }).sort({ createdAt: -1 }).limit(60).lean();
    res.json(rows.map((n) => ({ id: String(n._id), kind: n.kind, message: n.message, createdAt: n.createdAt, time: fmtTime(n.createdAt) })));
  })
);

export default router;
