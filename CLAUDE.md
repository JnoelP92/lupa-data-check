# lupa-data-check

Read-only audit of a Lupa practice. Pull → rules → report. Zero runtime dependencies.

## The boundary that matters

`src/pull.js` is the only code that touches the Lupa API. Everything downstream reads
files under `out/`. Keep it that way: it makes a rules re-run free, gives every report
an audit trail, and means the pull can happen somewhere with network access to Lupa
while the review happens somewhere without it (a Cowork sandbox with closed egress).

## Rules

- **Read-only, always.** There is no `put()` on the API client. Do not add one. Fixes go
  through the practice or through `api-upload-tool` as a separate reviewed change.
- **Never add a rule without checking the field exists.** `npm run check:fields`
  validates every field a rule reads against `spec-fields.json`. A rule reading a field
  the API does not return matches nothing and is indistinguishable from a clean pass —
  it is the one bug here that makes the output actively misleading. The check runs as
  part of `npm test`; do not skip it.
- **Referential rules are set membership, never a per-record GET.** `src/indexes.js`
  streams each collection once into identity sets. A `GET /v1/pet/{id}` per invoice line
  would be days of requests against a 100/min limit.
- **One defect, one finding.** Where a rule is strictly a special case of another,
  suppress the narrower one — a negative refill limit is not also over-dispensing.
  Genuine overlaps (free *and* below cost) are fine and are documented in the ruleset.
- **A skipped rule is not a passing rule.** If a reference set fails to load, the rules
  depending on it are recorded in `skipped` and the report says so at the top. Never let
  an unavailable dependency render as a clean pass.
- **Never commit customer data.** `out/`, `*.jsonl`, `report.*` and `.env` are
  gitignored deliberately. Don't paste raw client rows into a message when a count or a
  redacted sample will do.
- **Never commit API tokens,** and never put one in a permission rule or a command-line
  argument. Pasting into chat is fine; it goes to `bin/lupa-check key` via stdin.
- **Rehearse against migrations** (`--env migrations`, the default) before production.
  Offline, `npm test` runs the whole pipeline against a synthetic practice.
- `references/ruleset-v1.md` is the source of truth for rule behaviour and for which
  categories are actually implemented. Update the status table in the same commit as any
  new rule module.

## Adding a rule module

One file per record type in `src/rules/`, default-exporting `{ key, label, linkType,
tally(ctx), rules[] }`. Register it in `src/rules/index.js`. Each rule is
`{ id, severity, title, clientFacing?, why?, needs?, truncate?, group?, run(ctx) }` and
returns `{ record, display, fields, reason?, groupKey? }`.

`needs` names a reference set; if the pull could not read it, the rule is skipped rather
than run. Use it on every referential rule.

Add fixtures to `test/fixture.js` in the same commit — one record per rule, and add it
to the `EXPECTED` map in `test/rules.test.js` so a regression names the rule. Give the
new record its own identity (its own date, its own microchip) or it will collide with a
neighbouring rule and the failure will point at the wrong thing.

## Client-facing output

`src/redact.js` decides what a client may see: Info and `internalOnly` findings are
dropped, UUIDs and internal reference fields are stripped, `clientFacing` wording
replaces the internal title. Anything new that could leak internal config belongs in
that file, not in the renderer.

## Checks

```bash
npm test                 # 44 tests, field check included
npm run sync:spec        # refresh spec-fields.json when the API moves
npm run check:fields
```
