import { Router } from 'express';
import { z } from 'zod';
import { HttpError, asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { todayKey } from '../utils/time.js';
import { describeToken, publicQueue } from '../services/queue.js';
import { Token } from '../db.js';

const router = Router();

// Public live queue: token, room, department, booking type, status, time. No personal data.
router.get(
  '/',
  validate(z.object({ department: z.string().regex(/^[a-f\d]{24}$/i).optional() }), 'query'),
  asyncHandler(async (req, res) => res.json(await publicQueue({ department: req.query.department })))
);

// Public status of one token (patients track their own token with this)
router.get(
  '/token/:token',
  validate(z.object({ token: z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}-\d{3,5}$/, 'Enter a token like GM-048') }), 'params'),
  asyncHandler(async (req, res) => {
    const t = await Token.findOne({ day: todayKey(), token: req.params.token });
    if (!t) throw new HttpError(404, 'Token not found');
    res.json(await describeToken(t));
  })
);

export default router;
