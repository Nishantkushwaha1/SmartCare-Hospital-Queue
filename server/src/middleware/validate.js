import { HttpError } from '../utils/http.js';

// validate(zodSchema, 'body' | 'query' | 'params') - replaces the input with the parsed, trimmed, typed value.
export const validate =
  (schema, source = 'body') =>
  (req, res, next) => {
    const r = schema.safeParse(req[source]);
    if (!r.success) {
      const details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return next(new HttpError(400, details[0]?.message || 'Invalid request', details));
    }
    req[source] = r.data;
    next();
  };
