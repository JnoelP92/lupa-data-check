// The only part of this tool that touches the Lupa API.
//
// Everything downstream — rules, report, PDF, Linear, the Dock copy — reads the files
// this writes. That boundary is deliberate: it makes a rules re-run free, and it means
// the pull can happen somewhere with network access to Lupa while the rest happens
// somewhere without it.
import { Store } from './store.js';
import { REFERENCE, COLLECTIONS } from './collections.js';

const RULESET_VERSION = '1.0.0';

// Resolve which practice this key belongs to. A key is scoped to one store, so a
// surprise here means a stale key from a previous session — the single easiest way to
// audit the wrong clinic.
export async function resolveContext(api, { companyId } = {}) {
  const companies = await api.listAll('/v1/companies');
  if (!companies.length) throw new Error('This key can see no companies.');

  if (companyId) {
    const picked = companies.find((c) => c.id === companyId);
    if (!picked) throw new Error(`companyId ${companyId} is not visible to this key.`);
    return { company: picked, stores: await api.listAll('/v1/companies/stores', { companyId: picked.id }) };
  }

  let candidates = companies;
  if (candidates.length > 1) {
    // GET /v1/companies returns a company's own stores alongside it, with the same ids
    // the stores endpoint reports. A row that is another row's store is not a separate
    // practice, and treating it as one turns every multi-site clinic into a prompt
    // asking the user to choose between a company and its own branches.
    const storeIds = new Set();
    for (const c of candidates) {
      try {
        for (const s of await api.listAll('/v1/companies/stores', { companyId: c.id })) storeIds.add(s.id);
      } catch { /* a row that cannot list stores is not the company either */ }
    }
    const real = candidates.filter((c) => !storeIds.has(c.id));
    if (real.length) candidates = real;
  }

  if (candidates.length !== 1) {
    const list = candidates.map((c) => `  ${c.id}  ${c.name}`).join('\n');
    throw new Error(`This key sees ${candidates.length} companies. Pass --company <id>:\n${list}`);
  }

  const company = candidates[0];
  const stores = await api.listAll('/v1/companies/stores', { companyId: company.id });
  return { company, stores };
}

async function pullReference(api, store, companyId, log) {
  const refs = {};
  for (const { key, path } of REFERENCE) {
    try {
      const rows = await api.listAll(path, { companyId });
      store.writeJson(key, rows);
      refs[key] = rows;
      log(`  ${key.padEnd(22)} ${String(rows.length).padStart(7)}`);
    } catch (err) {
      // A reference endpoint that is missing or not permitted for this key disables the
      // rules that depend on it, rather than failing the whole pull. The report records
      // which sets were unavailable so a skipped rule never reads as a clean pass.
      store.writeJson(key, []);
      refs[key] = [];
      refs[`${key}Unavailable`] = err.message;
      log(`  ${key.padEnd(22)} unavailable — ${err.message.split('\n')[0]}`);
    }
  }
  return refs;
}

async function pullEnums(api, store, log) {
  let names;
  try {
    names = await api.get('/v1/enums');
  } catch (err) {
    log(`  enums                  unavailable — ${err.message.split('\n')[0]}`);
    store.writeJson('enums', {});
    return {};
  }
  const list = Array.isArray(names) ? names : (names?.data ?? names?.enums ?? []);
  const enums = {};
  for (const raw of list) {
    const name = typeof raw === 'string' ? raw : (raw?.name ?? raw?.id);
    if (!name) continue;
    try {
      const values = await api.get(`/v1/enums/${encodeURIComponent(name)}`);
      enums[name] = Array.isArray(values) ? values : (values?.data ?? values?.values ?? []);
    } catch { /* one missing enum should not stop the pull */ }
  }
  store.writeJson('enums', enums);
  log(`  enums                  ${String(Object.keys(enums).length).padStart(7)} sets`);
  return enums;
}

// One collection, cursor-paginated, resumable. The checkpoint is written after the
// page is flushed, so it always describes bytes that are actually on disk.
async function pullCollection(api, store, { key, path }, query, log) {
  const ckpt = store.readCheckpoint(key);
  if (ckpt?.done) {
    log(`  ${key.padEnd(22)} ${String(ckpt.lines).padStart(7)}  (cached)`);
    return ckpt.lines;
  }
  let cursor = ckpt?.cursor ?? undefined;
  let lines = ckpt ? store.truncateTo(key, ckpt.lines) : store.truncateTo(key, 0);
  if (ckpt) log(`  ${key.padEnd(22)} resuming from ${lines}`);

  const out = store.appender(key);
  try {
    for (;;) {
      const { rows, nextCursor } = await api.page(path, query, cursor);
      for (const row of rows) {
        if (!out.write(JSON.stringify(row) + '\n')) await new Promise((r) => out.once('drain', r));
      }
      lines += rows.length;
      await new Promise((resolve, reject) => {
        // Flush before the checkpoint claims these lines exist.
        out.write('', (err) => (err ? reject(err) : resolve()));
      });
      store.writeCheckpoint(key, { cursor: nextCursor, lines, done: !nextCursor });
      if (!nextCursor) break;
      cursor = nextCursor;
      if (lines % 5000 === 0) log(`  ${key.padEnd(22)} ${String(lines).padStart(7)} …`);
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }
  log(`  ${key.padEnd(22)} ${String(lines).padStart(7)}`);
  return lines;
}

export async function pull(api, dir, { companyId, only, since, log = console.error } = {}) {
  const store = new Store(dir);
  const startedAt = new Date().toISOString();

  const { company, stores } = await resolveContext(api, { companyId });
  log(`\nPractice: ${company.name}  (companyId ${company.id})`);
  log(`Stores:   ${stores.map((s) => s.name ?? s.id).join(', ') || 'none'}`);
  log(`Base:     ${api.baseUrl}\n`);

  const query = { companyId: company.id, ...(since ? { updatedSince: since } : {}) };

  log('Reference sets');
  const refs = await pullReference(api, store, company.id, log);
  await pullEnums(api, store, log);

  log('\nCollections');
  const wanted = only?.length ? COLLECTIONS.filter((c) => only.includes(c.key)) : COLLECTIONS;
  const counts = {};
  for (const collection of wanted) {
    try {
      counts[collection.key] = await pullCollection(api, store, collection, query, log);
    } catch (err) {
      log(`  ${collection.key.padEnd(22)} FAILED — ${err.message.split('\n')[0]}`);
      counts[collection.key] = { error: err.message };
    }
  }

  const meta = {
    rulesetVersion: RULESET_VERSION,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: api.baseUrl,
    environment: api.baseUrl.includes('migrations') ? 'migrations' : 'production',
    company: { id: company.id, name: company.name },
    stores: stores.map((s) => ({ id: s.id, name: s.name })),
    since: since ?? null,
    counts,
    requestCount: api.requestCount,
    unavailable: Object.fromEntries(
      Object.entries(refs).filter(([k]) => k.endsWith('Unavailable')).map(([k, v]) => [k.replace('Unavailable', ''), v]),
    ),
  };
  store.writeJson('meta', meta);
  log(`\n${api.requestCount} requests. Written to ${dir}/`);
  return meta;
}
