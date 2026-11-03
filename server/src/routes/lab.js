import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { phoneSchema } from '../utils/validators.js';
import { labCatalog, slotsFor, createBooking, myBookings, lookupBooking, cancelBooking } from '../services/lab.js';

const router = Router();

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lab requests. Please try again in a few minutes.' },
});

// Status checks are polled by the patient's screen (every ~30 s while a booking is in progress), so they get a roomier limit.
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lab requests. Please try again in a few minutes.' },
});

const bookingCode = z.string().trim().toUpperCase().regex(/^LB-[A-Z0-9]{8}$/, 'Invalid lab booking code');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date');

// Catalog: every test with its room, hours, sample type and preparation. Public.
router.get('/tests', (req, res) => res.json(labCatalog()));

// Free time slots for one test on one day. Public.
router.get(
  '/slots',
  validate(z.object({ testId: z.string().min(1).max(40), day }), 'query'),
  asyncHandler(async (req, res) => res.json(await slotsFor(req.query.testId, req.query.day)))
);

// Book a test: the patient gets back the room number and the time slot.
router.post(
  '/bookings',
  writeLimiter,
  validate(
    z.object({
      testId: z.string().min(1).max(40),
      day,
      slot: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid slot'),
      name: z.string().trim().min(2, 'Enter the patient name').max(80),
      phone: phoneSchema,
      age: z.coerce.number().int().min(0).max(120).optional(),
    })
  ),
  asyncHandler(async (req, res) => res.status(201).json(await createBooking(req.body)))
);

// "My Lab Reports": the browser remembers its booking codes; the phone number must match too.
router.post(
  '/my',
  readLimiter,
  validate(z.object({ phone: phoneSchema, codes: z.array(bookingCode).max(50) })),
  asyncHandler(async (req, res) => res.json(await myBookings(req.body.phone, req.body.codes)))
);

// Recover a booking on a new device with its code + mobile number.
router.post(
  '/lookup',
  writeLimiter,
  validate(z.object({ phone: phoneSchema, code: bookingCode })),
  asyncHandler(async (req, res) => res.json(await lookupBooking(req.body.phone, req.body.code)))
);

router.post(
  '/bookings/:code/cancel',
  writeLimiter,
  validate(z.object({ code: bookingCode }), 'params'),
  validate(z.object({ phone: phoneSchema })),
  asyncHandler(async (req, res) => res.json(await cancelBooking(req.body.phone, req.params.code)))
);

export default router;
