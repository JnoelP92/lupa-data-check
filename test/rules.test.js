import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, runRules } from '../src/rules/index.js';
import { buildReport, renderMarkdown } from '../src/report.js';
import { makePull } from './fixture.js';

const NOW = new Date('2026-09-20T12:00:00Z');
let cached;
function run(opts) {
  if (!opts && cached) return cached;
  const dir = makePull(opts);
  const ctx = buildContext(dir, { now: NOW });
  const result = { dir, ctx, sections: runRules(ctx) };
  if (!opts) cached = result;
  return result;
}

const section = (sections, key) => sections.find((s) => s.key === key);
const finding = (sections, key, id) => section(sections, key).findings.find((f) => f.id === id);
const ids = (sections, key, id) => (finding(sections, key, id)?.rows ?? []).map((r) => r.id).sort();
const total = (sections, key, id) => finding(sections, key, id)?.total ?? 0;

// One assertion per rule that a seeded record is supposed to trip. A rule that stops
// firing shows up here by name rather than as a shifted count somewhere downstream.
const EXPECTED = {
  clients: {
    'clients.email.missing': ['c0002'], 'clients.phone.missing': ['c0003'],
    'clients.email.malformed': ['c0004'], 'clients.phone.implausible': ['c0005'],
    'clients.dob.implausible': ['c0006'], 'clients.address.missing': ['c0007'],
    'clients.duplicate.email': ['c0008', 'c0009'], 'clients.duplicate.phone': ['c0010', 'c0011'],
    'clients.duplicate.nameDob': ['c0012', 'c0013'], 'clients.ref.primaryStore': ['c0016'],
    'clients.ref.paymentTerms': ['c0017'], 'clients.contacts.noRoute': ['c0018'],
  },
  pets: {
    'pets.species.missing': ['p02'], 'pets.dob.missing': ['p03'], 'pets.dob.implausible': ['p04'],
    'pets.sex.missing': ['p05'], 'pets.microchip.flagWithoutNumber': ['p06'],
    'pets.microchip.malformed': ['p07'], 'pets.deceased.noDate': ['p08'],
    'pets.deceased.dateWithoutFlag': ['p09'], 'pets.neutered.noDate': ['p10'],
    'pets.weights.none': ['p11'], 'pets.owner.none': ['p12'], 'pets.owner.allArchived': ['p13'],
    'pets.owner.dangling': ['p14'], 'pets.duplicate.microchip': ['p15', 'p16'],
    'pets.duplicate.sameOwner': ['p17', 'p18'],
  },
  appointments: {
    'appointments.time.endBeforeStart': ['ap02'], 'appointments.time.zeroLength': ['ap03'],
    'appointments.time.tooLong': ['ap04'], 'appointments.status.futureButDone': ['ap05'],
    'appointments.status.staleOpen': ['ap06'], 'appointments.status.checkedInButRequested': ['ap07'],
    'appointments.store.missing': ['ap08'], 'appointments.store.dangling': ['ap09'],
    'appointments.ref.pet': ['ap10'], 'appointments.ref.client': ['ap11'],
    'appointments.ref.petClientMismatch': ['ap12'], 'appointments.visitType.missing': ['ap13'],
    'appointments.visitType.dangling': ['ap14'], 'appointments.visitType.nameMissing': ['ap15'],
    'appointments.ref.employee': ['ap16'], 'appointments.duplicate.exact': ['ap17', 'ap18'],
    'appointments.employees.none': ['ap19'],
    'appointments.status.lateCheckIn': ['ap20'],
  },
  products: {
    'products.price.belowCost': ['pr02', 'pr04', 'pr05'],  // free and negative are also below cost 'products.price.zeroMarkup': ['pr03'],
    'products.price.freeButSellable': ['pr04'], 'products.price.negative': ['pr05'],
    'products.cost.unknown': ['pr06'], 'products.price.hugeMarkup': ['pr07'],
    'products.vat.unexpected': ['pr08'], 'products.name.soundsLikeService': ['pr09'],
    'products.unit.missing': ['pr10'], 'products.measureUnit.missing': ['pr11'],
    'products.subunit.incomplete': ['pr12'], 'products.subunit.orphanFields': ['pr13'],
    'products.sellableUnits.contradiction': ['pr14'], 'products.unit.inverted': ['pr15'],
    'products.fee.negative': ['pr17'], 'products.fee.injectableNoFee': ['pr18'],
    'products.stock.negative': ['pr19'], 'products.stock.noRecords': ['pr20'],
    'products.stock.implausible': ['pr21'], 'products.stock.minAboveOptimal': ['pr22'],
    'products.supplier.noItemCode': ['pr23'], 'products.ref.store': ['pr25'],
    'products.ref.referenceList': ['pr26'], 'products.duplicate.barcode': ['pr27', 'pr28'],
    'products.duplicate.itemCode': ['pr29', 'pr30'], 'products.duplicate.name': ['pr31', 'pr32'],
    'products.state.sellableArchived': ['pr33'],
  },
  services: {
    'services.price.negative': ['sv02'], 'services.price.zero': ['sv03'],
    'services.margin.negative': ['sv04'], 'services.margin.huge': ['sv05'],
    'services.category.otherOrFee': ['sv06', 'sv07'],
    'services.category.miscategorised': ['sv07'],
    'services.name.soundsLikeProduct': ['sv08'], 'services.ref.store': ['sv09'],
    'services.ref.referenceList': ['sv10'], 'services.duplicate.name': ['sv11', 'sv12'],
  },
  insurancePolicies: {
    'insurance.ref.pet': ['ip02'], 'insurance.policyNumber.missing': ['ip03'],
    'insurance.holder.missing': ['ip04'],
    'insurance.duplicate.policyNumber': ['ip05', 'ip06'],
    'insurance.deceased.activePolicy': ['ip07'],
  },
  bundles: {
    'bundles.price.negative': ['bn03'], 'bundles.nesting.self': ['bn04'],
    'bundles.duplicate.name': ['bn06', 'bn07'], 'bundles.ref.store': ['bn08'],
  },
  healthPlans: {
    'healthPlans.price.invalid': ['hp02'], 'healthPlans.allowances.none': ['hp02'],
    'healthPlans.duplicate.name': ['hp01', 'hp03'], 'healthPlans.allowance.danglingItem': ['hp03'],
    'healthPlans.allowance.unbounded': ['hp04'], 'healthPlans.allowance.noAppliesTo': ['hp04'],
  },
  healthPlanSubscriptions: {
    'subscriptions.status.activeButEnded': ['sb02'], 'subscriptions.status.activeInFuture': ['sb03'],
    'subscriptions.status.cancelledNoEnd': ['sb04'], 'subscriptions.status.stuckSignup': ['sb05'],
    'subscriptions.ref.subscriber': ['sb06'], 'subscriptions.ref.plan': ['sb07'],
    'subscriptions.state.deceasedPet': ['sb08'], 'subscriptions.state.archivedClient': ['sb09'],
    'subscriptions.duplicate.active': ['sb10', 'sb11'],
    'subscriptions.payment.noDay': ['sb13'],
  },
  reminders: {
    'reminders.channel.none': ['rm02'], 'reminders.timing.noLeadTime': ['rm03'],
    'reminders.timing.negativeLead': ['rm04'], 'reminders.timing.missedWithoutDelay': ['rm05'],
    'reminders.repeat.noInterval': ['rm06'], 'reminders.status.draft': ['rm07'],
    'reminders.duplicate.name': ['rm01', 'rm08'],
  },
  clinicalNotes: {
    'clinicalNotes.content.empty': ['cl02'], 'clinicalNotes.content.mojibake': ['cl03'],
    'clinicalNotes.author.missing': ['cl04'], 'clinicalNotes.ref.employee': ['cl05'],
    'clinicalNotes.ref.appointment': ['cl06'], 'clinicalNotes.ref.pet': ['cl07'],
    'clinicalNotes.content.microchip': ['cl08'], 'clinicalNotes.content.veryLong': ['cl09'],
    'clinicalNotes.type.internalSoundsClientFacing': ['cl10'],
    'clinicalNotes.type.clinicalSoundsInternal': ['cl11'],
  },
  medicalRecords: {
    'medicalRecords.date.missing': ['mr02'], 'medicalRecords.title.missing': ['mr03'],
    'medicalRecords.vaccination.noNextDue': ['mr04'], 'medicalRecords.date.future': ['mr05'],
    'medicalRecords.date.endBeforeStart': ['mr06'], 'medicalRecords.date.ancient': ['mr07'],
    'medicalRecords.ref.pet': ['mr08'], 'medicalRecords.ref.appointment': ['mr09'],
    'medicalRecords.vaccination.overdue': ['mr10'],
  },
  prescriptions: {
    'prescriptions.prescriber.missing': ['rx02'], 'prescriptions.product.missingSource': ['rx03'],
    'prescriptions.product.nameMissing': ['rx04'], 'prescriptions.quantity.invalid': ['rx05'],
    'prescriptions.unit.missing': ['rx06'], 'prescriptions.expiry.missing': ['rx07'],
    'prescriptions.expiry.expiredPending': ['rx08'], 'prescriptions.dates.startAfterEnd': ['rx09'],
    'prescriptions.dates.futureStart': ['rx10'], 'prescriptions.dates.overLongCourse': ['rx11'],
    'prescriptions.refill.negativeLimit': ['rx12'], 'prescriptions.refill.overDispensed': ['rx13'],
    'prescriptions.dispense.completedWithNone': ['rx14'],
    'prescriptions.dispense.neverHandedOver': ['rx15'], 'prescriptions.ref.pet': ['rx16'],
    'prescriptions.ref.client': ['rx17'], 'prescriptions.ref.employee': ['rx18'],
    'prescriptions.ref.sourceProduct': ['rx19'], 'prescriptions.ref.appointment': ['rx20'],
  },
  invoices: {
    'invoices.payment.overAllocated': ['in04'], 'invoices.payment.paidButUnderpaid': ['in05'],
    'invoices.payment.unpaidButPaid': ['in06'], 'invoices.payment.partialButFull': ['in07'],
    'invoices.status.chargeWithoutLines': ['in09'],
    'invoices.status.staleDraft': ['in10'], 'invoices.status.draftWithPayment': ['in11'],
    'invoices.line.negative': ['in12'], 'invoices.line.zeroQuantity': ['in13'],
    'invoices.line.discountExceedsLine': ['in15'], 'invoices.line.discountOver100': ['in16'],
    'invoices.line.vatUnexpected': ['in17'], 'invoices.line.danglingProduct': ['in18'],
    'invoices.line.danglingService': ['in19'], 'invoices.duplicate.number': ['in20', 'in21'],
    'invoices.bundle.danglingParent': ['in27'], 'invoices.ref.client': ['in22'],
    'invoices.ref.pet': ['in23'], 'invoices.ref.employee': ['in24'], 'invoices.ref.store': ['in25'],
  },
  payments: {
    'payments.amount.invalid': ['pay04'], 'payments.allocation.none': ['pay02'],
    'payments.status.stuck': ['pay05'], 'payments.status.failed': ['pay06'],
    'payments.ref.client': ['pay07'], 'payments.ref.invoice': ['pay08'],
    'payments.ref.clientMismatch': ['pay09'],
  },
  creditNotes: {
    'creditNotes.amount.invalid': ['cn02'], 'creditNotes.items.none': ['cn02'],
    'creditNotes.reason.migration': ['cn09'],
    'creditNotes.status.issuedNoDate': ['cn03'], 'creditNotes.status.draftWithDate': ['cn04'],
    'creditNotes.ref.client': ['cn05'], 'creditNotes.ref.invoice': ['cn06'],
    'creditNotes.ref.pet': ['cn07'], 'creditNotes.items.notOnInvoice': ['cn08'],
  },
  refunds: {
    'refunds.amount.invalid': ['rf02'], 'refunds.reason.unknown': ['rf03'],
    'refunds.status.stuck': ['rf04'], 'refunds.payment.none': ['rf05'],
    'refunds.ref.payment': ['rf06'], 'refunds.ref.client': ['rf07'],
    'refunds.amount.exceedsPayment': ['rf08'],
  },
  estimates: {
    'estimates.total.mismatch': ['es02'], 'estimates.ref.client': ['es03'],
    'estimates.ref.pet': ['es04'], 'estimates.ref.store': ['es05'],
  },
  employees: {
    'employees.email.missing': ['e02'], 'employees.rcvs.missing': ['e03'],
    'employees.stores.none': ['e04'], 'employees.visitTypes.none': ['e05'],
    'employees.calendar.hidden': ['e05'], 'employees.duplicate.email': ['e01', 'e06'],
    'employees.duplicate.name': ['e01', 'e06'], 'employees.ref.store': ['e06'],
  },
};

for (const [key, rules] of Object.entries(EXPECTED)) {
  test(`${key}: every seeded defect is caught`, () => {
    const { sections } = run();
    for (const [id, expected] of Object.entries(rules)) {
      assert.deepEqual(ids(sections, key, id), [...expected].sort(), `${id} matched the wrong records`);
    }
  });
}

test('control records are never flagged', () => {
  const { sections } = run();
  const clean = { clients: 'c0001', pets: 'p01', appointments: 'ap01', products: 'pr01', services: 'sv01', prescriptions: 'rx01', medicalRecords: 'mr01', reminders: 'rm01', employees: 'e01', insurancePolicies: 'ip01' };
  const exempt = new Set([
    'clients.balance.nonZero',           // c0001 has none, but other rules list many
    'reminders.duplicate.name',          // rm01 legitimately collides with rm08
    'employees.duplicate.email',         // e01 legitimately collides with e06
    'employees.duplicate.name',
    'clinicalNotes.content.microchip',
  ]);
  for (const [key, id] of Object.entries(clean)) {
    for (const f of section(sections, key).findings) {
      if (exempt.has(f.id)) continue;
      assert.ok(!f.rows.some((r) => r.id === id), `${id} should not appear in ${f.id}`);
    }
  }
});

test('archived clients are exempt from missing-contact rules', () => {
  const { sections } = run();
  for (const id of ['clients.email.missing', 'clients.phone.missing', 'clients.address.missing']) {
    assert.ok(!ids(sections, 'clients', id).includes('c0019'));
  }
});

test('duplicate matching normalises case, whitespace and phone formatting', () => {
  const { sections } = run();
  assert.deepEqual(ids(sections, 'clients', 'clients.duplicate.email'), ['c0008', 'c0009']);
  assert.deepEqual(ids(sections, 'clients', 'clients.duplicate.phone'), ['c0010', 'c0011']);
  assert.deepEqual(ids(sections, 'products', 'products.duplicate.name'), ['pr31', 'pr32']);
  assert.deepEqual(ids(sections, 'services', 'services.duplicate.name'), ['sv11', 'sv12']);
});

test('invoice reconciliation flags only genuine mismatches', () => {
  const { sections } = run();
  // in03 (9999 vs 5000), in09 (3000 with no lines), in26 (5000 vs 7000 of bundle lines)
  assert.deepEqual(
    (finding(sections, 'invoices', 'invoices.total.mismatch').rows ?? []).map((r) => r.id).sort(),
    ['in03', 'in09', 'in26'],
  );
  // in01 is 12500 against a single 12500 line and must not appear.
  assert.ok(!ids(sections, 'invoices', 'invoices.total.mismatch').includes('in01'));
});

test('client balance reconciliation matches a hand-worked example', () => {
  const { sections } = run();
  const rows = finding(sections, 'crossRecord', 'cross.balance.clientMismatch').rows;
  // c0001: £210 invoiced (completed) − £40 paid − £30 non-refundable credit = £140 expected,
  // against a stored balance of £0.
  const c1 = rows.find((r) => r.id === 'c0001');
  assert.equal(c1.fields.expected, '£140.00');
  assert.equal(c1.fields.actual, '£0.00');
  assert.equal(c1.fields.delta, '-£140.00');
  // c0014 and c0015 are seeded to reconcile exactly and must not appear.
  assert.ok(!rows.some((r) => r.id === 'c0014'), 'c0014 reconciles');
  assert.ok(!rows.some((r) => r.id === 'c0015'), 'c0015 reconciles (payment + non-refundable credit)');
});

test('top-level reconciliation reports the four totals and the delta', () => {
  const { sections } = run();
  const f = finding(sections, 'crossRecord', 'cross.balance.topLevelMismatch');
  assert.equal(f.total, 1);
  for (const k of ['invoiced', 'paid', 'credited', 'expectedBalance', 'actualBalance', 'delta']) {
    assert.ok(f.rows[0].fields[k], `missing ${k}`);
  }
});

test('bundle composition is derived from invoice instances', () => {
  const { sections } = run();
  const f = finding(sections, 'crossRecord', 'cross.bundles.priceVsComponents');
  assert.equal(f.rows[0].id, 'bn01');
  assert.equal(f.rows[0].fields.bundlePrice, '£50.00');
  assert.equal(f.rows[0].fields.instances, 2);
});

test('a rule whose reference set was unreadable is skipped, not passed', () => {
  const { sections } = run({ unavailable: { paymentTerms: 'HTTP 403 forbidden' } });
  assert.equal(finding(sections, 'clients', 'clients.ref.paymentTerms'), undefined);
  const skipped = section(sections, 'clients').skipped.find((s) => s.id === 'clients.ref.paymentTerms');
  assert.ok(skipped);
  assert.match(skipped.reason, /paymentTerms/);
});

test('truncation never hides the true total', () => {
  const { sections } = run();
  let checked = 0;
  for (const s of sections) {
    for (const f of s.findings) {
      assert.ok(f.rows.length <= f.total, `${f.id} shows more rows than it found`);
      if (f.truncatedTo === null) {
        assert.equal(f.rows.length, f.total, `${f.id} dropped rows without saying so`);
      } else {
        assert.equal(f.rows.length, f.truncatedTo, `${f.id} truncation count is wrong`);
        assert.ok(f.total > f.truncatedTo, `${f.id} marked truncated but was not`);
        checked++;
      }
    }
  }
  void checked;
});

test('a rule over its truncation limit shows N rows and the real total', () => {
  // clients.balance.nonZero truncates at 10; seed more than that.
  const clients = Array.from({ length: 14 }, (_, i) => ({
    id: `t${i}`, numericId: 9000 + i, firstName: 'Bulk', lastName: `Client${i}`,
    email: `bulk${i}@example.com`, phone: `07700900${String(i).padStart(3, '0')}`,
    address: { line_1: '1 High Street' }, primaryStoreId: '11111111-1111-1111-1111-111111111111',
    paymentTermsId: '33333333-3333-3333-3333-333333333333', balance: (i + 1) * 100,
    isArchived: false, contacts: [],
  }));
  const { sections } = run({ overrides: { clients } });
  const f = finding(sections, 'clients', 'clients.balance.nonZero');
  assert.equal(f.total, 14);
  assert.equal(f.truncatedTo, 10);
  assert.equal(f.rows.length, 10);
  // Sorted by absolute balance, so the largest is first.
  assert.equal(f.rows[0].fields.numericId, 9013);
});

test('summary totals equal the sum of the sections', () => {
  const { ctx, sections } = run();
  const report = buildReport(ctx, sections);
  for (const row of report.summary) {
    assert.equal(row.flagged, row.critical + row.review + row.info, `${row.category} does not add up`);
  }
  assert.equal(report.summary.length, sections.length);
});

test('markdown renders links, tables and the incomplete-pull warning', () => {
  const { ctx, sections } = run();
  const md = renderMarkdown(buildReport(ctx, sections));
  assert.match(md, /# Data check — Fixture Veterinary Group/);
  assert.match(md, /https:\/\/work\.lupapets\.com\/clients\/c0004/);
  assert.match(md, /https:\/\/work\.lupapets\.com\/settings\?tab=products/);
  assert.doesNotMatch(md, /\| *\| *\|\n\|-+\|\n$/);

  const warned = run({ unavailable: { paymentTerms: 'HTTP 403 forbidden' } });
  const md2 = renderMarkdown(buildReport(warned.ctx, warned.sections));
  assert.match(md2, /Incomplete pull/);
});

test('a reference set that came back empty skips its rules instead of flagging everything', () => {
  // The endpoint answered with [], so nothing is marked unavailable — but every client
  // carrying a paymentTermsId would be reported as dangling.
  const { sections } = run({ overrides: { paymentTerms: [] } });
  assert.equal(finding(sections, 'clients', 'clients.ref.paymentTerms'), undefined, 'must not flag');
  const skipped = section(sections, 'clients').skipped.find((s) => s.id === 'clients.ref.paymentTerms');
  assert.ok(skipped, 'must be recorded as skipped');
  assert.match(skipped.reason, /came back empty/);
});

test('a collection that returned no records is marked not-checked, not clean', () => {
  const { ctx, sections } = run({ overrides: { reminders: [], bundles: [] } });
  for (const key of ['reminders', 'bundles']) {
    assert.equal(section(sections, key).empty, true, `${key} should be marked empty`);
    assert.equal(section(sections, key).counts.critical, 0);
  }
  const report = buildReport(ctx, sections);
  assert.deepEqual(report.notChecked.sort(), ['Bundles', 'Reminders']);

  const md = renderMarkdown(report);
  assert.match(md, /returned no records at all/);
  assert.match(md, /NOT CHECKED/);
  assert.match(md, /Nothing was checked/);
  // A populated category must not be tarred with the same brush.
  assert.equal(section(sections, 'clients').empty, false);
});

test('a rule matching most of its category is reported as a characteristic, not N findings', () => {
  // Every client missing an email: a fact about the migration, not 200 things to fix.
  const clients = Array.from({ length: 200 }, (_, i) => ({
    id: `s${i}`, numericId: 7000 + i, firstName: 'Sat', lastName: `Client${i}`,
    email: null, phone: `07700${String(i).padStart(6, '0')}`,
    address: { line_1: '1 High Street' }, primaryStoreId: '11111111-1111-1111-1111-111111111111',
    isArchived: false, contacts: [], balance: 0,
  }));
  const { ctx, sections } = run({ overrides: { clients } });
  const f = finding(sections, 'clients', 'clients.email.missing');
  assert.equal(f.systemic, true);
  assert.equal(f.total, 200);
  assert.equal(f.share, 100);
  assert.equal(f.rows.length, 3, 'a saturated finding carries examples, not a table');

  // It must not inflate the actionable headline.
  assert.equal(section(sections, 'clients').counts.review, 0);

  const report = buildReport(ctx, sections);
  assert.ok(report.characteristics.some((c) => c.rule === 'clients.email.missing'));
  const md = renderMarkdown(report);
  assert.match(md, /Characteristics of this dataset/);
});

test('duplicate findings report how many groups collided', () => {
  const { sections } = run();
  const f = finding(sections, 'clients', 'clients.duplicate.email');
  assert.equal(f.groupCount, 1, 'two clients sharing one address is one collision');
  assert.equal(f.total, 2);
});

test('cross-record rules measure their share against what they actually scanned', () => {
  const { sections } = run();
  const cross = section(sections, 'crossRecord');
  for (const f of cross.findings) {
    assert.ok(f.share === null || (f.share >= 0 && f.share <= 100), `${f.id} share is ${f.share}%`);
  }
  const pets = cross.findings.find((f) => f.id === 'cross.pets.noHistory');
  assert.ok(pets.share <= 100 && pets.share > 0, 'pet rule measured against the pet count');
});

test('money scale is detected from the data, not taken from the spec', async () => {
  const { detectMoneyScale } = await import('../src/money.js');
  const { Store } = await import('../src/store.js');

  // The fixture is integer minor units, as the spec documents.
  const minor = detectMoneyScale(new Store(makePull()));
  assert.equal(minor.units, 'minor');
  assert.equal(minor.divisor, 100);

  // A practice returning decimals cannot be on minor units, whatever the spec says.
  const decimals = makePull({ overrides: { invoices: [
    { id: 'd1', invoiceNumber: 'D1', clientId: 'c0001', status: 'completed', amountDue: 1379.46, amountPaid: 0,
      activeFrom: '2026-06-01T10:00:00Z', billingProducts: [{ id: 'l1', price: 32.89, unitPrice: 2.055625, quantity: 16 }], billingServices: [], billingBundles: [] },
  ] } });
  const major = detectMoneyScale(new Store(decimals));
  assert.equal(major.units, 'major');
  assert.equal(major.divisor, 1);
  assert.equal(major.tolerance, 0.01);
  assert.match(major.reason, /non-integer/);
});

test('a zero-priced line that was discounted to zero is not a missing price', () => {
  const line = (over) => ({ id: 'l1', productId: 'pr01', name: 'Product pr01', price: 0, unitPrice: 0, quantity: 1, vatPercentage: 20, discountType: '£', ...over });
  const inv = (id, l) => ({
    id, invoiceNumber: id, clientId: 'c0001', petId: 'p01', storeId: '11111111-1111-1111-1111-111111111111',
    status: 'completed', paymentStatus: 'unpaid', amountDue: 0, amountPaid: 0,
    activeFrom: '2026-06-01T10:00:00Z', discountAmount: 0, discountType: '£',
    createdByEmployeeId: 'e01', billingProducts: [l], billingServices: [], billingBundles: [],
  });
  const { sections } = run({ overrides: { invoices: [
    inv('free1', line({ discount: 0 })),      // no price, no discount — flag it
    inv('disc1', line({ discount: 2000 })),   // deliberately given away — do not
  ] } });
  const f = finding(sections, 'invoices', 'invoices.line.freeButCatalogued');
  assert.deepEqual((f?.rows ?? []).map((r) => r.id), ['free1']);
});
