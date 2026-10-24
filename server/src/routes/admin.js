import { Router } from 'express';
import { z } from 'zod';
import { HttpError, asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { todayKey, fmtTime } from '../utils/time.js';
import { issueCounterToken, refundPayment } from '../services/booking.js';
import { checkInToken, setTokenStatus, markEmergency, overviewStats } from '../services/staff.js';
import { describeToken } from '../services/queue.js';
import { Payment, Token } from '../db.js';

const router = Router();
router.use(requireAdmin);

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const tokenCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}-\d{3,5}$/, 'Enter a token like GM-048');
const dayQuery = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

// Counter (offline) parcha: staff collect the fee, then issue the token
router.post(
  '/counter-bookings',
  validate(z.object({ 
    departmentId: objectId, 
    mode: z.enum(['Cash', 'UPI', 'Card']).default('Cash'),
    name: z.string().trim().min(1, 'Patient Name is required').max(80),
    phone: z.string().trim().min(1, 'Phone Number is required').max(15),
    address: z.string().trim().min(1, 'Patient Address is required').max(300, 'Address is too long')
  })),
  asyncHandler(async (req, res) => {
    res.status(201).json(await issueCounterToken({ departmentId: req.body.departmentId, mode: req.body.mode, admin: req.admin, name: req.body.name, phone: req.body.phone, address: req.body.address }));
  })
);

// Parcha print (staff only): today's token with the patient's name and age so the parcha can be printed.
// The public /api/queue/token/:token endpoint deliberately has no personal data; this one is behind requireAdmin.
router.get(
  '/tokens/:token',
  validate(z.object({ token: tokenCode }), 'params'),
  asyncHandler(async (req, res) => {
    const t = await Token.findOne({ day: todayKey(), token: req.params.token }).select('+patient');
    if (!t) throw new HttpError(404, 'Token not found');
    const info = await describeToken(t);
    res.json({ ...info, patient: { name: (t.patient && t.patient.name) || '', age: t.patient && t.patient.age != null ? t.patient.age : null, address: (t.patient && t.patient.address) || '' } });
  })
);

// Fee collections (online + counter) for a day
router.get(
  '/payments',
  validate(dayQuery, 'query'),
  asyncHandler(async (req, res) => {
    const rows = await Payment.find({ day: req.query.day || todayKey(), status: { $in: ['paid', 'refunded'] } })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json(
      rows.map((p) => ({
        id: String(p._id),
        receipt: p.receipt,
        token: p.token || '–',
        department: p.departmentName,
        method: p.method,
        amount: p.amount,
        source: p.source,
        status: p.status,
        receivedBy: p.receivedBy || null,
        time: fmtTime(p.paidAt || p.createdAt),
      }))
    );
  })
);

router.post(
  '/payments/:id/refund',
  validate(z.object({ id: objectId }), 'params'),
  validate(z.object({ reason: z.string().trim().max(200).optional() })),
  asyncHandler(async (req, res) => res.json(await refundPayment(req.params.id, { reason: req.body.reason })))
);

router.get('/stats', validate(dayQuery, 'query'), asyncHandler(async (req, res) => res.json(await overviewStats(req.query.day))));

// QR scan / manual check-in
router.post('/queue/checkin', validate(z.object({ token: tokenCode })), asyncHandler(async (req, res) => res.json(await checkInToken(req.body.token))));

router.patch(
  '/queue/:token/status',
  validate(z.object({ token: tokenCode }), 'params'),
  validate(z.object({ status: z.enum(['Waiting', 'Consultation', 'Completed', 'Cancelled']) })),
  asyncHandler(async (req, res) => res.json(await setTokenStatus(req.params.token, req.body.status)))
);

// Emergency priority: pass an existing token, or a department to open a new emergency token
router.post(
  '/emergency',
  validate(
    z
      .object({
        token: tokenCode.optional(),
        departmentId: objectId.optional(),
        name: z.string().trim().min(1, 'Patient Name is required').max(80),
        patientName: z.string().trim().max(80).optional(),
        address: z.string().trim().min(1, 'Patient Address is required').max(300, 'Address is too long'),
        phone: z.string().trim().optional(),
      })
  ),
  asyncHandler(async (req, res) => {
    if (!req.body.departmentId && !req.body.token) throw new HttpError(400, 'Choose a department or enter a token number');
    res.status(201).json(await markEmergency(req.body));
  })
);

export default router;
