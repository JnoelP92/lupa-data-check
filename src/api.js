// Read-only HTTP client for the Lupa public API: bearer auth, retries, cursor
// pagination and client-side rate limiting.
//
// Lifted from api-upload-tool's src/api.js and stripped to the verbs this tool needs.
// There is deliberately no put()/delete() here — an audit that cannot write is an audit
// nobody has to review before running.
//
// Rate strategy (Lupa allows 100 requests/min per API key):
//   - token bucket at `rpm` requests per sliding window (default 80, leaving headroom
//     for anything else using the same key)
//   - any 429 halves the rate for a 2-minute cooldown, on top of honouring Retry-After
//   - pages are requested at limit=500, the documented maximum, to minimise requests

export class ApiError extends Error {
  constructor(message, { status, body, method, path } = {}) {
    super(message);
    this.status = status;
    this.body = body;
    this.method = method;
    this.path = path;
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Api {
  constructor({ baseUrl, token, verbose = false, maxRetries = 4, rpm = 80, windowMs = 60_000, pageSize = 500 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.verbose = verbose;
    this.maxRetries = maxRetries;
    this.rpm = rpm;
    this.windowMs = windowMs;
    this.pageSize = pageSize;
    this.stamps = [];
    this.cooldownUntil = 0;
    this.requestCount = 0;
  }

  effectiveRpm() {
    return Date.now() < this.cooldownUntil ? Math.max(1, Math.floor(this.rpm / 2)) : this.rpm;
  }

  async throttle() {
    if (!this.rpm) return;
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.effectiveRpm()) {
        this.stamps.push(now);
        return;
      }
      await sleep(this.stamps[0] + this.windowMs - now + 25);
    }
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    let attempt = 0;
    for (;;) {
      await this.throttle();
      if (this.verbose) console.error(`  → ${method} ${url.pathname}${url.search}`);
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        this.requestCount++;
      } catch (err) {
        // A sandboxed runtime refuses egress here rather than at the HTTP layer, so say
        // so plainly instead of retrying four times against a wall.
        if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|403/.test(err.message) && attempt === 0) {
          throw new ApiError(
            `Cannot reach ${url.host}: ${err.message}\n` +
              `If this is a Cowork session, code-execution egress is probably not open for this host. ` +
              `Run the pull outside the sandbox (see README, "When egress is closed").`,
            { method, path },
          );
        }
        if (attempt++ < this.maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new ApiError(`Network error calling ${method} ${path}: ${err.message}`, { method, path });
      }
      if (res.status === 429) this.cooldownUntil = Date.now() + 2 * 60_000;
      if (RETRYABLE.has(res.status) && attempt++ < this.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        await sleep(Math.max(retryAfter * 1000, 500 * 2 ** attempt));
        continue;
      }
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const detail = json?.message ?? json?.error ?? text.slice(0, 300);
        throw new ApiError(`${method} ${path} failed (HTTP ${res.status}): ${detail}`, {
          status: res.status, body: json ?? text, method, path,
        });
      }
      return json;
    }
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }

  post(path, body, query) {
    return this.request('POST', path, { body, query });
  }

  // One page of a collection. Returns { rows, nextCursor }.
  async page(path, query = {}, cursor) {
    const res = await this.get(path, { limit: this.pageSize, ...query, cursor });
    if (Array.isArray(res)) return { rows: res, nextCursor: null };
    const rows = res?.data ?? res?.items ?? [];
    const nextCursor = res?.hasMore ? (res?.nextCursor ?? null) : null;
    return { rows, nextCursor };
  }

  // Every page of a small collection, held in memory. Use pullCollection() in pull.js
  // for anything that could be large.
  async listAll(path, query = {}) {
    const out = [];
    let cursor;
    for (;;) {
      const { rows, nextCursor } = await this.page(path, query, cursor);
      out.push(...rows);
      if (!nextCursor) return out;
      cursor = nextCursor;
    }
  }
}
