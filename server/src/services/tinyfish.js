import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

// TinyFish Web Agent: describe a goal in plain language, TinyFish runs it on a real website.
// Docs: https://docs.tinyfish.ai/key-concepts/endpoints
// Server-side only: the API key never goes to the browser.

export const tinyfishReady = () => Boolean(env.TINYFISH_API_KEY);

async function call(path, { method = 'GET', body } = {}) {
  if (!tinyfishReady()) {
    throw new HttpError(503, 'TinyFish is not configured (set TINYFISH_API_KEY in server/.env).');
  }
  let res;
  try {
    res = await fetch(env.TINYFISH_BASE_URL + path, {
      method,
      headers: { 'X-API-Key': env.TINYFISH_API_KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, 'Could not reach TinyFish. Please try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    // Never forward TinyFish's 401/403 as-is: our own frontend treats a 401 as "staff session expired" and logs out.
    const status = res.status === 429 ? 429 : res.status === 404 ? 404 : 502;
    const msg = data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || `TinyFish request failed (${res.status}).`;
    throw new HttpError(status, msg);
  }
  return data;
}

// Start a run and return immediately with its id (poll with getRun). /run-async avoids long-held requests.
export async function queueRun({ url, goal }) {
  const data = await call('/automation/run-async', { method: 'POST', body: { url, goal } });
  if (data?.error) throw new HttpError(502, data.error.message || 'TinyFish could not start the run.');
  return { runId: data?.run_id ?? data?.id };
}

// status: PENDING | RUNNING | COMPLETED | FAILED | CANCELLED; result is set once COMPLETED.
export async function getRun(runId) {
  const data = await call(`/runs/${encodeURIComponent(runId)}`);
  return { runId: data?.run_id ?? data?.id ?? runId, status: data?.status ?? null, result: data?.result ?? null, error: data?.error ?? null };
}

// TinyFish Search API: ranked web results for a plain-language query (GET, X-API-Key header).
// Docs: https://docs.tinyfish.ai/search-api
// Used by the patient chatbot. Returns only the fields the UI needs, with http(s) links only.
export async function webSearch(query) {
  if (!tinyfishReady()) {
    throw new HttpError(503, 'Web search is not configured (set TINYFISH_API_KEY in server/.env).');
  }
  const url = new URL(env.TINYFISH_SEARCH_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('purpose', 'A hospital patient-assistant chatbot is looking up general health or hospital information for a patient.');
  let res;
  try {
    res = await fetch(url, { headers: { 'X-API-Key': env.TINYFISH_API_KEY }, signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new HttpError(502, 'Could not reach web search. Please try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    // Same reason as call(): never pass 401/403 through, the frontend would treat it as a staff logout.
    throw new HttpError(res.status === 429 ? 429 : 502, 'Web search is unavailable right now.');
  }
  const results = (Array.isArray(data?.results) ? data.results : [])
    .filter((r) => r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url) && r.title)
    .slice(0, 4)
    .map((r) => ({
      title: String(r.title).slice(0, 160),
      snippet: String(r.snippet || '').slice(0, 280),
      url: r.url,
      site: String(r.site_name || '').slice(0, 60),
    }));
  return { query, results };
}
