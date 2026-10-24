import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { HttpError, asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';

// Bridge between the web chatbot and the Fetch.ai uAgents "Concierge" agent (see /agents).
// The browser only talks to this route; the agent URL stays on the server.
const router = Router();
router.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many messages. Please wait a minute.' } }));

const body = z.object({
  message: z.string().trim().min(1, 'Type a message').max(500, 'Message is too long'),
  sessionId: z.string().trim().regex(/^[\w-]{8,60}$/, 'Invalid session').default('web-default'),
});

// POST /api/agent/chat { message, sessionId } -> { reply }
router.post(
  '/chat',
  validate(body),
  asyncHandler(async (req, res) => {
    if (!env.AGENT_URL) throw new HttpError(503, 'The AI agent is not turned on for this server.');
    let r;
    try {
      r = await fetch(`${env.AGENT_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: req.body.message, session_id: req.body.sessionId }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new HttpError(502, 'The AI agent is not reachable right now.');
    }
    const data = await r.json().catch(() => null);
    if (!r.ok || typeof data?.reply !== 'string') throw new HttpError(502, 'The AI agent could not answer. Please try again.');
    res.json({ reply: data.reply });
  })
);

export default router;
