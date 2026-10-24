import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';
import { todayKey } from '../utils/time.js';
import { issueToken, notify, describeToken } from './queue.js';
import { Department, Token, Payment } from '../db.js';

const ACTIVE = ['Waiting', 'Emergency', 'Consultation'];

async function findToday(tokenStr) {
  const t = await Token.findOne({ day: todayKey(), token: String(tokenStr).trim().toUpperCase() });
  if (!t) throw new HttpError(404, `Token not found: ${String(tokenStr).trim().toUpperCase()}`);
  return t;
}

/** Call a patient in (QR scan / manual check-in). Whoever was in consultation in that room is completed. */
export async function checkInToken(tokenStr) {
  const n = await findToday(tokenStr);
  if (n.status === 'Cancelled') throw new HttpError(409, `Token ${n.token} was cancelled.`);
  if (n.status === 'Completed') throw new HttpError(409, `Token ${n.token} has already completed consultation.`);

  if (n.status !== 'Consultation') {
    await Token.updateMany(
      { day: n.day, department: n.department, status: 'Consultation', _id: { $ne: n._id } },
      { $set: { status: 'Completed', completedAt: new Date() } }
    );
    n.status = 'Consultation';
    n.calledAt = new Date();
    await n.save();
    const dept = await Department.findById(n.department).select('room').lean();
    await notify('token', `Your token ${n.token} is called. Please go to Room ${dept ? dept.room : '–'}`, n.token);
  }
  return describeToken(n);
}

export async function setTokenStatus(tokenStr, status) {
  const t = await findToday(tokenStr);
  if (t.status === status) return describeToken(t);
  t.status = status;
  if (status === 'Consultation') t.calledAt = new Date();
  if (status === 'Completed') t.completedAt = new Date();
  await t.save();
  return describeToken(t);
}

/** Give an existing token priority, or open a brand-new emergency token (emergencies bypass the daily quota). */
export async function markEmergency({ departmentId, token, name, patientName, address, phone }) {
  const pName = (name || patientName || '').trim();
  if (token) {
    const t = await Token.findOne({ day: todayKey(), token: String(token).trim().toUpperCase() }).select('+patient');
    if (!t) throw new HttpError(404, `Token not found: ${String(token).trim().toUpperCase()}`);
    if (t.status === 'Consultation') throw new HttpError(409, `Token ${t.token} is already in consultation.`);
    if (['Completed', 'Cancelled'].includes(t.status)) throw new HttpError(409, `Token ${t.token} is already ${t.status.toLowerCase()}.`);
    t.status = 'Emergency';
    if (pName) {
      if (!t.patient) t.patient = {};
      t.patient.name = pName;
    }
    if (address) {
      if (!t.patient) t.patient = {};
      t.patient.address = address;
    }
    await t.save();
    const dept = await Department.findById(t.department).select('room').lean();
    const displayName = (t.patient && t.patient.name) ? ` (${t.patient.name})` : (pName ? ` (${pName})` : '');
    await notify('emergency', `Emergency priority set for token ${t.token}${displayName} (Room ${dept ? dept.room : '–'})`);
    const desc = await describeToken(t);
    if (t.patient && t.patient.name) desc.name = t.patient.name;
    return desc;
  }
  const dept = await Department.findById(departmentId);
  if (!dept) throw new HttpError(404, 'Department not found.');
  let patientObj = undefined;
  if (pName || address || phone) {
    patientObj = {};
    if (pName) patientObj.name = pName;
    if (address) patientObj.address = address;
    if (phone) patientObj.phone = phone;
  }
  const t = await issueToken({ dept, source: 'offline', status: 'Emergency', patient: patientObj });
  const displayName = pName ? ` (${pName})` : '';
  await notify('emergency', `Emergency patient ${t.token}${displayName} added to queue (Room ${dept.room})`);
  const desc = await describeToken(t);
  if (pName) desc.name = pName;
  return desc;
}

/** Numbers for the admin overview and analytics screens. */
export async function overviewStats(day = todayKey()) {
  const [byStatus, byDept, money, waits] = await Promise.all([
    Token.aggregate([{ $match: { day } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Token.aggregate([{ $match: { day, status: { $ne: 'Cancelled' } } }, { $group: { _id: '$departmentName', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Payment.aggregate([{ $match: { day, status: 'paid' } }, { $group: { _id: '$source', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Token.aggregate([
      { $match: { day, calledAt: { $exists: true } } },
      {
        $project: {
          waitMin: { $divide: [{ $subtract: ['$calledAt', '$createdAt'] }, 60000] },
          hour: { $hour: { date: '$createdAt', timezone: env.TIMEZONE } },
        },
      },
      { $group: { _id: '$hour', avg: { $avg: '$waitMin' }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const count = (s) => byStatus.find((x) => x._id === s)?.n || 0;
  const cash = (src) => money.find((x) => x._id === src)?.amount || 0;
  const total = byStatus.filter((x) => x._id !== 'Cancelled').reduce((a, x) => a + x.n, 0);

  return {
    day,
    total,
    waiting: count('Waiting'),
    consultation: count('Consultation'),
    completed: count('Completed'),
    emergency: count('Emergency'),
    cancelled: count('Cancelled'),
    collected: { online: cash('online'), offline: cash('offline'), total: cash('online') + cash('offline') },
    departments: byDept.map((d) => ({ name: d._id, count: d.n })),
    waitByHour: waits.map((w) => ({ hour: w._id, avgMinutes: Math.round(w.avg * 10) / 10, tokens: w.n })),
  };
}

export const hasActiveTokens = (deptId) => Token.exists({ day: todayKey(), department: deptId, status: { $in: ACTIVE } });
