# lupa-data-check

Read-only audit of a Lupa practice. Pulls every record type through the public API,
runs the migration data-quality ruleset over what it pulled, and produces the internal
findings report that the deployment team reviews before anything goes to a client.

Zero runtime dependencies, Node 18+. It cannot write to Lupa — there is no `PUT` in the
client.

## Two ways to use it

**In Cowork**, as a plugin. Customize → Plugins → Add marketplace →
`JnoelP92/lupa-data-check` → Sync → Install. The skills then fire on their own, and the
whole pass — pull, review, client report, Dock copy, draft email, Linear tickets —
happens in one session.

The plugin lives in `plugin/`, which is the layout every marketplace Cowork loads
actually uses — a plugin sourced at the repo root (`"source": "./"`) fails to sync.

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

The key is stored under its own keychain slot (`lupa-data-check`), not the one
`api-upload-tool` uses. The two tools default to different environments, and a shared
slot means one silently running with the other's key.

## Installing without an admin

The marketplace route needs admin access to the plugin repo on GitHub, checked through
each person's own GitHub connection — so it works for whoever owns the repo and nobody
else. Private marketplace repos are also a known sore point
([#61271](https://github.com/anthropics/claude-code/issues/61271)).

Skills do not work that way. A custom skill is uploaded per user, is private to that
account, and is explicitly not centrally managed — no admin involved:

```bash
npm run package:skill      # writes dist/lupa-data-check.zip and dist/lupa-live-config.zip
```

Upload each at **Settings → Capabilities → Skills → Add skill**. Needs a paid plan with
code execution enabled.

Each bundle carries the whole tool, not just SKILL.md, so `check` and `deliverables` run
straight from it with nothing cloned and nothing installed. Only `pull` has to happen
elsewhere, because only `pull` needs to reach Lupa.

Re-run `package:skill` and re-upload when the rules change. That is the cost of avoiding
the admin conversation: updates are manual, per person.

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
| `plugin/` | the installable plugin: manifest and the two skills |
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
npm test                 # 44 tests, includes the field check
npm run check:fields     # do the rules read fields the API actually returns?
npm run sync:spec        # refresh spec-fields.json from the live OpenAPI spec
```

`sync-spec.js` reduces Lupa's 1.3MB OpenAPI document to the ~19KB of field names the
rules depend on, so `check-fields.js` runs offline and the snapshot is reviewable in a
diff. Run `sync:spec` then `check:fields` whenever the API moves.

44 tests against a synthetic practice in `test/fixture.js`: every record exists to trip
a named rule, so a failure names a rule rather than shifting a count somewhere
downstream. Control records (`c0001`, `p01`, `pr01`, …) are asserted never to appear in
any finding, and the client-facing output is asserted to contain no UUIDs at all. No
key, no network.

## What the client never sees

`src/redact.js` is the whole of it: Info findings, rules marked `internalOnly`, raw
UUIDs and internal reference fields are stripped, and softened wording replaces the
internal rule title. That is one file to read if you want to know whether something
leaks.

## Status

All 20 rule modules are implemented — 230 rules covering every category in the spec.
Where the API differs from the spec document, `references/ruleset-v1.md` says so and
names each rule that had to change or go, rather than leaving code that quietly matches
nothing.

Field names are validated against the real OpenAPI spec — that check found and fixed 19
rules reading fields that do not exist, including most of the services module.

One thing still to do before trusting a real run: **validate the invoice and
client-balance formulas** against known-good records, as the spec says. They are the
rules most likely to produce a wall of false Criticals at a practice whose bundle
pricing differs from the assumption. Enum *values* are also unverified where the spec
declares none (appointment status, dispense tracking mode) — the status breakdown in
each tally is the check.
