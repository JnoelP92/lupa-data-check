# Lupa data check ruleset — v1.0.0

Source of truth for what this tool checks. Every rule carries an id matching the code in
`src/rules/`, so a finding in a report can always be traced back to a line.

Severity means:

- **Critical** — actively wrong data affecting billing, clinical safety, comms or
  referential integrity. Resolve before go-live.
- **Review** — looks wrong, needs a human decision on whether it is a real problem or
  expected for how the practice actually works.
- **Info** — data insight, not an error. Never appears in client-facing output.

## Implementation status

| Category | Spec | Implemented | Notes |
|---|---|---|---|
| 6.1 Clients | yes | **yes** | Balance-vs-history reconciliation deferred to 6.11.6 |
| 6.2 Pets | yes | no | |
| 6.3 Appointments | yes | no | `roomId` rule has no endpoint — see Open questions |
| 6.4 Products | yes | no | |
| 6.5 Services | yes | no | |
| 6.6 Bundles | yes | no | Composition only derivable via invoices |
| 6.7 Reminders | yes | no | Definitions only; pet-level instances not exposed |
| 6.8 Clinical notes | yes | no | |
| 6.9 Medical records | yes | no | |
| 6.10 Prescriptions | yes | no | |
| 6.11 Financials | yes | no | Both money formulas need validating first |
| 6.12 Health plans | yes | no | |
| 6.13 Employees | yes | no | |
| 7 Cross-record | yes | no | Must be set-membership, never per-record GETs |

A category marked "no" has **not run**. It must never be rendered as a clean pass.

## 6.1 Clients — implemented

Endpoints: `GET /v1/clients`, `POST /v1/clients/search`, `GET /v1/client/{id}`

### Tally

Total; active vs archived; by primary store; on billing hold; GDPR opt-in; platform
comms opt-in; missing email / phone / address line 1 (active only); non-zero balance
count; in credit count and sum; in debt count and sum; net outstanding; clients with
additional contacts and the average per client.

### Rules

| id | Severity | Condition |
|---|---|---|
| `clients.email.missing` | Review | `email` is null and not archived |
| `clients.phone.missing` | Review | `phone` is null and not archived |
| `clients.email.malformed` | Critical | `email` fails the API's own pattern |
| `clients.phone.implausible` | Review | under 7 digits, all one digit, or a known placeholder range |
| `clients.dob.implausible` | Review | `dob` in the future or before 1900 |
| `clients.address.missing` | Info | `address.line_1` null and not archived |
| `clients.duplicate.email` | Critical | 2+ clients share an email, lowercased and trimmed |
| `clients.duplicate.phone` | Critical | 2+ clients share a phone, digits only, 7+ digits |
| `clients.duplicate.nameDob` | Review | 2+ clients share first + last + dob, dob not null |
| `clients.balance.nonZero` | Info | `balance != 0`, top 10 by absolute value |
| `clients.ref.primaryStore` | Critical | `primaryStoreId` not in `/v1/companies/stores` |
| `clients.ref.paymentTerms` | Critical | `paymentTermsId` not in `/v1/payment-terms` |
| `clients.contacts.noRoute` | Info | a `contacts[]` entry with neither email nor phone |

### Client-facing wording

Where a rule has a `clientFacing` string it replaces the internal title in client
output. `clients.ref.primaryStore` becomes "Client is linked to a location that no
longer exists" — the practice does not know what a `primaryStoreId` is.

## Open questions, carried from the spec

These need answering before the categories that depend on them are coded.

1. **`/v1/rooms` does not exist.** The appointments spec has a rule "`roomId` is not
   null but returns 404 on rooms lookup". There is no rooms endpoint in the
   2026-09-14 API snapshot. Either the rule drops, or it needs a different source.
   `/v1/payment-terms`, `/v1/reference-lists` and `/v1/appointment-statuses` do all
   exist and are pulled.

2. **Invoice reconciliation must be validated before it ships.** The
   `expectedTotal` formula (line sum, then invoice-level discount) needs checking
   against at least five known-good invoices at a practice that uses bundles. If
   bundle pricing is carried on the wrapper rather than the components, the formula
   double-counts and the report fills with false Criticals.

3. **Client balance reconciliation likewise.** Validate against 3–5 known-clean
   clients. The open question is whether refundable credits reduce `balance`, which
   changes the sign of `additionalCreditAmount` in the expression.

4. **Cross-record checks must be set-based.** "`petId` returns 404" across every
   appointment and invoice line would be hundreds of thousands of requests against a
   100/min limit. Load the ID sets once from the pull, then check membership. This is
   a correctness-of-approach constraint, not an optimisation.

5. **Reminders are definitions, not instances.** "Deceased pet with an active
   reminder" needs pet-level scheduled reminders, which the public API does not
   expose. The rule cannot be implemented as specified.
