# lupa-data-check

Read-only audit of a Lupa practice. Pulls every record type through the public API,
runs the migration data-quality ruleset over what it pulled, and produces the internal
findings report that the deployment team reviews before anything goes to a client.

Zero runtime dependencies, Node 18+. It cannot write to Lupa — there is no `PUT` in the
client.

## Two ways to use it

**In Cowork**, as a plugin. Customize → Plugins → Add marketplace → this repo's URL →
install. The skills then fire on their own, and the whole pass — pull, review, client
report, Dock copy, draft email, Linear tickets — happens in one session.

**As a plain CLI**, anywhere with Node and network access to Lupa:

```bash
bin/lupa-check key                   # hidden prompt, verified before it is stored
bin/lupa-check whoami                # which practice is this key for?
bin/lupa-check run --env migrations  # pull, rules, report
```

## When egress is closed

Cowork runs code in a VM behind an egress proxy. Unless an admin has opened
`api.lupapets.com` under Organization settings → Capabilities → Code execution → Allow
network egress, `pull` cannot reach Lupa from a Cowork session. Test it with:

```
curl -sS -o /dev/null -w "%{http_code}\n" https://api.lupapets.com/api/external/ping
```

A `403 CONNECT tunnel failed` means egress is closed for that host.

This is why the pull is a standalone script and everything downstream reads files. Run
the pull on a machine that can reach Lupa:

```bash
npx github:lupapets/lupa-data-check pull --env migrations --out ~/practice-name/out
```

then point Cowork at that folder. `check` and everything after it need no network
access to Lupa at all. Connectors — Linear, Notion, mail — are unaffected either way;
they do not go through the sandbox proxy.

Do not try to route around the proxy. Ask for the allowlist entry.

## Layout

| path | what |
|---|---|
| `bin/lupa-check` | the CLI |
| `src/api.js` | throttled, retrying, read-only API client |
| `src/pull.js` | the only code that touches Lupa; resumable, checkpointed |
| `src/store.js` | on-disk pull format (JSONL + checkpoints) and reader |
| `src/rules/` | one module per record type |
| `src/report.js` | report.json and report.md |
| `references/ruleset-v1.md` | the ruleset, and which parts are actually implemented |
| `skills/` | the Cowork/Claude Code skills |
| `test/` | fixture-driven rule tests — no key, no network |

## What a pull writes

```
out/
  meta.json            practice, environment, counts, ruleset version, what failed
  stores.json …        reference sets
  clients.jsonl        one record per line
  .checkpoint/         cursor + line count per collection, for resume
  report.json          every count and every flagged row
  report.md            the same, for a human
```

Everything under `out/` is gitignored. Practice exports carry client PII and clinical
notes — do not commit them, and do not paste raw rows into a chat when a count or a
redacted sample will do.

## Checks

```bash
npm test
```

Nine tests against a synthetic practice built in `test/fixture.js`. No key, no network.
Every seeded client exists to trip exactly one rule, so a failure names a line rather
than a feeling.

## Status

Clients is implemented end to end. The other twelve categories are specified in
`references/ruleset-v1.md` and not yet coded — and the report says so rather than
showing them as clean. Four open questions in that file need answering before the
financial categories can ship.
