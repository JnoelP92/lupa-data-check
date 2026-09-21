// Section 6.8 — Clinical notes.
//
// Content rules read free text. Nothing in a finding row carries note content beyond a
// short snippet, and snippets are stripped entirely from client-facing output — the
// report is about data quality, not about surfacing what a vet wrote.
import { isBlank, lower, breakdown } from '../util.js';

const MICROCHIP_IN_TEXT = /\b\d{15}\b/;
const CLIENT_FACING_WORDS = /\b(client|owner|please tell|advise them)\b/i;
const STAFF_ONLY_WORDS = /\b(do not tell|don'?t tell|internal only|staff only)\b/i;
// A run of symbols with almost no letters: the classic encoding-mangled import.
const MOJIBAKE = /[Ã¢â€™Â]{3,}|[^\w\s.,;:'"()\-\/&%+£$@!?]{6,}/;

const snippet = (c, n = 60) => (isBlank(c.content) ? '' : String(c.content).replace(/\s+/g, ' ').trim().slice(0, n) + (String(c.content).length > n ? '…' : ''));
const label = (c) => `${c.contentType ?? 'note'} on ${c.entityType ?? 'unknown'}`;

export default {
  key: 'clinicalNotes',
  label: 'Clinical notes',
  linkType: 'clinicalNote',

  tally(ctx, rows) {
    return [
      { label: 'Total notes', value: rows.length },
      { label: 'Active', value: rows.filter((c) => c.isArchived === false).length },
      { label: 'Archived', value: rows.filter((c) => c.isArchived === true).length },
      { label: 'By content type', breakdown: breakdown(rows, (c) => c.contentType) },
      { label: 'By entity type', breakdown: breakdown(rows, (c) => c.entityType) },
      { label: 'With no author', value: rows.filter((c) => isBlank(c.employeeId)).length },
      { label: 'Empty after trimming', value: rows.filter((c) => isBlank(c.content)).length },
    ];
  },

  rules: [
    {
      id: 'clinicalNotes.content.empty', severity: 'critical',
      title: 'Note with no content',
      run: (ctx, rows) => rows.filter((c) => isBlank(c.content)).map((c) => ({
        record: c, display: label(c), fields: { entityType: c.entityType, entityId: c.entityId, employeeId: c.employeeId },
      })),
    },
    {
      id: 'clinicalNotes.content.mojibake', severity: 'review',
      title: 'Note content looks encoding-mangled',
      clientFacing: 'Note text contains unreadable characters.',
      why: 'A run of symbols where letters should be. Usually a character-set mismatch at import.',
      run: (ctx, rows) => rows.filter((c) => !isBlank(c.content) && MOJIBAKE.test(c.content)).map((c) => ({
        record: c, display: label(c), fields: { entityType: c.entityType, snippet: snippet(c) },
      })),
    },
    {
      id: 'clinicalNotes.author.missing', severity: 'review',
      title: 'Note with no author',
      run: (ctx, rows) => rows.filter((c) => isBlank(c.employeeId)).map((c) => ({
        record: c, display: label(c), fields: { entityType: c.entityType, contentType: c.contentType },
      })),
    },
    {
      id: 'clinicalNotes.ref.employee', severity: 'critical',
      title: 'Note author does not exist',
      needs: 'employees',
      run: (ctx, rows) => rows.filter((c) => !isBlank(c.employeeId) && !ctx.ix.employeeIds.has(c.employeeId)).map((c) => ({
        record: c, display: label(c), fields: { danglingEmployeeId: c.employeeId },
      })),
    },
    {
      id: 'clinicalNotes.ref.appointment', severity: 'critical',
      title: 'Note attached to an appointment that does not exist',
      run: (ctx, rows) => rows.filter((c) => lower(c.entityType) === 'appointment' && !isBlank(c.entityId) && !ctx.ix.appointmentIds.has(c.entityId)).map((c) => ({
        record: c, display: label(c), fields: { danglingAppointmentId: c.entityId },
      })),
    },
    {
      id: 'clinicalNotes.ref.pet', severity: 'critical',
      title: 'Note attached to a pet that does not exist',
      run: (ctx, rows) => rows.filter((c) => lower(c.entityType) === 'pet' && !isBlank(c.entityId) && !ctx.ix.petIds.has(c.entityId)).map((c) => ({
        record: c, display: label(c), fields: { danglingPetId: c.entityId },
      })),
    },
    {
      id: 'clinicalNotes.content.microchip', severity: 'info',
      title: 'Note contains what looks like a microchip number',
      why: 'Probably belongs in the pet’s microchip field, where it is searchable.',
      truncate: 25,
      run: (ctx, rows) => rows.filter((c) => !isBlank(c.content) && MICROCHIP_IN_TEXT.test(c.content)).map((c) => ({
        record: c, display: label(c), fields: { entityType: c.entityType, snippet: snippet(c) },
      })),
    },
    {
      id: 'clinicalNotes.content.veryLong', severity: 'info',
      title: 'Note over 5,000 characters',
      why: 'Usually a whole history pasted from the previous system into one note.',
      truncate: 25,
      run: (ctx, rows) => rows.filter((c) => (c.content?.length ?? 0) > 5000).map((c) => ({
        record: c, display: label(c), fields: { entityType: c.entityType, length: c.content.length },
      })),
    },
    {
      id: 'clinicalNotes.type.internalSoundsClientFacing', severity: 'review',
      title: 'Internal note written as if the client will read it',
      internalOnly: true,
      run: (ctx, rows) => rows.filter((c) => lower(c.contentType) === 'internal' && !isBlank(c.content) && CLIENT_FACING_WORDS.test(c.content)).map((c) => ({
        record: c, display: label(c), fields: { snippet: snippet(c) },
      })),
    },
    {
      id: 'clinicalNotes.type.clinicalSoundsInternal', severity: 'review',
      title: 'Clinical note marked as not for the client',
      why: 'Clinical notes can be shared. If this should not be, it is on the wrong type.',
      internalOnly: true,
      run: (ctx, rows) => rows.filter((c) => lower(c.contentType) === 'clinical' && !isBlank(c.content) && STAFF_ONLY_WORDS.test(c.content)).map((c) => ({
        record: c, display: label(c), fields: { snippet: snippet(c) },
      })),
    },
  ],
};
