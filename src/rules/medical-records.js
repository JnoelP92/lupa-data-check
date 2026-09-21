// Section 6.9 — Medical records.
import { isBlank, lower, breakdown, parseDate, daysAgo } from '../util.js';

const label = (r) => r.title ?? `${r.type ?? 'record'} / ${r.category ?? 'uncategorised'}`;
const THIRTY_YEARS = 30 * 365.25 * 86_400_000;

export default {
  key: 'medicalRecords',
  label: 'Medical records',
  linkType: 'medicalRecord',

  tally(ctx, rows) {
    const perPet = new Map();
    for (const r of rows) if (r.petId) perPet.set(r.petId, (perPet.get(r.petId) ?? 0) + 1);
    const buckets = { '1-5': 0, '6-10': 0, '11-20': 0, '21+': 0 };
    for (const n of perPet.values()) {
      if (n <= 5) buckets['1-5']++; else if (n <= 10) buckets['6-10']++; else if (n <= 20) buckets['11-20']++; else buckets['21+']++;
    }
    const overdue = rows.filter((r) => {
      const d = parseDate(r.nextDueDate);
      return lower(r.category) === 'vaccination' && lower(r.type) === 'preventive' && d && d < ctx.now;
    });
    return [
      { label: 'Total records', value: rows.length },
      { label: 'By type', breakdown: breakdown(rows, (r) => r.type) },
      { label: 'By category', breakdown: breakdown(rows, (r) => r.category) },
      { label: 'Pets with no medical records', value: Math.max(0, ctx.ix.petIds.size - perPet.size) },
      { label: 'Records per pet', breakdown: Object.entries(buckets).map(([key, count]) => ({ key, label: key, count })) },
      { label: 'Missing date', value: rows.filter((r) => isBlank(r.date)).length },
      { label: 'Missing title', value: rows.filter((r) => isBlank(r.title)).length },
      { label: 'Missing description', value: rows.filter((r) => isBlank(r.description)).length },
      { label: 'Vaccinations past their next-due date', value: overdue.length },
    ];
  },

  rules: [
    {
      id: 'medicalRecords.date.missing', severity: 'critical',
      title: 'Record with no date',
      why: 'Cannot be placed in a history, cannot drive a booster interval.',
      run: (ctx, rows) => rows.filter((r) => isBlank(r.date)).map((r) => ({
        record: r, display: label(r), fields: { petId: r.petId, type: r.type, category: r.category },
      })),
    },
    {
      id: 'medicalRecords.title.missing', severity: 'review',
      title: 'Record with no title',
      run: (ctx, rows) => rows.filter((r) => isBlank(r.title)).map((r) => ({
        record: r, display: label(r), fields: { petId: r.petId, category: r.category, date: r.date },
      })),
    },
    {
      id: 'medicalRecords.vaccination.noNextDue', severity: 'review',
      title: 'Vaccination with no next-due date',
      clientFacing: 'Vaccination recorded without a booster due date.',
      why: 'No booster reminder can be generated from it.',
      run: (ctx, rows) => rows.filter((r) => lower(r.type) === 'preventive' && lower(r.category) === 'vaccination' && isBlank(r.nextDueDate)).map((r) => ({
        record: r, display: label(r), fields: { petId: r.petId, date: r.date },
      })),
    },
    {
      id: 'medicalRecords.date.future', severity: 'critical',
      title: 'Record dated in the future',
      run: (ctx, rows) => rows.filter((r) => {
        const d = parseDate(r.date);
        return d && d > ctx.now;
      }).map((r) => ({ record: r, display: label(r), fields: { petId: r.petId, date: r.date } })),
    },
    {
      id: 'medicalRecords.date.endBeforeStart', severity: 'critical',
      title: 'Record ends before it starts',
      run: (ctx, rows) => rows.filter((r) => {
        const s = parseDate(r.date), e = parseDate(r.endDate);
        return s && e && e < s;
      }).map((r) => ({ record: r, display: label(r), fields: { petId: r.petId, date: r.date, endDate: r.endDate } })),
    },
    {
      id: 'medicalRecords.date.ancient', severity: 'review',
      title: 'Record dated more than 30 years ago',
      why: 'Usually a migration date default rather than a real historical record.',
      run: (ctx, rows) => rows.filter((r) => {
        const d = parseDate(r.date);
        return d && ctx.now - d > THIRTY_YEARS;
      }).map((r) => ({ record: r, display: label(r), fields: { petId: r.petId, date: r.date } })),
    },
    {
      id: 'medicalRecords.ref.pet', severity: 'critical',
      title: 'Record for a pet that does not exist',
      run: (ctx, rows) => rows.filter((r) => !isBlank(r.petId) && !ctx.ix.petIds.has(r.petId)).map((r) => ({
        record: r, display: label(r), fields: { danglingPetId: r.petId, date: r.date },
      })),
    },
    {
      id: 'medicalRecords.ref.appointment', severity: 'critical',
      title: 'Record attached to an appointment that does not exist',
      run: (ctx, rows) => rows.filter((r) => !isBlank(r.appointmentId) && !ctx.ix.appointmentIds.has(r.appointmentId)).map((r) => ({
        record: r, display: label(r), fields: { danglingAppointmentId: r.appointmentId },
      })),
    },
    {
      id: 'medicalRecords.vaccination.overdue', severity: 'review',
      title: 'Vaccination overdue by more than 30 days with no later record',
      clientFacing: 'Booster appears overdue with nothing recorded since.',
      truncate: 25,
      run: (ctx, rows) => {
        const latestByPet = new Map();
        for (const r of rows) {
          const d = parseDate(r.date);
          if (!d || !r.petId) continue;
          const prev = latestByPet.get(r.petId);
          if (!prev || d > prev) latestByPet.set(r.petId, d);
        }
        const cutoff = daysAgo(30, ctx.now.getTime());
        return rows.filter((r) => {
          if (lower(r.type) !== 'preventive' || lower(r.category) !== 'vaccination') return false;
          const due = parseDate(r.nextDueDate);
          if (!due || due >= cutoff) return false;
          const latest = latestByPet.get(r.petId);
          return !latest || latest <= due;
        }).map((r) => ({
          record: r, display: label(r),
          fields: { pet: ctx.ix.petName.get(r.petId) ?? r.petId, nextDueDate: r.nextDueDate },
        }));
      },
    },
  ],
};
