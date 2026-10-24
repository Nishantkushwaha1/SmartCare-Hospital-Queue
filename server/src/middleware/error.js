import { HttpError } from '../utils/http.js';
import { isProd } from '../config/env.js';

export const notFound = (req, res) => res.status(404).json({ error: 'Not found' });

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });

  let e = err;
  if (err.name === 'ValidationError') e = new HttpError(400, Object.values(err.errors)[0]?.message || 'Invalid data');
  else if (err.name === 'CastError') e = new HttpError(400, 'Invalid identifier');
  else if (err.code === 11000) e = new HttpError(409, 'That record already exists.');

  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.details ? { details: e.details } : {}) });

  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.', ...(isProd ? {} : { debug: err.message }) });
};
