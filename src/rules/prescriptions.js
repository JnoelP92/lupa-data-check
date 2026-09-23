// Section 6.10 — Prescriptions.
import { isBlank, lower, breakdown, parseDate, daysAgo } from '../util.js';

const label = (p) => p.productName ?? '(no product)';
const dispenses = (p) => (p.prescriptionDispenses ?? []).filter((d) => d.isCancelled !== true);
const YEAR = 365 * 86_400_000;

export default {
  key: 'prescriptions',
  label: 'Prescriptions',
  linkType: 'prescription',

  // A prescription has no page of its own; it lives on the pet's Medical Highlights
  // tab. Resolved here so the link survives redaction, which strips raw ids.
  linkFor(ctx, rx) {
    if (!rx.petId || !ctx.ix.petIds.has(rx.petId)) return { url: null };
    return { url: `https://work.lupapets.com/pets/${rx.petId}`, note: 'Medical Highlights tab' };
  },

  tally(ctx, rows) {
    const byPrescriber = breakdown(rows, (p) => p.employeeId).slice(0, 20);
    return [
      { label: 'Total prescriptions', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (p) => p.status) },
      { label: 'By dispense tracking mode', breakdown: breakdown(rows, (p) => p.dispenseTrackingMode) },
      { label: 'Prescription-only items', value: rows.filter((p) => p.isPrescribedOnly === true).length },
      { label: 'By prescriber (top 20)', breakdown: byPrescriber },
      { label: 'Missing prescriber', value: rows.filter((p) => isBlank(p.employeeId)).length },
      { label: 'Missing source product', value: rows.filter((p) => isBlank(p.sourceProductId)).length },
      { label: 'Missing expiry date', value: rows.filter((p) => isBlank(p.expiryDate)).length },
      { label: 'Expired but still pending', value: rows.filter((p) => {
        const e = parseDate(p.expiryDate);
        return lower(p.status) === 'pending' && e && e < ctx.now;
      }).length },
    ];
  },

  rules: [
    {
      id: 'prescriptions.prescriber.missing', severity: 'critical',
      title: 'Prescription with no prescriber',
      why: 'A prescription without a named prescriber is not a valid record.',
      run: (ctx, rows) => rows.filter((p) => isBlank(p.employeeId) && ['pending', 'completed'].includes(lower(p.status))).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, status: p.status },
      })),
    },
    {
      id: 'prescriptions.product.missingSource', severity: 'review',
      title: 'Prescription not linked to a product',
      why: 'The product was deleted, or the record was hand-created. Refills cannot price.',
      run: (ctx, rows) => rows.filter((p) => isBlank(p.sourceProductId)).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, status: p.status },
      })),
    },
    {
      id: 'prescriptions.product.nameMissing', severity: 'critical',
      title: 'Prescription with no product name',
      run: (ctx, rows) => rows.filter((p) => isBlank(p.productName)).map((p) => ({
        record: p, display: '(no product name)', fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, sourceProductId: p.sourceProductId },
      })),
    },
    {
      id: 'prescriptions.quantity.invalid', severity: 'critical',
      title: 'Quantity is zero or negative',
      run: (ctx, rows) => rows.filter((p) => Number(p.quantity ?? 0) <= 0).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, quantity: p.quantity },
      })),
    },
    {
      id: 'prescriptions.unit.missing', severity: 'review',
      title: 'Prescription with no unit',
      run: (ctx, rows) => rows.filter((p) => isBlank(p.unit)).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, quantity: p.quantity },
      })),
    },
    {
      id: 'prescriptions.expiry.missing', severity: 'review',
      title: 'Prescription with no expiry date',
      run: (ctx, rows) => rows.filter((p) => isBlank(p.expiryDate)).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, startDate: p.startDate },
      })),
    },
    {
      id: 'prescriptions.expiry.expiredPending', severity: 'review',
      title: 'Expired but still pending',
      clientFacing: 'Prescription has expired but is still open.',
      run: (ctx, rows) => rows.filter((p) => {
        const e = parseDate(p.expiryDate);
        return lower(p.status) === 'pending' && e && e < ctx.now;
      }).map((p) => ({ record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, expiryDate: p.expiryDate } })),
    },
    {
      id: 'prescriptions.dates.startAfterEnd', severity: 'critical',
      title: 'Starts after it ends',
      run: (ctx, rows) => rows.filter((p) => {
        const s = parseDate(p.startDate), e = parseDate(p.endDate);
        return s && e && s > e;
      }).map((p) => ({ record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, startDate: p.startDate, endDate: p.endDate } })),
    },
    {
      id: 'prescriptions.dates.futureStart', severity: 'info',
      title: 'Pending prescription starting in the future',
      run: (ctx, rows) => rows.filter((p) => {
        const s = parseDate(p.startDate);
        return lower(p.status) === 'pending' && s && s > ctx.now;
      }).map((p) => ({ record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, startDate: p.startDate } })),
    },
    {
      id: 'prescriptions.dates.overLongCourse', severity: 'review',
      title: 'Course longer than a year',
      run: (ctx, rows) => rows.filter((p) => {
        const s = parseDate(p.startDate), e = parseDate(p.endDate);
        return s && e && e - s > YEAR;
      }).map((p) => ({ record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, startDate: p.startDate, endDate: p.endDate } })),
    },
    {
      id: 'prescriptions.refill.negativeLimit', severity: 'critical',
      title: 'Negative refill limit',
      run: (ctx, rows) => rows.filter((p) => Number(p.refillLimit ?? 0) < 0).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, refillLimit: p.refillLimit },
      })),
    },
    {
      id: 'prescriptions.refill.overDispensed', severity: 'critical',
      title: 'Dispensed more times than the refill limit allows',
      clientFacing: 'Medication dispensed more times than the prescription permits.',
      why: 'Initial dispense plus refills. Over that is a controlled-drug problem, not a data one.',
      // A negative limit is reported by prescriptions.refill.negativeLimit; reporting it
      // here too would double-count the same defect.
      run: (ctx, rows) => rows.filter((p) => Number(p.refillLimit ?? -1) >= 0 && dispenses(p).length > Number(p.refillLimit) + 1).map((p) => ({
        record: p, display: label(p),
        fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, refillLimit: p.refillLimit, dispensed: dispenses(p).length },
      })),
    },
    {
      id: 'prescriptions.dispense.completedWithNone', severity: 'review',
      title: 'Completed with dispense tracking on but nothing dispensed',
      run: (ctx, rows) => rows.filter((p) => lower(p.dispenseTrackingMode) === 'with_dispenses' && lower(p.status) === 'completed' && !(p.prescriptionDispenses ?? []).length).map((p) => ({
        record: p, display: label(p), fields: { petId: p.petId },
      })),
    },
    {
      id: 'prescriptions.dispense.neverHandedOver', severity: 'review',
      title: 'Authorised over a week ago and never handed to the client',
      run: (ctx, rows) => rows.flatMap((p) => (p.prescriptionDispenses ?? [])
        .filter((d) => {
          const a = parseDate(d.authorisedAt);
          return isBlank(d.handedToClientAt) && a && a < daysAgo(7, ctx.now.getTime());
        })
        .map((d) => ({ record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, authorisedAt: d.authorisedAt } }))),
    },
    {
      id: 'prescriptions.ref.pet', severity: 'critical',
      title: 'Prescription for a pet that does not exist',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.petId) && !ctx.ix.petIds.has(p.petId)).map((p) => ({
        record: p, display: label(p), fields: { danglingPetId: p.petId, started: p.startDate },
      })),
    },
    {
      id: 'prescriptions.ref.client', severity: 'critical',
      title: 'Prescription for a client that does not exist',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.clientId) && !ctx.ix.clientIds.has(p.clientId)).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, danglingClientId: p.clientId },
      })),
    },
    {
      id: 'prescriptions.ref.employee', severity: 'critical',
      title: 'Prescriber does not exist',
      needs: 'employees',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.employeeId) && !ctx.ix.employeeIds.has(p.employeeId)).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, danglingEmployeeId: p.employeeId },
      })),
    },
    {
      id: 'prescriptions.ref.sourceProduct', severity: 'critical',
      title: 'Source product does not exist',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.sourceProductId) && !ctx.ix.productIds.has(p.sourceProductId)).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, danglingProductId: p.sourceProductId },
      })),
    },
    {
      id: 'prescriptions.ref.appointment', severity: 'critical',
      title: 'Prescription attached to an appointment that does not exist',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.appointmentId) && !ctx.ix.appointmentIds.has(p.appointmentId)).map((p) => ({
        record: p, display: label(p), fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, started: p.startDate, danglingAppointmentId: p.appointmentId },
      })),
    },
  ],
};
