import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { startOnlineBooking } from '../services/booking.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking attempts. Please wait a few minutes and try again.' },
});

const bookingSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(80),
  age: z.coerce.number({ invalid_type_error: 'Enter a valid age' }).int().min(0, 'Enter a valid age').max(120, 'Enter a valid age'),
  phone: z
    .string()
    .trim()
    .transform((s) => s.replace(/[^\d+]/g, ''))
    .refine((s) => /^\+?\d{10,13}$/.test(s), 'Enter a valid phone number'),
  address: z.string().trim().min(1, 'Patient Address is required').max(300, 'Address is too long'),
  departmentId: z.string().regex(/^[a-f\d]{24}$/i, 'Choose a department'),
});

/**
 * Starts an online booking.
 *  - free department   -> { free: true, ticket }                (token issued immediately)
 *  - paid department   -> { free: false, order: { id, amount, currency, keyId }, fee, expiresAt }
 *                         The browser then opens Razorpay Checkout with `order`, and after payment
 *                         calls POST /api/payments/verify to receive the ticket.
 */
router.post(
  '/online',
  limiter,
  validate(bookingSchema),
  asyncHandler(async (req, res) => {
    const { departmentId, ...patient } = req.body;
    res.status(201).json(await startOnlineBooking({ departmentId, patient }));
  })
);

export default router;
