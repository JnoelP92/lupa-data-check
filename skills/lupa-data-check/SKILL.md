---
name: lupa-data-check
description: Audit a Lupa practice's data and produce the migration data-check report. Use whenever someone wants to check, audit, QA or review a practice's data in Lupa — including "run a data check on this clinic", "what's wrong with their migrated data", "pre-go-live check", "compare their data against the old PMS", or when they hand over an API key for a practice about to go live. Also use for the follow-up live-environment pass once fixes have been applied.
---

# Lupa data check

Produces the internal findings report for a practice, then the client-facing materials
once a human has reviewed it. Read-only throughout: this tool cannot write to Lupa.

## Ask this first, before anything else

> Is this a **data check** (migration environment, full record sweep) or **live site
> configuration guidance** (live environment, focused on products, services, bundles and
> reference lists)?

They are different passes with different outputs, and getting it wrong wastes a full
pull. If it is the second, use the `lupa-live-config` skill instead.

Then confirm three things and say them back:

- **Which practice.** The key is scoped to one store. `lupa-check whoami` prints the
  practice name — read it out loud before pulling. A stale key from a previous session
  is the easiest way to audit the wrong clinic.
- **Which environment.** Migration (`--env migrations`) for a pre-go-live check;
  production (`--env production`) only when the user says so explicitly.
- **Multi-site?** If the company has several stores, check the key covers all of them.
  A key that sees two of five stores produces counts that look fine and are wrong.

## Getting the key

Either route is fine. Pasted into the chat is acceptable — stash it via stdin, never as
an argument:

```bash
node bin/lupa-check key <<'EOF'
<the key>
EOF
```

Or have the user run `bin/lupa-check key` themselves for a hidden prompt. Either way the
key is verified against `GET /v1/companies` first and a rejected key is never stored.

## Running the pass

```bash
bin/lupa-check run --env migrations          # pull, then rules, then report
```

`pull` is resumable — if it stops, run it again and it continues from the checkpoint
rather than starting over. `check` alone re-runs the ruleset over an existing pull,
which is free and is what you do after every rule change.

Expect the pull to take a while on a real practice. It is paced at 80 requests/minute
against Lupa's 100/min limit.

**If the pull cannot reach Lupa** you are probably in a sandbox with closed egress. Do
not work around it. See README, "When egress is closed" — the fix is to run the pull
outside the sandbox and point `check` at the same directory.

## Reading the report

`out/report.md` is the internal artefact. Work through it with the user in this order:

1. **The summary table.** Scanned vs flagged per category, then Critical counts.
2. **Anything in "Incomplete pull"** at the top. A reference set that failed to load
   means rules were *skipped*, not passed. Resolve this before reading anything else —
   a skipped rule reads like a clean one.
3. **Critical findings, category by category.** For each, the question is not "is this
   in the report" but "is this actually wrong, or is it how this practice works". Both
   answers are useful; only the first goes to the client.
4. **Review findings.** These exist because they need a human. Do not resolve them on
   the user's behalf.
5. **Info.** Shape-of-the-data, for context. Never goes to the client.

Record the user's verdict per finding as you go. That verdict list is the input to
everything below.

## After the review

Write the user's verdict per finding into `out/verdicts.json`:

```json
{
  "<ruleId>": { "include": true, "ticket": false, "note": "their words, not yours" }
}
```

`include: false` removes a finding from every client-facing deliverable. `ticket: true`
puts it in the Linear export. Then:

```bash
bin/lupa-check deliverables --contact "<their name>" --from "<your name>"
```

That writes all four at once. What each is for:

- **`report-client.html`** — the client-facing report. Redaction is enforced in code
  (`src/redact.js`), so you do not have to police it by hand. Print it to PDF for the
  client; it is already laid out for A4 with a contents page and per-section links back
  to the summary.
- **`dock-copy.txt`** — plain text for the data findings box on the Dock migration page.
- **`client-email.txt`** — a draft. **Never send it.** Give it to the user to read, edit
  and send themselves.
- **`linear-tickets.json`** — only the findings marked `ticket: true`. Ask before
  creating any of them, and never bulk-file the report.

Check the client report before handing it over. If anything in it would confuse a
practice manager, that is a wording problem to fix in the rule's `clientFacing` string,
not something to paper over in the moment.

## Rules

- **Never paste raw client rows into the conversation.** A count, or a redacted sample,
  says the same thing. Exports carry client PII and clinical notes.
- **Never commit anything under `out/`.** It is gitignored deliberately.
- **Never write to Lupa from this skill.** Fixes go through the practice, or through
  `api-upload-tool` as a separate, reviewed change.
- **Rotate the key when the job is done** rather than trying to scrub it. A pasted key
  persists in the session transcript on disk; replacing it in Lupa invalidates every
  copy at once.

## Reading a tally before trusting a rule

Field names are validated against the API spec, but enum *values* are not — the spec
declares none for appointment status or dispense tracking mode. Each category's tally
includes a breakdown of those fields. If a breakdown does not contain a value a rule
keys on (no `completed` under appointment status, say), the rules keyed on it found
nothing because the vocabulary differs, not because the data is clean. Say so rather
than reporting a pass.

## What the ruleset covers

All 20 modules, 230 rules — `references/ruleset-v1.md` is the source of truth, and it
names every place the API differs from the original spec document and what changed as a
result. Several rules the document asked for do not exist because the fields do not.
When someone asks why a check they expected is missing, that file has the answer.
