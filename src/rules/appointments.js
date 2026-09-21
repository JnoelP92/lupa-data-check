// Section 6.3 — Appointments.
//
// The window defaults to everything: a migration audit needs every record. `--since`
// on the pull narrows it for periodic re-checks.
import { isBlank, lower, breakdown, collisions, parseDate, daysAgo } from '../util.js';

const OPEN = new Set(['requested', 'confirmed']);
const HAPPENED = new Set(['completed', 'checked_in', 'in_progress', 'ready_for_checkout']);
const LONG_OK = new Set(['hospital', 'overnight']);
const EIGHT_HOURS = 8 * 3600_000;
const title = (a) => a.title ?? a.visitTypeName ?? '(untitled)';
const mainEmployee = (a) => (a.employees ?? []).find((e) => e.isMainEmployee)?.id ?? null;

export default {
  key: 'appointments',
  label: 'Appointments',
  linkType: 'appointment',

  tally(ctx, rows) {
    const cancelled = rows.filter((a) => lower(a.status) === 'cancelled').length;
    const noShow = rows.filter((a) => lower(a.status) === 'no_show').length;
    const pct = (n) => (rows.length ? `${((n / rows.length) * 100).toFixed(1)}%` : '—');
    return [
      { label: 'Total appointments', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (a) => a.status) },
      { label: 'By store', breakdown: breakdown(rows, (a) => a.storeId, { labels: ctx.storeNames }) },
      { label: 'By visit type category', breakdown: breakdown(rows, (a) => a.visitTypeCategory) },
      { label: 'By lead clinician', breakdown: breakdown(rows, mainEmployee) },
      { label: 'With no clinician at all', value: rows.filter((a) => !(a.employees ?? []).length).length },
      { label: 'Cancellation rate', value: `${pct(cancelled)} (${cancelled})` },
      { label: 'No-show rate', value: `${pct(noShow)} (${noShow})` },
    ];
  },

  rules: [
    {
      id: 'appointments.time.endBeforeStart', severity: 'critical',
      title: 'Appointment ends before it starts',
      run: (ctx, rows) => rows.filter((a) => {
        const s = parseDate(a.start), e = parseDate(a.end);
        return s && e && e < s;
      }).map((a) => ({ record: a, display: title(a), fields: { start: a.start, end: a.end, petId: a.petId } })),
    },
    {
      id: 'appointments.time.zeroLength', severity: 'review',
      title: 'Zero-duration appointment',
      run: (ctx, rows) => rows.filter((a) => a.start && a.end && a.start === a.end).map((a) => ({
        record: a, display: title(a), fields: { start: a.start },
      })),
    },
    {
      id: 'appointments.time.tooLong', severity: 'review',
      title: 'Appointment longer than 8 hours outside hospital or overnight',
      run: (ctx, rows) => rows.filter((a) => {
        const s = parseDate(a.start), e = parseDate(a.end);
        return s && e && e - s > EIGHT_HOURS && !LONG_OK.has(lower(a.visitTypeCategory));
      }).map((a) => ({ record: a, display: title(a), fields: { category: a.visitTypeCategory, start: a.start, end: a.end } })),
    },
    {
      id: 'appointments.status.futureButDone', severity: 'critical',
      title: 'Future appointment already marked as happened',
      why: 'Usually a migrated status that did not map. It will not appear on any worklist.',
      run: (ctx, rows) => rows.filter((a) => {
        const s = parseDate(a.start);
        return s && s > ctx.now && HAPPENED.has(lower(a.status));
      }).map((a) => ({ record: a, display: title(a), fields: { start: a.start, status: a.status } })),
    },
    {
      id: 'appointments.status.staleOpen', severity: 'review',
      title: 'Past appointment still open',
      clientFacing: 'Appointment in the past is still marked as requested or confirmed.',
      run: (ctx, rows) => rows.filter((a) => {
        const s = parseDate(a.start);
        return s && s < daysAgo(7, ctx.now.getTime()) && OPEN.has(lower(a.status));
      }).map((a) => ({ record: a, display: title(a), fields: { start: a.start, status: a.status } })),
    },
    {
      id: 'appointments.status.checkedInButRequested', severity: 'review',
      title: 'Checked in but status is still requested',
      run: (ctx, rows) => rows.filter((a) => !isBlank(a.checkedInAt) && lower(a.status) === 'requested').map((a) => ({
        record: a, display: title(a), fields: { start: a.start, checkedInAt: a.checkedInAt },
      })),
    },
    {
      id: 'appointments.status.lateCheckIn', severity: 'review',
      title: 'Checked in more than 24 hours before the appointment',
      why: 'Usually someone checking in yesterday’s list against today’s date.',
      run: (ctx, rows) => rows.filter((a) => {
        const s = parseDate(a.start), c = parseDate(a.checkedInAt);
        return s && c && s - c > 86_400_000;
      }).map((a) => ({ record: a, display: title(a), fields: { start: a.start, checkedInAt: a.checkedInAt } })),
    },
    {
      id: 'appointments.store.missing', severity: 'critical',
      title: 'Appointment with no store',
      run: (ctx, rows) => rows.filter((a) => isBlank(a.storeId)).map((a) => ({
        record: a, display: title(a), fields: { start: a.start },
      })),
    },
    {
      id: 'appointments.store.dangling', severity: 'critical',
      title: 'Appointment at a store that is not on this company',
      clientFacing: 'Appointment is linked to a location that no longer exists.',
      why: 'The "defaults to the old site" migration bug. These appointments are invisible on every real calendar.',
      needs: 'stores',
      run: (ctx, rows) => rows.filter((a) => !isBlank(a.storeId) && !ctx.storeIds.has(a.storeId)).map((a) => ({
        record: a, display: title(a), fields: { start: a.start, storeId: a.storeId },
      })),
    },
    {
      id: 'appointments.ref.pet', severity: 'critical',
      title: 'Appointment for a pet that does not exist',
      run: (ctx, rows) => rows.filter((a) => !isBlank(a.petId) && !ctx.ix.petIds.has(a.petId)).map((a) => ({
        record: a, display: title(a), fields: { start: a.start, danglingPetId: a.petId },
      })),
    },
    {
      id: 'appointments.ref.client', severity: 'critical',
      title: 'Appointment for a client that does not exist',
      run: (ctx, rows) => rows.filter((a) => !isBlank(a.clientId) && !ctx.ix.clientIds.has(a.clientId)).map((a) => ({
        record: a, display: title(a), fields: { start: a.start, danglingClientId: a.clientId },
      })),
    },
    {
      id: 'appointments.ref.petClientMismatch', severity: 'critical',
      title: 'Appointment client does not own the appointment pet',
      why: 'Billing and comms go to someone who is not the owner.',
      run: (ctx, rows) => rows.filter((a) => {
        if (isBlank(a.petId) || isBlank(a.clientId)) return false;
        // A client that does not exist is reported by appointments.ref.client. Saying it
        // also does not own the pet is noise on the same defect.
        if (!ctx.ix.clientIds.has(a.clientId)) return false;
        const owners = ctx.ix.petOwners.get(a.petId);
        return owners && owners.length > 0 && !owners.includes(a.clientId);
      }).map((a) => ({
        record: a, display: title(a),
        fields: { start: a.start, appointmentClient: a.clientId, actualOwners: (ctx.ix.petOwners.get(a.petId) ?? []).join(', ') },
      })),
    },
    {
      id: 'appointments.visitType.missing', severity: 'review',
      title: 'Appointment with no visit type',
      run: (ctx, rows) => rows.filter((a) => isBlank(a.visitTypeId)).map((a) => ({
        record: a, display: title(a), fields: { start: a.start, status: a.status },
      })),
    },
    {
      id: 'appointments.visitType.dangling', severity: 'critical',
      title: 'Visit type does not resolve',
      needs: 'appointmentTypes',
      run: (ctx, rows) => rows.filter((a) => !isBlank(a.visitTypeId) && !ctx.appointmentTypeIds.has(a.visitTypeId)).map((a) => ({
        record: a, display: title(a), fields: { start: a.start, visitTypeId: a.visitTypeId },
      })),
    },
    {
      id: 'appointments.visitType.nameMissing', severity: 'review',
      title: 'Visit type is set but has no name',
      run: (ctx, rows) => rows.filter((a) => !isBlank(a.visitTypeId) && isBlank(a.visitTypeName)).map((a) => ({
        record: a, display: title(a), fields: { visitTypeId: a.visitTypeId },
      })),
    },
    {
      id: 'appointments.ref.employee', severity: 'critical',
      title: 'Appointment assigned to an employee that does not exist',
      needs: 'employees',
      run: (ctx, rows) => rows.flatMap((a) =>
        (a.employees ?? []).filter((e) => e.id && !ctx.ix.employeeIds.has(e.id)).map((e) => ({
          record: a, display: title(a), fields: { start: a.start, danglingEmployeeId: e.id },
        })),
      ),
    },
    {
      id: 'appointments.duplicate.exact', severity: 'critical',
      title: 'Same pet booked twice at exactly the same time',
      why: 'Almost always a double import rather than a real double booking.',
      group: true,
      run: (ctx, rows) => collisions(rows.filter((a) => a.petId && a.start), (a) => `${a.petId}|${a.start}`)
        .flatMap(([key, group]) => group.map((a) => ({
          record: a, display: title(a), groupKey: key, fields: { start: a.start, status: a.status },
        }))),
    },
    {
      id: 'appointments.duplicate.sameDay', severity: 'review',
      title: 'Same pet, same day, same visit type, more than once',
      group: true,
      run: (ctx, rows) => collisions(
        rows.filter((a) => a.petId && a.start && a.visitTypeId && lower(a.status) !== 'cancelled'),
        (a) => `${a.petId}|${String(a.start).slice(0, 10)}|${a.visitTypeId}`,
      ).flatMap(([key, group]) => group.map((a) => ({
        record: a, display: title(a), groupKey: key, fields: { start: a.start, status: a.status },
      }))),
    },
    {
      id: 'appointments.employees.none', severity: 'review',
      title: 'Completed appointment with no clinician recorded',
      run: (ctx, rows) => rows.filter((a) => lower(a.status) === 'completed' && !(a.employees ?? []).length).map((a) => ({
        record: a, display: title(a), fields: { start: a.start },
      })),
    },
  ],
};
