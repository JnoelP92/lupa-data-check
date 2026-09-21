// Insurance policies.
//
// Not a numbered section in the ruleset document: the spec put insurance on the pet
// (`insuranceStatus`, `insurer`), and the pets resource carries neither. Policies are
// their own collection, keyed by petId, so the checks live here and the pets tally
// counts insured pets from the index this builds.
import { isBlank, breakdown, collisions } from '../util.js';

const label = (p) => p.policyNumber ?? `policy ${p.id?.slice(0, 8) ?? ''}`.trim();

export default {
  key: 'insurancePolicies',
  label: 'Insurance policies',
  linkType: 'pet',

  tally(ctx, rows) {
    const live = rows.filter((p) => p.isArchived !== true);
    return [
      { label: 'Total policies', value: rows.length },
      { label: 'Active', value: live.length },
      { label: 'Archived', value: rows.filter((p) => p.isArchived === true).length },
      { label: 'By insurer', breakdown: breakdown(live, (p) => p.insurerName) },
      { label: 'Pets with an active policy', value: new Set(live.map((p) => p.petId)).size },
      { label: 'Missing policy number', value: live.filter((p) => isBlank(p.policyNumber)).length },
      { label: 'Missing policy holder', value: live.filter((p) => isBlank(p.policyHolderName)).length },
    ];
  },

  rules: [
    {
      id: 'insurance.ref.pet', severity: 'critical',
      title: 'Policy for a pet that does not exist',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.petId) && !ctx.ix.petIds.has(p.petId)).map((p) => ({
        record: p, display: label(p), fields: { danglingPetId: p.petId, insurer: p.insurerName },
      })),
    },
    {
      id: 'insurance.policyNumber.missing', severity: 'review',
      title: 'Active policy with no policy number',
      clientFacing: 'Insurance policy recorded without a policy number.',
      why: 'A claim cannot be submitted against it.',
      run: (ctx, rows) => rows.filter((p) => p.isArchived !== true && isBlank(p.policyNumber)).map((p) => ({
        record: p, display: ctx.ix.petName.get(p.petId) ?? label(p),
        fields: { insurer: p.insurerName, holder: p.policyHolderName },
      })),
    },
    {
      id: 'insurance.holder.missing', severity: 'info',
      title: 'Active policy with no policy holder name',
      run: (ctx, rows) => rows.filter((p) => p.isArchived !== true && isBlank(p.policyHolderName)).map((p) => ({
        record: p, display: ctx.ix.petName.get(p.petId) ?? label(p),
        fields: { policyNumber: p.policyNumber, insurer: p.insurerName },
      })),
    },
    {
      id: 'insurance.duplicate.policyNumber', severity: 'review',
      title: 'Two active policies share a policy number',
      group: true,
      run: (ctx, rows) => collisions(rows.filter((p) => p.isArchived !== true), (p) => p.policyNumber)
        .flatMap(([key, group]) => group.map((p) => ({
          record: p, display: ctx.ix.petName.get(p.petId) ?? label(p), groupKey: key,
          fields: { policyNumber: p.policyNumber, insurer: p.insurerName },
        }))),
    },
    {
      id: 'insurance.deceased.activePolicy', severity: 'review',
      title: 'Active policy on a deceased pet',
      clientFacing: 'A pet recorded as deceased still has an active insurance policy.',
      run: (ctx, rows) => rows.filter((p) => p.isArchived !== true && ctx.ix.petIsDeceased.has(p.petId)).map((p) => ({
        record: p, display: ctx.ix.petName.get(p.petId) ?? label(p),
        fields: { policyNumber: p.policyNumber, insurer: p.insurerName },
      })),
    },
  ],
};
