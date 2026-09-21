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

230 rules across 20 modules, validated against the OpenAPI spec of 2026-09-21.

`spec-fields.json` records the fields each resource actually returns, and
`npm run check:fields` fails the build if a rule reads one that is not there. That check
exists because of a specific failure mode: a rule reading a field the API does not
return matches nothing, reports nothing, and is indistinguishable from a rule that ran
and found the data clean. It caught 19 such references on its first run.

| Category | Module | Rules | Notes |
|---|---|---|---|
| 6.1 Clients | `clients.js` | 13 | Balance reconciliation lives in cross-record |
| 6.2 Pets | `pets.js` | 16 | |
| 6.3 Appointments | `appointments.js` | 19 | `roomId` rule dropped — no endpoint, see Open questions |
| 6.4 Products | `products.js` | 31 | Batch expiry deferred — needs a per-record detail GET |
| 6.5 Services | `services.js` | 10 | Thin resource — four spec rules dropped, see below |
| 6.6 Bundles | `bundles.js` | 7 | Composition check lives in cross-record |
| 6.7 Reminders | `reminders.js` | 7 | Definitions only; pet-level instances not exposed |
| 6.8 Clinical notes | `clinical-notes.js` | 10 | |
| 6.9 Medical records | `medical-records.js` | 9 | |
| 6.10 Prescriptions | `prescriptions.js` | 19 | |
| 6.11.1 Invoices | `invoices.js` | 25 | Reconciliation formula needs validating — see below |
| 6.11.2 Payments | `payments.js` | 7 | |
| 6.11.3 Credit notes | `credit-notes.js` | 9 | `amount` is a string; parsed at the edge |
| 6.11.4 Refunds | `refunds.js` | 7 | |
| 6.11.5 Estimates | `estimates.js` | 5 | |
| 6.12.1 Health plans | `health-plans.js` | 7 | |
| 6.12.2 Subscriptions | `subscriptions.js` | 10 | No `paymentEnabled` on this resource |
| 6.13 Employees | `employees.js` | 9 | `isOnlineBookingPoc` is per store link |
| (not in spec) Insurance | `insurance-policies.js` | 5 | Its own collection — pets carry no insurance fields |
| 7 + 6.11.6 Cross-record | `cross-record.js` | 6 | Set-membership only, never per-record GETs |

### Not implemented, and why

These rules from the spec document cannot be built against the API as it actually is.
They are listed rather than silently omitted, so nobody reads their absence as a pass.

**No endpoint or field exists:**

- **Appointment `roomId` resolves to a room.** The field exists on the appointment;
  there is no rooms endpoint to validate it against.
- **Deceased pet with an active reminder.** `/v1/reminders` returns reminder
  *definitions*, not pet-level scheduled instances. The equivalent check runs against
  health plan subscriptions and insurance policies, where the data does exist.
- **Expired batch still in stock.** `productsStocks[].batchId` is there but the expiry
  date is not; reading it means one GET per product, which breaks the set-membership
  rule below.

**The services resource is far thinner than the spec document implies.** It returns
category, externalReference, id, margin, name, price, referenceListId, storeId and
timestamps — and nothing else. So these four service rules are gone:

- *sellable service priced at zero* — no `isSellable`. Reported on price alone instead.
- *sellable and archived at once* — neither field exists on a service.
- *VAT rate outside the expected set* / *inconsistent VAT* — services carry no
  `vatPercentage`. VAT is a store-level percentage (`/v1/companies/stores`).
- *margin from price vs procurement cost* — no `procurementCost`, but the API supplies
  `margin` directly, which the rules now use.

**Pets carry no insurance fields.** The spec document has `insuranceStatus` and
`insurer` on the pet; neither exists. Insurance is its own collection keyed by `petId`,
so `insurance-policies.js` covers it and the pets tally counts insured pets from that
index.

**Invoices do not point at appointments.** The spec document assumed
`invoice.appointmentId`. The link runs the other way: `appointment.storeInvoiceId`.
Every rule that needed it reads the appointment.

**Health plan allowances name their target `item`,** not `itemId` / `productId` /
`serviceId`.

**Estimates have no `status` field,** so the only lifecycle signal is whether a matching
invoice appeared.

**Credit notes have no `creditNoteNumber`** — a short id is the only handle. They do
have a `UNKNOWN_DUE_TO_MIGRATION` reason, which is now its own rule: a credit with no
recorded reason reduces what a client owes and is worth confirming before go-live.

### Overlapping rules

Some records trip more than one rule, and that is intended: a product priced at zero
with a real procurement cost is both "free but sellable" and "below cost", and both
framings are useful to a reviewer. Where one rule is strictly a special case of another
the narrower one is suppressed — a negative refill limit is not also reported as
over-dispensing, and a dangling client is not also reported as not owning its pet.

## 6.1 Clients

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

1. **`/v1/rooms` does not exist.** The appointments rule "`roomId` returns 404 on
   rooms lookup" has been dropped. `/v1/payment-terms`, `/v1/reference-lists` and
   `/v1/appointment-statuses` do all exist and are pulled.

2. **Invoice reconciliation must be validated before it ships.** The
   `expectedTotal` formula (line sum, then invoice-level discount) needs checking
   against at least five known-good invoices at a practice that uses bundles. If
   bundle pricing is carried on the wrapper rather than the components, the formula
   double-counts and the report fills with false Criticals.

3. **Client balance reconciliation likewise.** Validate against 3–5 known-clean
   clients. The open question is whether refundable credits reduce `balance`, which
   changes the sign of `additionalCreditAmount` in the expression.

4. **Cross-record checks are set-based, and must stay that way.** `src/indexes.js`
   streams each collection once into identity sets; a referential rule is a
   `Set.has()`. Reintroducing a per-record GET would turn a ten-minute run into a
   multi-day one against the 100/min limit. This is a correctness-of-approach
   constraint, not an optimisation.

5. **Field names are now validated; enum values are not.** `check-fields.js` proves a
   field exists. It cannot prove that `status === 'completed'` is a value this API ever
   returns — appointments, prescriptions and dispense tracking modes have no enum in the
   spec. The status breakdowns in each tally are the check: read them before trusting
   any status-keyed rule, and if an expected value is absent from the breakdown, the
   rules keyed on it did not run in any meaningful sense.
