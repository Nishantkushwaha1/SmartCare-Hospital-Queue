import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError, asyncHandler } from '../utils/http.js';
import { Admin } from '../db.js';

export const requireAdmin = asyncHandler(async (req, res, next) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'Staff login required.');
  let payload;
  try {
    payload = jwt.verify(m[1], env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Your session expired. Please log in again.');
  }
  const admin = await Admin.findById(payload.sub).select('username name');
  if (!admin) throw new HttpError(401, 'Staff account not found. Please log in again.');
  req.admin = admin;
  next();
});
