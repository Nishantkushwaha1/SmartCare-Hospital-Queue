import { env } from '../config/env.js';
import { todayKey, fmtTime, fmtDateTime } from '../utils/time.js';
import { Department, Token, Payment, Counter, Notification } from '../db.js';

// ---------- quota: 70% online / 30% counter ----------
export const quotaOf = (cap) => {
  const online = Math.round(cap * env.ONLINE_SHARE);
  return { online, offline: cap - online };
};
const quotaKey = (deptId, day) => `quota:${deptId}:${day}`;

async function ensureQuotaDoc(key) {
  try {
    await Counter.updateOne({ _id: key }, { $setOnInsert: { online: 0, offline: 0 } }, { upsert: true });
  } catch (e) {
    if (e.code !== 11000) throw e; // another request created it first: fine
  }
}

/** Atomically takes one slot. Returns false when the quota for today is used up. */
export async function reserveSlot(dept, source, day = todayKey()) {
  const limit = quotaOf(dept.dailyCap)[source];
  const key = quotaKey(dept._id, day);
  await ensureQuotaDoc(key);
  const doc = await Counter.findOneAndUpdate({ _id: key, [source]: { $lt: limit } }, { $inc: { [source]: 1 } }, { new: true });
  return Boolean(doc);
}

export async function releaseSlot(deptId, source, day = todayKey()) {
  await Counter.updateOne({ _id: quotaKey(deptId, day), [source]: { $gt: 0 } }, { $inc: { [source]: -1 } });
}

// ---------- tokens ----------
export async function issueToken({ dept, source, patient, payment, status = 'Waiting', day = todayKey() }) {
  const c = await Counter.findOneAndUpdate({ _id: `seq:${dept.code}:${day}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  const token = `${dept.code}-${String(c.seq).padStart(3, '0')}`;
  return Token.create({
    token,
    day,
    seq: c.seq,
    department: dept._id,
    departmentName: dept.name,
    departmentCode: dept.code,
    source,
    status,
    patient,
    payment: payment ? payment._id : undefined,
  });
}

export async function nextReceipt() {
  const c = await Counter.findOneAndUpdate({ _id: 'receipt' }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `RC-${1000 + c.seq}`;
}

export function notify(kind, message, token = null) {
  return Notification.create({ kind, message, audience: token ? 'token' : 'all', token }).catch((e) =>
    console.error('notification failed:', e.message)
  );
}

/**
 * Public, privacy-safe view of one token: department, room, status, queue position, estimate and
 * receipt summary. No name, age or phone.
 */
export async function describeToken(t) {
  const dept = await Department.findById(t.department).select('room').lean();
  const scope = { day: t.day, department: t.department };
  const active = t.status === 'Waiting' || t.status === 'Emergency';
  let ahead = 0;
  let busy = false;

  if (active) {
    if (t.status === 'Emergency') {
      ahead = await Token.countDocuments({ ...scope, status: 'Emergency', createdAt: { $lt: t.createdAt } });
    } else {
      const [emergencies, earlier] = await Promise.all([
        Token.countDocuments({ ...scope, status: 'Emergency' }),
        Token.countDocuments({ ...scope, status: 'Waiting', seq: { $lt: t.seq } }),
      ]);
      ahead = emergencies + earlier;
    }
    busy = Boolean(await Token.exists({ ...scope, status: 'Consultation' }));
  }

  const now = Date.now();
  const startMs = now + (ahead + (busy ? 1 : 0)) * env.AVG_CONSULT_MIN * 60000;
  const from = new Date(startMs);
  const to = new Date(startMs + 15 * 60000);
  const arrive = new Date(Math.max(now, startMs - 10 * 60000));

  let payment = null;
  if (t.payment) {
    const p = await Payment.findById(t.payment).select('receipt amount method status').lean();
    if (p) payment = { receipt: p.receipt, amount: p.amount, method: p.method, status: p.status };
  }

  return {
    token: t.token,
    department: t.departmentName,
    room: dept ? dept.room : '–',
    status: t.status,
    source: t.source,
    registeredAt: t.createdAt,
    registeredAtText: fmtDateTime(t.createdAt),
    ahead,
    estimate: active ? { from: fmtTime(from), to: fmtTime(to), text: `${fmtTime(from)} – ${fmtTime(to)}`, arriveBy: fmtTime(arrive) } : null,
    payment,
  };
}

// ---------- departments (with today's live numbers) ----------
export async function listDepartments() {
  const day = todayKey();
  const depts = await Department.find().sort({ _id: 1 }).lean();
  const [counters, waitingAgg, consulting, lastDone] = await Promise.all([
    Counter.find({ _id: { $in: depts.map((d) => quotaKey(d._id, day)) } }).lean(),
    Token.aggregate([
      { $match: { day, status: { $in: ['Waiting', 'Emergency'] } } },
      { $group: { _id: '$department', n: { $sum: 1 } } },
    ]),
    Token.find({ day, status: 'Consultation' }).sort({ calledAt: -1 }).select('department token').lean(),
    Token.aggregate([
      { $match: { day, status: 'Completed' } },
      { $sort: { completedAt: -1 } },
      { $group: { _id: '$department', token: { $first: '$token' } } },
    ]),
  ]);

  const booked = new Map(counters.map((c) => [c._id.split(':')[1], c]));
  const waiting = new Map(waitingAgg.map((w) => [String(w._id), w.n]));
  const current = new Map(lastDone.map((l) => [String(l._id), l.token]));
  for (const c of [...consulting].reverse()) current.set(String(c.department), c.token); // in-consultation wins

  return depts.map((d) => {
    const id = String(d._id);
    const q = quotaOf(d.dailyCap);
    const b = booked.get(id) || {};
    const on = b.online || 0;
    const off = b.offline || 0;
    return {
      id,
      name: d.name,
      code: d.code,
      room: d.room,
      doctor: d.doctor || '',
      status: d.status,
      timing: d.timing,
      fee: d.fee,
      dailyCap: d.dailyCap,
      onlineBooked: on,
      offlineBooked: off,
      onlineLeft: Math.max(0, q.online - on),
      offlineLeft: Math.max(0, q.offline - off),
      currentToken: current.get(id) || null,
      waiting: waiting.get(id) || 0,
    };
  });
}

// ---------- public live queue (no personal data) ----------
export async function publicQueue({ department, limit = 1000 } = {}) {
  const filter = { day: todayKey(), status: { $ne: 'Cancelled' } };
  if (department) filter.department = department;
  const [tokens, depts] = await Promise.all([
    Token.find(filter).sort({ createdAt: 1 }).limit(limit).lean(),
    Department.find().select('room').lean(),
  ]);
  const room = new Map(depts.map((d) => [String(d._id), d.room]));
  return tokens
    .map((t) => ({
      token: t.token,
      department: t.departmentName,
      room: room.get(String(t.department)) || '–',
      status: t.status,
      source: t.source,
      time: fmtTime(t.createdAt),
    }))
    .sort((a, b) => (a.status === 'Emergency' ? 0 : 1) - (b.status === 'Emergency' ? 0 : 1)); // emergencies first (stable)
}
