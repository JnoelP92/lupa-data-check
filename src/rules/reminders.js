// Section 6.7 — Reminders.
//
// Scope note, carried from the spec: this endpoint returns reminder *definitions* — the
// templates — not pet-level scheduled instances. The rule "deceased pet with an active
// reminder" needs pet schedules, which the public API does not expose, so it is not
// implemented and is recorded as such in references/ruleset-v1.md rather than silently
// omitted.
import { isBlank, lower, breakdown, collisions } from '../util.js';

export default {
  key: 'reminders',
  label: 'Reminders',
  linkType: 'reminder',

  tally(ctx, rows) {
    return [
      { label: 'Total reminders', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (r) => r.status) },
      { label: 'By schedule type', breakdown: breakdown(rows, (r) => r.petScheduleType) },
      { label: 'Auto-repeat on', value: rows.filter((r) => r.enableAutoRepeat === true).length },
      { label: 'Remind if missed on', value: rows.filter((r) => r.remindIfMissed === true).length },
      { label: 'With no delivery channel', value: rows.filter((r) => !(r.reminderMediums ?? []).length).length },
    ];
  },

  rules: [
    {
      id: 'reminders.channel.none', severity: 'critical',
      title: 'Active reminder with no delivery channel',
      clientFacing: 'Reminder is switched on but has no way to reach anyone.',
      why: 'Silently sends nothing. Looks configured from the list view.',
      run: (ctx, rows) => rows.filter((r) => lower(r.status) === 'active' && !(r.reminderMediums ?? []).length).map((r) => ({
        record: r, display: r.name, fields: { petScheduleType: r.petScheduleType },
      })),
    },
    {
      id: 'reminders.timing.noLeadTime', severity: 'review',
      title: 'Active one-off reminder with no lead time',
      run: (ctx, rows) => rows.filter((r) => lower(r.status) === 'active' && (isBlank(r.remindDaysBefore) || Number(r.remindDaysBefore) === 0) && r.enableAutoRepeat === false).map((r) => ({
        record: r, display: r.name, fields: { petScheduleType: r.petScheduleType, remindDaysBefore: r.remindDaysBefore },
      })),
    },
    {
      id: 'reminders.timing.negativeLead', severity: 'critical',
      title: 'Negative lead time',
      run: (ctx, rows) => rows.filter((r) => Number(r.remindDaysBefore ?? 0) < 0).map((r) => ({
        record: r, display: r.name, fields: { remindDaysBefore: r.remindDaysBefore },
      })),
    },
    {
      id: 'reminders.timing.missedWithoutDelay', severity: 'critical',
      title: 'Remind-if-missed is on with no follow-up delay',
      run: (ctx, rows) => rows.filter((r) => r.remindIfMissed === true && (isBlank(r.remindDaysAfter) || Number(r.remindDaysAfter) <= 0)).map((r) => ({
        record: r, display: r.name, fields: { remindDaysAfter: r.remindDaysAfter },
      })),
    },
    {
      id: 'reminders.repeat.noInterval', severity: 'critical',
      title: 'Auto-repeat is on with no interval',
      run: (ctx, rows) => rows.filter((r) => r.enableAutoRepeat === true && isBlank(r.interval)).map((r) => ({
        record: r, display: r.name, fields: { petScheduleType: r.petScheduleType },
      })),
    },
    {
      id: 'reminders.status.draft', severity: 'review',
      title: 'Reminder still in draft',
      why: 'Drafts are unpublished and will never fire.',
      run: (ctx, rows) => rows.filter((r) => lower(r.status) === 'draft').map((r) => ({
        record: r, display: r.name, fields: { petScheduleType: r.petScheduleType },
      })),
    },
    {
      id: 'reminders.duplicate.name', severity: 'review',
      title: 'Two active reminders share a name',
      group: true,
      run: (ctx, rows) => collisions(rows.filter((r) => lower(r.status) === 'active'), (r) => lower(r.name))
        .flatMap(([key, group]) => group.map((r) => ({ record: r, display: r.name, groupKey: key, fields: { petScheduleType: r.petScheduleType } }))),
    },
  ],
};
