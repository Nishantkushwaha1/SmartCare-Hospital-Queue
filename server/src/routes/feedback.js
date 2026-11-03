import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { Feedback, FEEDBACK_CATEGORIES } from '../db.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback messages from this connection. Please try again later.' },
});

router.get('/categories', (req, res) => res.json(FEEDBACK_CATEGORIES));

router.post(
  '/',
  limiter,
  validate(
    z.object({
      rating: z.coerce.number().int().min(1, 'Please choose a star rating').max(5),
      category: z.enum(FEEDBACK_CATEGORIES).default('Other'),
      department: z.string().trim().max(60).default(''),
      message: z.string().trim().max(1000, 'Feedback is too long (max 1000 characters)').default(''),
      name: z.string().trim().max(80).default(''),
      phone: z.string().trim().max(15).default(''),
    })
  ),
  asyncHandler(async (req, res) => {
    await Feedback.create(req.body);
    res.status(201).json({ ok: true });
  })
);

export default router;
