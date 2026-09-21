// Section 6.12.2 — Health plan subscriptions.
import { isBlank, lower, breakdown, collisions, parseDate, daysAgo } from '../util.js';

const subscriberName = (ctx, s) =>
  lower(s.subscriberType) === 'pet'
    ? ctx.ix.petName.get(s.subscriberId) ?? '(unknown pet)'
    : ctx.ix.clientName.get(s.subscriberId)?.name ?? '(unknown client)';

export default {
  key: 'healthPlanSubscriptions',
  label: 'Health plan subscriptions',
  linkType: 'healthPlan',

  tally(ctx, rows) {
    return [
      { label: 'Total subscriptions', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (s) => s.status) },
      { label: 'By subscriber type', breakdown: breakdown(rows, (s) => s.subscriberType) },
      { label: 'By plan', breakdown: breakdown(rows, (s) => s.healthPlanId) },
      { label: 'Cancellations by reason', breakdown: breakdown(rows.filter((s) => lower(s.status) === 'cancelled'), (s) => s.cancellationReason) },
      { label: 'Payment not enabled', value: rows.filter((s) => s.paymentEnabled === false).length },
      { label: 'Never used an allowance', value: rows.filter((s) => !(s.usages ?? []).length).length },
    ];
  },

  rules: [
    {
      id: 'subscriptions.status.activeButEnded', severity: 'critical',
      title: 'Active subscription with an end date in the past',
      why: 'Still billing, or still granting benefits, after it should have stopped.',
      run: (ctx, rows) => rows.filter((s) => {
        const e = parseDate(s.endedOn);
        return lower(s.status) === 'active' && e && e < ctx.now;
      }).map((s) => ({ record: s, display: subscriberName(ctx, s), fields: { plan: s.healthPlanId, startedOn: s.startedOn, endedOn: s.endedOn } })),
    },
    {
      id: 'subscriptions.status.activeInFuture', severity: 'review',
      title: 'Active subscription that has not started yet',
      run: (ctx, rows) => rows.filter((s) => {
        const st = parseDate(s.startedOn);
        return lower(s.status) === 'active' && st && st > ctx.now;
      }).map((s) => ({ record: s, display: subscriberName(ctx, s), fields: { plan: s.healthPlanId, startedOn: s.startedOn } })),
    },
    {
      id: 'subscriptions.status.cancelledNoEnd', severity: 'review',
      title: 'Cancelled subscription with no end date',
      run: (ctx, rows) => rows.filter((s) => lower(s.status) === 'cancelled' && isBlank(s.endedOn)).map((s) => ({
        record: s, display: subscriberName(ctx, s), fields: { plan: s.healthPlanId, cancellationReason: s.cancellationReason },
      })),
    },
    {
      id: 'subscriptions.status.stuckSignup', severity: 'review',
      title: 'Signup stuck awaiting payment for over a week',
      run: (ctx, rows) => rows.filter((s) => {
        const c = parseDate(s.createdAt);
        return lower(s.status) === 'pending_payment' && c && c < daysAgo(7, ctx.now.getTime());
      }).map((s) => ({ record: s, display: subscriberName(ctx, s), fields: { plan: s.healthPlanId, createdAt: s.createdAt } })),
    },
    {
      id: 'subscriptions.ref.subscriber', severity: 'critical',
      title: 'Subscriber does not exist',
      run: (ctx, rows) => rows.filter((s) => {
        if (isBlank(s.subscriberId)) return true;
        return lower(s.subscriberType) === 'pet' ? !ctx.ix.petIds.has(s.subscriberId) : !ctx.ix.clientIds.has(s.subscriberId);
      }).map((s) => ({ record: s, display: '(dangling)', fields: { subscriberType: s.subscriberType, subscriberId: s.subscriberId, plan: s.healthPlanId } })),
    },
    {
      id: 'subscriptions.ref.plan', severity: 'critical',
      title: 'Subscription points at a plan that does not exist',
      run: (ctx, rows) => rows.filter((s) => !isBlank(s.healthPlanId) && !ctx.ix.healthPlanIds.has(s.healthPlanId)).map((s) => ({
        record: s, display: subscriberName(ctx, s), fields: { danglingPlanId: s.healthPlanId },
      })),
    },
    {
      id: 'subscriptions.state.deceasedPet', severity: 'critical',
      title: 'Active subscription for a deceased pet',
      clientFacing: 'A pet recorded as deceased still has an active plan.',
      why: 'Still billing the client for an animal that has died.',
      run: (ctx, rows) => rows.filter((s) => lower(s.status) === 'active' && lower(s.subscriberType) === 'pet' && ctx.ix.petIsDeceased.has(s.subscriberId)).map((s) => ({
        record: s, display: subscriberName(ctx, s), fields: { plan: s.healthPlanId, startedOn: s.startedOn },
      })),
    },
    {
      id: 'subscriptions.state.archivedClient', severity: 'critical',
      title: 'Active subscription for an archived client',
      run: (ctx, rows) => rows.filter((s) => lower(s.status) === 'active' && lower(s.subscriberType) === 'client' && ctx.ix.clientIsArchived.has(s.subscriberId)).map((s) => ({
        record: s, display: subscriberName(ctx, s), fields: { plan: s.healthPlanId },
      })),
    },
    {
      id: 'subscriptions.duplicate.active', severity: 'critical',
      title: 'Same subscriber active on the same plan twice',
      why: 'Billed twice a month for the same benefits.',
      group: true,
      run: (ctx, rows) => collisions(rows.filter((s) => lower(s.status) === 'active'), (s) => `${s.subscriberId}|${s.healthPlanId}`)
        .flatMap(([key, group]) => group.map((s) => ({ record: s, display: subscriberName(ctx, s), groupKey: key, fields: { plan: s.healthPlanId, startedOn: s.startedOn } }))),
    },
    {
      id: 'subscriptions.payment.notEnabled', severity: 'review',
      title: 'Active subscription to a paid plan with payment not enabled',
      run: (ctx, rows) => rows.filter((s) => s.paymentEnabled === false && lower(s.status) === 'active' && (ctx.ix.planPrice.get(s.healthPlanId) ?? 0) > 0).map((s) => ({
        record: s, display: subscriberName(ctx, s), fields: { plan: s.healthPlanId },
      })),
    },
    {
      id: 'subscriptions.payment.noDay', severity: 'review',
      title: 'Active subscription with no payment day',
      run: (ctx, rows) => rows.filter((s) => lower(s.status) === 'active' && isBlank(s.paymentDay)).map((s) => ({
        record: s, display: subscriberName(ctx, s), fields: { plan: s.healthPlanId },
      })),
    },
  ],
};
