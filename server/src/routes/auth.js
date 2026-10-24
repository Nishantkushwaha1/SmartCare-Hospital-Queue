import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError, asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { Admin } from '../db.js';

const router = Router();
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps timing similar for unknown usernames

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' },
});

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter the username').max(60),
  password: z.string().min(1, 'Enter the password').max(200),
});

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username: username.toLowerCase() }).select('+passwordHash');
    const ok = await bcrypt.compare(password, admin ? admin.passwordHash : DUMMY_HASH);
    if (!admin || !ok) throw new HttpError(401, 'Incorrect username or password.');
    const token = jwt.sign({ sub: String(admin._id) }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
    res.json({ token, admin: { username: admin.username, name: admin.name } });
  })
);

router.get('/me', requireAdmin, (req, res) => res.json({ admin: { username: req.admin.username, name: req.admin.name } }));

export default router;
