// Section 6.2 — Pets.
//
// Ownership lives on `clientsPets[]`, so "which store is this pet at" is derived
// through the owning client rather than carried on the pet.
import { isBlank, lower, breakdown, collisions, microchipKey, sameAcrossSites, parseDate, plural } from '../util.js';

const MICROCHIP = /^\d{15}$/;
const LONG_LIVED = { Dog: 20, Cat: 22, Rabbit: 12 };

const owners = (p) => (p.clientsPets ?? []).map((cp) => cp.clientId).filter(Boolean);
const live = (p) => p.deceased !== true && !(p.clientsPets ?? []).every((cp) => cp.isArchived === true);
// Shared-chip matching ranges over live pets only: a deceased pet, or one whose every
// owner link is archived, is an old record, not a second animal carrying the chip.
//
// A pet at a multi-site practice gets a record per site, under its owner's record at
// that site, so the chip turns up once per site by design. A group is that case when
// the pet and owner names match and each record's owner is at a different site; those
// are listed by pets.multiSite rather than reported as a shared chip.
const activeOwner = (p) => ((p.clientsPets ?? []).find((cp) => cp.isArchived !== true) ?? (p.clientsPets ?? [])[0])?.clientId ?? null;
const ownerName = (ctx, p) => lower(ctx.ix.clientName.get(activeOwner(p))?.name);
const samePetKey = (ctx) => (p) => {
  const owner = ownerName(ctx, p);
  const name = lower(p.name);
  return owner && name ? `${owner}|${name}` : null;
};
const onePetManySites = (ctx, group) => sameAcrossSites(group, samePetKey(ctx), (p) => ctx.ix.clientStore.get(activeOwner(p)));
const chipGroups = (rows) => collisions(rows.filter(live), (p) => microchipKey(p.microchip));

const ageYears = (p, now) => {
  const d = parseDate(p.dob);
  return d ? (now - d) / (365.25 * 86_400_000) : null;
};

export default {
  key: 'pets',
  label: 'Pets',
  linkType: 'pet',

  tally(ctx, rows) {
    const perClient = new Map();
    for (const p of rows) for (const c of owners(p)) perClient.set(c, (perClient.get(c) ?? 0) + 1);
    const buckets = { 1: 0, 2: 0, 3: 0, '4+': 0 };
    for (const n of perClient.values()) buckets[n >= 4 ? '4+' : n]++;

    const bySpecies = breakdown(rows, (p) => p.species);
    const missingBreed = breakdown(rows.filter((p) => isBlank(p.breed)), (p) => p.species);
    const elderly = rows.filter((p) => {
      const limit = LONG_LIVED[p.species];
      const age = ageYears(p, ctx.now);
      return limit && age !== null && age > limit && p.deceased !== true;
    });

    return [
      { label: 'Total pets', value: rows.length },
      { label: 'Active', value: rows.filter(live).length },
      { label: 'Deceased', value: rows.filter((p) => p.deceased === true).length },
      { label: 'Archived (all owner links archived)', value: rows.filter((p) => (p.clientsPets ?? []).length && (p.clientsPets ?? []).every((cp) => cp.isArchived === true)).length },
      { label: 'By species', breakdown: bySpecies },
      { label: 'Pets per client', breakdown: Object.entries(buckets).map(([key, count]) => ({ key, label: `${key} pet${key === '1' ? '' : 's'}`, count })) },
      { label: 'Missing DOB', value: rows.filter((p) => isBlank(p.dob)).length },
      { label: 'Missing sex', value: rows.filter((p) => isBlank(p.sex)).length },
      { label: 'Missing breed, by species', breakdown: missingBreed },
      { label: 'Over expected lifespan', value: plural(elderly.length, 'pet') },
      { label: 'Microchipped flag set', value: rows.filter((p) => p.microchipped === true).length },
      { label: 'Microchip number present', value: rows.filter((p) => !isBlank(p.microchip)).length },
      { label: 'With an active insurance policy', value: rows.filter((p) => ctx.ix.insuredPetIds.has(p.id)).length },
    ];
  },

  rules: [
    {
      id: 'pets.species.missing', severity: 'critical',
      title: 'Pet has no species',
      why: 'Species drives dosing, reminders and appointment types. Nothing downstream works without it.',
      run: (ctx, rows) => rows.filter((p) => isBlank(p.species)).map((p) => ({
        record: p, display: p.name ?? '(unnamed)',
        fields: { breed: p.breed, owner: owners(p)[0] ?? '(none)' },
      })),
    },
    {
      id: 'pets.dob.missing', severity: 'info',
      title: 'Active pet with no date of birth',
      run: (ctx, rows) => rows.filter((p) => live(p) && isBlank(p.dob)).map((p) => ({
        record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, breed: p.breed },
      })),
    },
    {
      id: 'pets.dob.implausible', severity: 'review',
      title: 'Date of birth is in the future or before 1990',
      run: (ctx, rows) => rows.filter((p) => {
        const d = parseDate(p.dob);
        return d && (d > ctx.now || d.getUTCFullYear() < 1990);
      }).map((p) => ({ record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, dob: p.dob } })),
    },
    {
      id: 'pets.sex.missing', severity: 'info',
      title: 'Pet has no sex recorded',
      run: (ctx, rows) => rows.filter((p) => isBlank(p.sex)).map((p) => ({
        record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, breed: p.breed },
      })),
    },
    {
      id: 'pets.microchip.flagWithoutNumber', severity: 'review',
      title: 'Marked as microchipped but no chip number recorded',
      run: (ctx, rows) => rows.filter((p) => p.microchipped === true && isBlank(p.microchip)).map((p) => ({
        record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, owner: owners(p)[0] ?? '(none)' },
      })),
    },
    {
      id: 'pets.microchip.malformed', severity: 'review',
      title: 'Microchip number is not 15 digits',
      clientFacing: 'Microchip number does not look like a standard 15-digit chip.',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.microchip) && !MICROCHIP.test(microchipKey(p.microchip))).map((p) => ({
        record: p, display: p.name ?? '(unnamed)', fields: { microchip: p.microchip },
      })),
    },
    {
      id: 'pets.deceased.noDate', severity: 'review',
      title: 'Marked deceased with no date of death',
      run: (ctx, rows) => rows.filter((p) => p.deceased === true && isBlank(p.deceasedDate)).map((p) => ({
        record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, owner: owners(p)[0] ?? '(none)' },
      })),
    },
    {
      id: 'pets.deceased.dateWithoutFlag', severity: 'critical',
      title: 'Has a date of death but is not marked deceased',
      why: 'The pet will still receive reminders and can still be booked.',
      run: (ctx, rows) => rows.filter((p) => p.deceased !== true && !isBlank(p.deceasedDate)).map((p) => ({
        record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, deceasedDate: p.deceasedDate },
      })),
    },
    {
      id: 'pets.neutered.noDate', severity: 'info',
      title: 'Marked neutered with no date',
      run: (ctx, rows) => rows.filter((p) => p.neutered === true && isBlank(p.neuteredDate)).map((p) => ({
        record: p, display: p.name ?? '(unnamed)', fields: { species: p.species },
      })),
    },
    {
      id: 'pets.weights.none', severity: 'info',
      title: 'Active dog or cat with no weight ever recorded',
      run: (ctx, rows) => rows.filter((p) => live(p) && ['dog', 'cat'].includes(lower(p.species)) && !(p.weights ?? []).length).map((p) => ({
        record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, breed: p.breed },
      })),
    },
    {
      id: 'pets.owner.none', severity: 'critical',
      title: 'Orphan pet — no owner at all',
      why: 'Cannot be found by staff, cannot be billed, cannot be contacted about.',
      run: (ctx, rows) => rows.filter((p) => !(p.clientsPets ?? []).length).map((p) => ({
        record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, id: p.id },
      })),
    },
    {
      id: 'pets.owner.allArchived', severity: 'review',
      title: 'Live pet whose every owner link is archived',
      run: (ctx, rows) => rows.filter((p) =>
        (p.clientsPets ?? []).length && (p.clientsPets ?? []).every((cp) => cp.isArchived === true) && p.deceased !== true,
      ).map((p) => ({ record: p, display: p.name ?? '(unnamed)', fields: { species: p.species } })),
    },
    {
      id: 'pets.owner.dangling', severity: 'critical',
      title: 'Pet linked to a client that does not exist',
      needs: 'clients',
      run: (ctx, rows) => rows.flatMap((p) =>
        owners(p).filter((c) => !ctx.ix.clientIds.has(c)).map((c) => ({
          record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, danglingClientId: c },
        })),
      ),
    },
    {
      id: 'pets.duplicate.microchip', severity: 'critical',
      title: 'Two pets share a microchip number',
      why: 'One of them is wrong, and the chip registry will disagree with Lupa either way.',
      group: true,
      run: (ctx, rows) => chipGroups(rows)
        .filter(([, group]) => !onePetManySites(ctx, group))
        .flatMap(([key, group]) => group.map((p) => ({
          record: p, display: p.name ?? '(unnamed)', groupKey: key,
          fields: { species: p.species, microchip: p.microchip, owner: owners(p)[0] ?? '(none)' },
          reason: `Shared with ${group.length - 1} other`,
        }))),
    },
    {
      id: 'pets.multiSite', severity: 'info',
      title: 'Same pet registered at more than one site',
      why: 'Same chip, same pet name, same owner name, one record per site. Expected for a multi-site practice, so not reported as a shared chip — listed so it can be confirmed.',
      group: true,
      run: (ctx, rows) => chipGroups(rows)
        .filter(([, group]) => onePetManySites(ctx, group))
        .flatMap(([key, group]) => {
          const siteName = (p) => {
            const id = ctx.ix.clientStore.get(activeOwner(p));
            return ctx.storeNames.get(id) ?? id;
          };
          return group.map((p) => ({
            record: p, display: p.name ?? '(unnamed)', groupKey: key,
            fields: { species: p.species, microchip: p.microchip, owner: activeOwner(p), store: siteName(p) },
            reason: `Also at ${group.filter((o) => o !== p).map(siteName).join(', ')}`,
          }));
        }),
    },
    {
      id: 'pets.duplicate.sameOwner', severity: 'review',
      title: 'One client has two pets with the same name, species and date of birth',
      group: true,
      run: (ctx, rows) => collisions(
        rows.filter((p) => owners(p).length && !isBlank(p.dob)),
        (p) => `${owners(p)[0]}|${lower(p.name)}|${lower(p.species)}|${p.dob}`,
      ).flatMap(([key, group]) => group.map((p) => ({
        record: p, display: p.name ?? '(unnamed)', groupKey: key,
        fields: { species: p.species, dob: p.dob, owner: owners(p)[0] },
      }))),
    },
  ],
};
