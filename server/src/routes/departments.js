import { Router } from 'express';
import { z } from 'zod';
import { HttpError, asyncHandler } from '../utils/http.js';
import { validate } from '../middleware/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { listDepartments, notify } from '../services/queue.js';
import { hasActiveTokens } from '../services/staff.js';
import { Department, DEPT_STATUSES, Token, Payment } from '../db.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const idParams = z.object({ id: objectId });

const body = z.object({
  name: z.string().trim().min(2, 'Enter the department name').max(60),
  code: z.string().trim().max(3).optional().default(''),
  room: z.string().trim().min(1, 'Enter the room number').max(12),
  doctor: z.string().trim().max(60).optional(),
  dailyCap: z.coerce.number().int().min(10).max(500).default(50),
  fee: z.coerce.number().int().min(0).max(5000).default(10),
  timing: z.string().trim().max(40).optional(),
});

const ci = { locale: 'en', strength: 2 }; // case-insensitive collation

function makeCode(name, wanted, taken) {
  let c = (wanted || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  if (c.length < 2) {
    const w = name.toUpperCase().replace(/[^A-Z ]/g, '').split(' ').filter(Boolean);
    c = w.length > 1 ? w.map((x) => x[0]).join('').slice(0, 3) : (w[0] || 'XX').slice(0, 2);
  }
  if (c.length < 2) c = (c + 'X').slice(0, 2);
  const base = c.slice(0, 2);
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let k = 0;
  while (taken.has(c) && k < 26) c = base + L[k++];
  if (taken.has(c)) throw new HttpError(409, 'Could not generate a unique token code. Enter one manually.');
  return c;
}

const publicDept = async (id) => (await listDepartments()).find((d) => d.id === String(id));

// Public: list with today's live numbers (fee, room, tokens left, now serving, waiting)
router.get('/', asyncHandler(async (req, res) => res.json(await listDepartments())));

router.post(
  '/',
  requireAdmin,
  validate(body),
  asyncHandler(async (req, res) => {
    const { name, code, room, doctor, dailyCap, fee, timing } = req.body;
    if (await Department.exists({ name }).collation(ci)) throw new HttpError(409, 'This department already exists.');
    const taken = new Set((await Department.find().select('code').lean()).map((d) => d.code));
    const dept = await Department.create({ name, code: makeCode(name, code, taken), room, dailyCap, fee, ...(doctor ? { doctor } : {}), ...(timing ? { timing } : {}) });
    res.status(201).json(await publicDept(dept._id));
  })
);

router.put(
  '/:id',
  requireAdmin,
  validate(idParams, 'params'),
  validate(body.omit({ code: true })),
  asyncHandler(async (req, res) => {
    const dept = await Department.findById(req.params.id);
    if (!dept) throw new HttpError(404, 'Department not found.');
    const { name, room, doctor, dailyCap, fee, timing } = req.body;
    if (await Department.exists({ name, _id: { $ne: dept._id } }).collation(ci)) throw new HttpError(409, 'This department already exists.');

    const oldName = dept.name;
    const oldRoom = dept.room;
    Object.assign(dept, { name, room, dailyCap, fee, ...(doctor !== undefined ? { doctor } : {}), ...(timing ? { timing } : {}) });
    await dept.save();

    if (name !== oldName) {
      // keep historical tokens and payments readable under the new name
      await Promise.all([
        Token.updateMany({ department: dept._id }, { $set: { departmentName: name } }),
        Payment.updateMany({ department: dept._id }, { $set: { departmentName: name } }),
      ]);
    }
    if (room !== oldRoom) await notify('room', `Room changed: ${name} OPD moved from Room ${oldRoom} to Room ${room}`);
    res.json(await publicDept(dept._id));
  })
);

router.patch(
  '/:id/status',
  requireAdmin,
  validate(idParams, 'params'),
  validate(z.object({ status: z.enum(DEPT_STATUSES) })),
  asyncHandler(async (req, res) => {
    const dept = await Department.findById(req.params.id);
    if (!dept) throw new HttpError(404, 'Department not found.');
    if (dept.status !== req.body.status) {
      dept.status = req.body.status;
      await dept.save();
      await notify('doctor', `${dept.name} OPD (Room ${dept.room}) is now ${dept.status}`);
    }
    res.json(await publicDept(dept._id));
  })
);

router.delete(
  '/:id',
  requireAdmin,
  validate(idParams, 'params'),
  asyncHandler(async (req, res) => {
    const dept = await Department.findById(req.params.id);
    if (!dept) throw new HttpError(404, 'Department not found.');
    const pendingPay = await Payment.exists({ department: dept._id, status: 'created', expiresAt: { $gt: new Date() } });
    if ((await hasActiveTokens(dept._id)) || pendingPay) {
      throw new HttpError(409, `Cannot remove ${dept.name}: patients are still in its queue.`);
    }
    await dept.deleteOne();
    res.json({ ok: true });
  })
);

export default router;
