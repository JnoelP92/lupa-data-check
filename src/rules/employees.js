// Section 6.13 — Employees.
import { isBlank, lower, breakdown, collisions } from '../util.js';

const name = (e) => [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || '(unnamed)';
const active = (e) => lower(e.status) === 'active' || e.status === undefined;
const VET_ROLES = new Set(['vet', 'veterinarian', 'veterinary surgeon']);

export default {
  key: 'employees',
  label: 'Employees',
  linkType: 'employee',

  tally(ctx, rows) {
    return [
      { label: 'Total employees', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (e) => e.status) },
      { label: 'By role', breakdown: breakdown(rows, (e) => e.role) },
      { label: 'With no store assigned', value: rows.filter((e) => !(e.stores ?? []).length).length },
      { label: 'With no visit types', value: rows.filter((e) => !(e.visitTypes ?? []).length).length },
      { label: 'Hidden on every calendar', value: rows.filter((e) => (e.stores ?? []).length && (e.stores ?? []).every((s) => s.showInCalendar === false)).length },
      { label: 'Online booking point of contact', value: rows.filter((e) => e.isOnlineBookingPoc === true).length },
    ];
  },

  rules: [
    {
      id: 'employees.email.missing', severity: 'critical',
      title: 'Active employee with no email address',
      why: 'Cannot be invited, cannot reset a password, cannot receive anything.',
      run: (ctx, rows) => rows.filter((e) => active(e) && isBlank(e.email)).map((e) => ({
        record: e, display: name(e), fields: { role: e.role },
      })),
    },
    {
      id: 'employees.role.missing', severity: 'review',
      title: 'Employee with no role',
      run: (ctx, rows) => rows.filter((e) => isBlank(e.role)).map((e) => ({
        record: e, display: name(e), fields: { email: e.email },
      })),
    },
    {
      id: 'employees.rcvs.missing', severity: 'review',
      title: 'Vet with no RCVS registration number',
      why: 'Regulatory records need it, and prescriptions reference the prescriber.',
      run: (ctx, rows) => rows.filter((e) => VET_ROLES.has(lower(e.role)) && isBlank(e.rcvsRegistrationNumber)).map((e) => ({
        record: e, display: name(e), fields: { role: e.role },
      })),
    },
    {
      id: 'employees.stores.none', severity: 'critical',
      title: 'Active employee assigned to no store',
      run: (ctx, rows) => rows.filter((e) => active(e) && !(e.stores ?? []).length).map((e) => ({
        record: e, display: name(e), fields: { role: e.role, email: e.email },
      })),
    },
    {
      id: 'employees.visitTypes.none', severity: 'review',
      title: 'Active employee with no visit types — silently un-bookable',
      run: (ctx, rows) => rows.filter((e) => active(e) && !(e.visitTypes ?? []).length).map((e) => ({
        record: e, display: name(e), fields: { role: e.role },
      })),
    },
    {
      id: 'employees.calendar.hidden', severity: 'review',
      title: 'Active employee hidden on every calendar',
      run: (ctx, rows) => rows.filter((e) => active(e) && (e.stores ?? []).length && (e.stores ?? []).every((s) => s.showInCalendar === false)).map((e) => ({
        record: e, display: name(e), fields: { role: e.role },
      })),
    },
    {
      id: 'employees.duplicate.email', severity: 'critical',
      title: 'Two employees share an email address',
      group: true,
      run: (ctx, rows) => collisions(rows, (e) => lower(e.email)).flatMap(([key, group]) =>
        group.map((e) => ({ record: e, display: name(e), groupKey: key, fields: { email: e.email, role: e.role } })),
      ),
    },
    {
      id: 'employees.duplicate.name', severity: 'review',
      title: 'Two active employees share a name',
      group: true,
      run: (ctx, rows) => collisions(rows.filter(active), (e) => `${lower(e.firstName)}|${lower(e.lastName)}`)
        .flatMap(([key, group]) => group.map((e) => ({ record: e, display: name(e), groupKey: key, fields: { email: e.email, role: e.role } }))),
    },
    {
      id: 'employees.ref.store', severity: 'critical',
      title: 'Employee assigned to a store that is not on this company',
      needs: 'stores',
      run: (ctx, rows) => rows.flatMap((e) =>
        (e.stores ?? []).filter((s) => s.id && !ctx.storeIds.has(s.id)).map((s) => ({
          record: e, display: name(e), fields: { role: e.role, danglingStoreId: s.id },
        })),
      ),
    },
  ],
};
