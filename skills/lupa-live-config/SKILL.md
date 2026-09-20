---
name: lupa-live-config
description: Live-environment configuration review for a Lupa practice after migration fixes have been applied — focused on products, services, bundles, health plans and reference lists, including multi-site reference list comparison. Use for the second-pass review, "check their live site config", "compare products across stores", or "what should they fix now they're live".
---

# Lupa live site configuration review

The second pass. Runs against the **live** environment, after the practice has worked
through the migration-environment findings. Narrower than the full data check: the
question is no longer "did the data arrive" but "is the catalogue configured the way
this practice actually sells".

Use `lupa-data-check` for the first pass. This skill assumes that already happened.

## Confirm first

- **Live environment.** `--env production`. Say it out loud and get agreement — this is
  the practice's real data.
- **Which practice, and every store.** For a multi-site company the whole point of this
  pass is comparing stores against each other, so a key that covers only some of them
  produces a comparison that is silently incomplete. Check `lupa-check whoami` lists
  every store you expect.

## Running it

```bash
bin/lupa-check run --env production --only products,services,bundles,healthPlans
```

Add `--only clients,pets` only if the user has asked for a re-check of records rather
than configuration.

## Focus areas

Beyond the standard ruleset, this pass looks for configuration that is *consistent*
rather than merely valid:

- **Products vs services.** Items named like a service sitting in the product catalogue
  and vice versa. Common after a migration and invisible until someone bills one.
- **VAT rates against the majority.** A handful of items on a different rate from
  everything in their category is usually an import artefact, not a decision.
- **Units and subunits.** A unit that describes something smaller than its subunit, or a
  dispensing unit set to the container. Note that `measureUnit` is not settable through
  the API — it mirrors `unit` — so a fix here is a UI job for the practice.
- **Pricing coherence.** Negative margin, zero markup, implausible markup, free sellable
  items.
- **Bundles against their components.** Bundle price versus the sum of what is inside
  it, derived from invoice instances since the bundle endpoint does not expose members.
- **Reference lists across stores.** For a multi-site company, the same list should
  exist at each store with the same contents. Differences are worth surfacing as a
  comparison table, not as errors.

## Output

Same review loop as the data check: internal report first, human verdict per finding,
then client-facing materials. The framing differs — this report is advisory, so lead
with "here is what we would change and why", not "here is what is broken".
