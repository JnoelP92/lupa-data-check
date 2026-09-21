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
bin/lupa-check deliverables          # client report, Dock copy, email, tickets
```

`deliverables` reads an optional `verdicts.json` next to the report, written after the
deployment team has been through the findings:

```json
{
  "clients.email.malformed": { "include": true, "ticket": true, "note": "before go-live" },
  "products.cost.unknown":   { "include": false }
}
```

Without it, every Critical and Review finding is included and no tickets are produced.
Nothing is ever sent or filed from here — the email is a draft and the Linear export is
a file.

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
  report-client.html   client-facing version — print this to PDF
  dock-copy.txt        plain text for the Dock data-findings box
  client-email.txt     draft email, for a human to send
  linear-tickets.json  only the findings marked for a ticket
```

Everything under `out/` is gitignored. Practice exports carry client PII and clinical
notes — do not commit them, and do not paste raw rows into a chat when a count or a
redacted sample will do.

## Checks

```bash
npm test
```

42 tests against a synthetic practice in `test/fixture.js`: every record exists to trip
a named rule, so a failure names a rule rather than shifting a count somewhere
downstream. Control records (`c0001`, `p01`, `pr01`, …) are asserted never to appear in
any finding. No key, no network.

## What the client never sees

`src/redact.js` is the whole of it: Info findings, rules marked `internalOnly`, raw
UUIDs and internal reference fields are stripped, and softened wording replaces the
internal rule title. That is one file to read if you want to know whether something
leaks.

## Status

All 19 rule modules are implemented — 228 rules covering every category in the spec.
Three specified rules cannot be built against the current API and are named in
`references/ruleset-v1.md` rather than quietly omitted.

Two things to do before trusting a real run:

1. **Validate the invoice and client-balance formulas** against known-good records, as
   the spec says. They are the rules most likely to produce a wall of false Criticals
   at a practice whose bundle pricing differs from the assumption.
2. **Check for rules that fire zero times across a large collection.** Field names come
   from the spec document, not from a live response, and a field that does not exist
   looks exactly like a clean pass.
