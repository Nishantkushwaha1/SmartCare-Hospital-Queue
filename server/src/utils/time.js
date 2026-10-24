import { env } from '../config/env.js';

const clean = (s) => s.replace(/[\u202f\u00a0]/g, ' ');

// "2026-10-07" in hospital local time. Token numbers and quotas reset at local midnight.
export const todayKey = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: env.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// "10:12 AM"
export const fmtTime = (d) =>
  d ? clean(new Intl.DateTimeFormat('en-US', { timeZone: env.TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)) : '';

// "07 Oct 2026, 10:12 AM"
export const fmtDateTime = (d) => {
  if (!d) return '';
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: env.TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  return `${date}, ${fmtTime(d)}`;
};
