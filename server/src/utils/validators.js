import { z } from 'zod';

// Same rule as patient login: 10-digit Indian mobile, +91 / 91 / 0 prefix allowed.
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
