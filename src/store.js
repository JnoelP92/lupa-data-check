// On-disk shape of a pull.
//
// Big collections are JSONL, one record per line, appended page by page. Small
// reference sets are plain JSON. Rules never call the API — they run against what is
// on disk here, which is what makes a re-run of the ruleset free and gives every
// report an audit trail you can diff.
//
// Each JSONL file has a sibling checkpoint recording the cursor and the number of
// lines written *after* that page was flushed. A resumed pull truncates the file back
// to that line count before appending, so an interrupted write can never leave a
// half-record behind.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, truncateSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(join(dir, '.checkpoint'), { recursive: true });
  }

  jsonPath(key) { return join(this.dir, `${key}.json`); }
  jsonlPath(key) { return join(this.dir, `${key}.jsonl`); }
  ckptPath(key) { return join(this.dir, '.checkpoint', `${key}.json`); }

  writeJson(key, value) {
    writeFileSync(this.jsonPath(key), JSON.stringify(value, null, 2));
  }

  readJson(key, fallback = null) {
    const p = this.jsonPath(key);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
  }

  readCheckpoint(key) {
    const p = this.ckptPath(key);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  }

  writeCheckpoint(key, ckpt) {
    writeFileSync(this.ckptPath(key), JSON.stringify(ckpt));
  }

  // Cut a partially-written JSONL back to `lines` complete records.
  truncateTo(key, lines) {
    const p = this.jsonlPath(key);
    if (!existsSync(p)) return 0;
    const fd = openSync(p, 'r');
    const buf = Buffer.alloc(65536);
    let offset = 0, seen = 0, bytes = 0, read;
    while (seen < lines && (read = readSync(fd, buf, 0, buf.length, offset)) > 0) {
      for (let i = 0; i < read && seen < lines; i++) {
        if (buf[i] === 10) { seen++; bytes = offset + i + 1; }
      }
      offset += read;
    }
    closeSync(fd);
    truncateSync(p, bytes);
    return seen;
  }

  appender(key) {
    return createWriteStream(this.jsonlPath(key), { flags: 'a' });
  }

  // Stream a JSONL file without holding the whole thing in memory as one string.
  *read(key) {
    const p = this.jsonlPath(key);
    if (!existsSync(p)) return;
    const fd = openSync(p, 'r');
    const buf = Buffer.alloc(1 << 20);
    let rest = '', read, offset = 0;
    try {
      while ((read = readSync(fd, buf, 0, buf.length, offset)) > 0) {
        offset += read;
        const chunk = rest + buf.toString('utf8', 0, read);
        const lines = chunk.split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) if (line) yield JSON.parse(line);
      }
      if (rest.trim()) yield JSON.parse(rest);
    } finally {
      closeSync(fd);
    }
  }

  readAll(key) {
    return [...this.read(key)];
  }

  count(key) {
    return this.readCheckpoint(key)?.lines ?? 0;
  }
}
