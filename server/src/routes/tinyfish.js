import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { queueRun, getRun } from '../services/tinyfish.js';

const router = Router();
router.use(requireAdmin); // staff only: every run costs TinyFish credits
router.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many TinyFish requests.' } }));

const runBody = z.object({
  url: z
    .string()
    .trim()
    .max(2000)
    .url('Enter a valid website address')
    .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) websites are allowed'),
  goal: z.string().trim().min(5, 'Describe what TinyFish should do').max(1000),
});
const runId = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{4,100}$/, 'Invalid run id') });

// POST /api/admin/tinyfish/runs   { url, goal }  ->  { runId }
router.post('/runs', validate(runBody), asyncHandler(async (req, res) => res.status(202).json(await queueRun(req.body))));

// GET /api/admin/tinyfish/runs/:id  ->  { runId, status, result, error }
router.get('/runs/:id', validate(runId, 'params'), asyncHandler(async (req, res) => res.json(await getRun(req.params.id))));

export default router;
