import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { HttpError, asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { sendOtp, verifyOtp } from '../services/otp.js';
import { Patient } from '../db.js';

const router = Router();
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});
router.use(limiter);

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');
const password = z.string().min(6, 'Password must be at least 6 characters').max(100);
const otp = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit OTP');
const name = z.string().trim().min(2, 'Enter your full name').max(80);

const session = (p) => ({ patient: { name: p.name, phone: p.phone } });

// Step 1 of register / forgot password / booking: send the OTP.
router.post(
  '/send-otp',
  validate(z.object({ phone, purpose: z.enum(['register', 'reset', 'booking']) })),
  asyncHandler(async (req, res) => {
    const { phone: ph, purpose } = req.body;
    if (purpose === 'register') {
      const exists = await Patient.exists({ phone: ph });
      if (exists) throw new HttpError(409, 'This mobile number is already registered. Please login.');
    } else if (purpose === 'reset') {
      const exists = await Patient.exists({ phone: ph });
      if (!exists) throw new HttpError(404, 'No account found for this mobile number. Please register first.');
    }
    res.json({ ok: true, ...(await sendOtp(ph, purpose)) });
  })
);

router.post(
  '/verify-otp',
  validate(z.object({ phone, otp, purpose: z.enum(['register', 'reset', 'booking']).default('booking') })),
  asyncHandler(async (req, res) => {
    const { phone: ph, otp: code, purpose } = req.body;
    await verifyOtp(ph, purpose, code);
    res.json({ ok: true, verified: true, phone: ph });
  })
);

router.post(
  '/register',
  validate(
    z
      .object({ name, phone, password, confirmPassword: z.string(), otp })
      .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })
  ),
  asyncHandler(async (req, res) => {
    const { name: nm, phone: ph, password: pw, otp: code } = req.body;
    if (await Patient.exists({ phone: ph })) throw new HttpError(409, 'This mobile number is already registered. Please login.');
    await verifyOtp(ph, 'register', code);
    const p = await Patient.create({ name: nm, phone: ph, passwordHash: await bcrypt.hash(pw, 10) });
    res.status(201).json(session(p));
  })
);

router.post(
  '/login',
  validate(z.object({ phone, password: z.string().min(1, 'Enter your password').max(100) })),
  asyncHandler(async (req, res) => {
    const p = await Patient.findOne({ phone: req.body.phone }).select('+passwordHash');
    const ok = await bcrypt.compare(req.body.password, p ? p.passwordHash : DUMMY_HASH);
    if (!p || !ok) throw new HttpError(401, 'Incorrect mobile number or password.');
    res.json(session(p));
  })
);

router.post(
  '/forgot-password',
  validate(
    z
      .object({ phone, otp, password, confirmPassword: z.string() })
      .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })
  ),
  asyncHandler(async (req, res) => {
    const { phone: ph, otp: code, password: pw } = req.body;
    const p = await Patient.findOne({ phone: ph });
    if (!p) throw new HttpError(404, 'No account found for this mobile number.');
    await verifyOtp(ph, 'reset', code);
    p.passwordHash = await bcrypt.hash(pw, 10);
    await p.save();
    res.json(session(p));
  })
);

export default router;
