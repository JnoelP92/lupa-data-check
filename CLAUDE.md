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

Add fixtures to `test/fixture.js` in the same commit — one record per rule, so a
regression names the rule.

## Checks

```bash
npm test
```
