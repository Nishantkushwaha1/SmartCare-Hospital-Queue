import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { webSearch } from '../services/tinyfish.js';
import { askGroq } from '../services/groq.js';

// Public endpoints for the patient chatbot. Each search costs TinyFish credits, so the limit is tight
// and the only thing exposed is a text search (no URL fetching, no browser automation).
const router = Router();
const searchLimit = rateLimit({ windowMs: 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many searches. Please wait a minute.' } });
const askLimit = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many questions. Please wait a minute.' } });

const searchBody = z.object({ q: z.string().trim().min(3, 'Type a longer question').max(200, 'Question is too long') });

// POST /api/chat/search  { q }  ->  { query, results: [{ title, snippet, url, site }] }
router.post('/search', searchLimit, validate(searchBody), asyncHandler(async (req, res) => res.json(await webSearch(req.body.q))));

const askBody = z.object({
  q: z.string().trim().min(2, 'Type a longer question').max(500, 'Question is too long'),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(1500) })).max(12).optional(),
});

// POST /api/chat/ask  { q, history? }  ->  { reply, model }   (GroqCloud LLM: any topic; SmartCare facts come from the knowledge base)
router.post('/ask', askLimit, validate(askBody), asyncHandler(async (req, res) => res.json(await askGroq(req.body.q, req.body.history))));

export default router;
