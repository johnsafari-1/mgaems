const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const ok = (data, total = data?.length || 0) => ({ ok: true, data, meta: { total, per_page: 20, page: 1 } });
function harness({ role = 'head_teacher', profile = true, get, write, confirm, normalizeTimes = false } = {}) {
  const h = createDOM(role, '/health-welfare.html'), reads = [], writes = [], errors = [], toasts = [];
  if (normalizeTimes) Object.defineProperty(h.Element.prototype, 'value', { get() { return this._value; }, set(value) { this._value = this.attrs.type === 'datetime-local' ? String(value).replace(/\.(\d{3})\d+$/, '.$1') : value; } });
  const records = {
    profile: { id: 3, student_id: 8, revision_number: 4, allergy_information_state: 'unknown', allergy_information: null, emergency_information: '<Private emergency>', support_information: null, source: 'guardian_report', source_reference: null, recorded_by: 2, recorded_at: '2026-10-11T09:00:00.123456Z', reviewed_at: null, reviewed_by: null, extra_private_field: 'DO-NOT-RENDER' },
    alert: { id: 5, profile_id: 3, revision_number: 2, alert_type: 'allergy', description: '<Teacher safety>', emergency_instructions: '<Safe instructions>', is_active: true, source: 'external_document', source_reference: 'Known source', starts_on: '2026-10-10', ends_on: null, verified_by: null, verified_at: null, verification_basis: null },
    incident: { id: 10, student_id: 8, revision_number: 7, occurred_at: '2026-10-11T09:00:00.123456Z', recorded_at: '2026-10-11T10:00:00.000000Z', recorded_by: 2, location: 'School', category: 'injury', observations: '<Observed facts>', information_basis: 'observed', status: 'open', disposition: 'none', context_snapshot: { class_basis: 'unknown', term_basis: 'unknown' } },
    action: { id: 15, incident_id: 10, revision_number: 2, actor_id: 2, recorded_at: '2026-10-11T10:00:00Z', action_type: 'first_aid', action_at: '2026-10-11T09:30:00.654321Z', action: '<Actual action>', result: null, status_after: null, disposition_after: null },
    notification: { id: 16, incident_id: 10, revision_number: 3, actor_id: 2, recorded_at: '2026-10-11T10:00:00Z', guardian_id: 11, channel: 'phone', attempted_at: '2026-10-11T09:40:00Z', outcome: 'contacted', contact_snapshot: { guardian_name_at_recording: '<Historical Guardian>', contact_used: 'historical-contact', captured_at: '2026-10-11T10:00:00Z' } },
    referral: { id: 17, incident_id: 10, revision_number: 2, actor_id: 2, recorded_at: '2026-10-11T10:00:00Z', referred_at: '2026-10-11T09:50:00Z', reason: '<School referral>', destination: null, authorization_details: null, handover_details: null, follow_up_status: 'pending' },
  };
  h.app.get = async url => {
    reads.push(url);
    if (get) { const value = await get(url, records); if (value) return value; }
    if (url === '/api/v1/health/profiles?per_page=1') return ok([]);
    if (url.startsWith('/api/v1/students?')) return ok([{ id: 8, first_name: '<Learner>', last_name: 'One', admission_no: 'A8', medical_info: 'DO-NOT-RENDER' }, { id: 9, first_name: 'Other', last_name: 'Learner', admission_no: 'A9' }]);
    if (url === '/api/v1/students/8') return ok({ id: 8, medical_info: 'DO-NOT-RENDER', guardians: [{ id: 11, full_name: '<Current Guardian>', relationship: 'parent', phone: 'current-contact', email: 'current@example.test', is_primary_contact: true }] });
    if (url === '/api/v1/health/profiles?student_id=8') return ok(profile ? [{ id: 3, student_id: 8, revision_number: 4 }] : []);
    if (url === '/api/v1/health/profiles?student_id=9') return ok([]);
    if (url === '/api/v1/health/profiles/3') return ok(records.profile);
    if (url.startsWith('/api/v1/health/profiles/3/alerts?page=')) return ok([records.alert]);
    if (url === '/api/v1/health/profiles/3/alerts/5') return ok(records.alert);
    if (url.startsWith('/api/v1/health/incidents?student_id=8')) return ok([records.incident]);
    if (url === '/api/v1/health/incidents/10') return ok(records.incident);
    for (const [group, type] of Object.entries({ actions: 'action', notifications: 'notification', referrals: 'referral' })) {
      if (url.startsWith(`/api/v1/health/incidents/10/${group}?page=`)) return ok([records[type]]);
      if (url === `/api/v1/health/incidents/10/${group}/${records[type].id}`) return ok(records[type]);
    }
    if (url.includes('/revisions?')) return ok([{ revision_number: 4, change_type: 'correction', correction_reason: '<Private correction>', actor_id: 2, recorded_at: '2026-10-11T09:00:00Z', snapshot: records.profile }]);
    if (url.startsWith('/api/v1/health/access-log?')) return ok([{ id: 20, actor_id: 2, operation: 'read', record_type: 'profile', record_id: 3, recorded_at: '2026-10-11T09:00:00Z', private_narrative: 'DO-NOT-RENDER' }]);
    throw new Error('Unexpected API: ' + url);
  };
  for (const method of ['post', 'patch']) h.app[method] = async (url, data) => { writes.push({ method, url, data: JSON.parse(JSON.stringify(data)) }); return write ? write(method, url, data) : ok({ id: 3 }); };
  h.app.confirmAction = confirm || (async () => true);
  h.app.showFormErrors = (_, value) => errors.push(value);
  h.app.toast = (...args) => toasts.push(args);
  h.run('health-workspace.js');
  const click = async selector => { const element = h.ids.get(selector) || h.ids.get('appMain').querySelector(selector) || h.modals.at(-1)?.body.querySelector(selector); assert.ok(element, selector); await element.listeners.click(); await flush(); };
  const choose = async id => { await flush(); const control = h.ids.get('healthLearners').querySelectorAll('[data-health-learner]').find(e => e.dataset.healthLearner === String(id)); assert.ok(control); control.listeners.click(); await flush(); };
  const input = (name, value) => { const el = h.ids.get('healthField-' + name); assert.ok(el, name); if (typeof value === 'boolean') el.checked = value; else el.value = value; };
  const submit = async () => { await h.ids.get('healthRecordForm').listeners.submit({ preventDefault() {} }); await flush(); };
  const incident = async () => { await choose(8); await click('[data-health-tab="incidents"]'); await click('[data-health-record="10"]'); };
  return Object.assign(h, { reads, writes, errors, toasts, records, click, choose, input, submit, incident });
}
test('leadership workspace requires server Health authorization; all other direct-page roles issue no Health requests', async () => {
  for (const role of ['head_teacher', 'deputy_head_teacher']) { const h = harness({ role }); await flush(); assert.equal(h.reads[0], '/api/v1/health/profiles?per_page=1'); assert.ok(h.ids.has('healthLearners')); }
  for (const role of ['system_admin', 'teacher', 'parent_guardian', 'sponsor', 'sponsor_coordinator', 'student']) { const h = harness({ role }); await flush(); assert.equal(h.reads.length, 0); assert.equal(h.ids.has('healthLearners'), false); }
  const denied = harness({ get: () => ({ ok: false, status: 403 }) }); await flush(); assert.equal(denied.reads.length, 1); assert.match(denied.ids.get('appMain').innerHTML, /Health access unavailable/);
});
test('learner lookup filters only the loaded authorized page and never puts names or narratives into URLs', async () => {
  const h = harness(); await flush(); const count = h.reads.length;
  h.ids.get('healthLearnerFilter').value = '<Learner>'; h.ids.get('healthLearnerFilter').listeners.input();
  assert.equal(h.reads.length, count); assert.doesNotMatch(h.ids.get('healthLearners').innerHTML, /<Learner>|DO-NOT-RENDER/); assert.match(h.ids.get('healthLearners').innerHTML, /&lt;Learner&gt;/);
  await h.choose(8); assert.ok(h.reads.every(url => !url.includes('Learner') && !url.includes('Private')));
});
test('allergy states retain unknown versus an explicit source assertion; no legacy conversion', async () => {
  const h = harness({ profile: false }); await h.choose(8); assert.match(h.ids.get('healthPanel').innerHTML, /No Health profile|Legacy medical/);
  await h.click('healthNewProfile'); assert.equal(h.ids.get('healthField-allergy_information_state').value, 'unknown'); h.input('source', 'guardian_report'); await h.submit();
  assert.deepEqual(h.writes[0].data, { allergy_information_state: 'unknown', allergy_information: null, emergency_information: null, support_information: null, source: 'guardian_report', source_reference: null, student_id: 8 });
  const existing = harness(); await existing.choose(8); assert.match(existing.ids.get('healthPanel').innerHTML, /Unknown — information not established/); assert.doesNotMatch(existing.ids.get('healthPanel').innerHTML, /DO-NOT-RENDER/);
  await existing.click('healthEditProfile'); existing.input('allergy_information_state', 'none_reported'); existing.input('allergy_information', 'incompatible details'); existing.ids.get('healthCorrectionReason').value = 'Human correction'; await existing.submit(); assert.equal(existing.writes.length, 0); assert.equal(existing.errors.length, 1);
});
test('profile corrections and explicit reviews use loaded revision and require a human reason', async () => {
  const h = harness(); await h.choose(8); await h.click('healthEditProfile'); h.input('allergy_information_state', 'none_reported'); h.ids.get('healthCorrectionReason').value = 'Source confirmed none reported'; await h.submit();
  assert.equal(h.writes[0].method, 'patch'); assert.equal(h.writes[0].data.expected_revision, 4); assert.equal(h.writes[0].data.allergy_information_state, 'none_reported');
  await h.click('healthReviewProfile'); h.ids.get('healthCorrectionReason').value = 'Reviewed source'; await h.submit();
  assert.deepEqual(h.writes[1], { method: 'post', url: '/api/v1/health/profiles/3/review', data: { expected_revision: 4, correction_reason: 'Reviewed source' } });
});
test('alert summaries omit narratives, activation is explicit and verification has a known basis', async () => {
  const h = harness(); await h.choose(8); assert.doesNotMatch(h.ids.get('healthAlertList').innerHTML, /Teacher safety|Safe instructions/);
  await h.click('[data-health-record="5"]'); assert.match(h.modals.at(-1).body.innerHTML, /&lt;Teacher safety&gt;/); await h.click('[data-health-activate]'); h.ids.get('healthCorrectionReason').value = 'Effective period ended'; await h.submit();
  assert.deepEqual(h.writes[0], { method: 'patch', url: '/api/v1/health/profiles/3/alerts/5', data: { expected_revision: 2, correction_reason: 'Effective period ended', is_active: false } });
  await h.click('[data-health-record="5"]'); await h.click('[data-health-verify]'); h.input('verification_basis', 'Known school source'); h.ids.get('healthCorrectionReason').value = 'Operational review'; await h.submit();
  assert.equal(h.writes[1].url, '/api/v1/health/profiles/3/alerts/5/verify'); assert.equal(h.writes[1].data.verification_basis, 'Known school source'); assert.equal(h.writes[1].data.expected_revision, 2);
});
test('new alerts start inactive and use idempotency UUID without source or verification fabrication', async () => {
  const h = harness(); await h.choose(8); await h.click('healthNewAlert'); assert.equal(h.ids.get('healthField-is_active').checked, false);
  h.input('alert_type', 'activity_precaution'); h.input('description', 'Actual safety instruction'); h.input('starts_on', '2026-10-10'); h.input('source', 'staff_observation'); await h.submit();
  assert.equal(h.writes[0].data.is_active, false); assert.match(h.writes[0].data.request_id, /^[a-f0-9-]{36}$/); assert.equal('verified_by' in h.writes[0].data, false);
});
test('incident form records explicit facts and an EAT instant without inventing historical context', async () => {
  const h = harness(); await h.choose(8); await h.click('[data-health-tab="incidents"]'); await h.click('healthNewIncident');
  h.input('occurred_at', '2026-10-11T12:00:00.123456'); h.input('location', 'Playground'); h.input('category', 'injury'); h.input('information_basis', 'reported'); h.input('observations', '<Reported facts>'); await h.submit();
  const data = h.writes[0].data; assert.equal(data.occurred_at, '2026-10-11T12:00:00.123456+03:00'); assert.equal(data.student_id, 8); assert.equal(data.information_basis, 'reported'); assert.equal('historical_class_id' in data, false); assert.equal('recorded_by' in data, false);
});
test('unchanged corrections preserve all original UTC microseconds independent of browser timezone', async () => {
  const h = harness(); await h.incident(); assert.match(h.ids.get('healthPanel').innerHTML, /12:00:00\.123456 EAT/); await h.click('healthEditIncident'); assert.equal(h.ids.get('healthField-occurred_at').value, '2026-10-11T12:00:00.123456');
  h.ids.get('healthCorrectionReason').value = 'Factual text correction'; await h.submit(); assert.equal(h.writes[0].data.occurred_at, '2026-10-11T09:00:00.123456Z');
  const format = h.context.window.MGAEMSHealthFormat; assert.equal(format.eventInstant('2026-10-11T12:00'), '2026-10-11T12:00:00+03:00'); assert.equal(format.eatInput('2026-10-11T23:30:00.654321Z'), '2026-10-12T02:30:00.654321');
});
test('first aid append carries incident revision and explicit disposition; historical correction cannot replay a transition', async () => {
  const h = harness(); await h.incident(); await h.click('healthNewEntry'); h.input('action_type', 'first_aid'); h.input('action_at', '2026-10-11T12:30'); h.input('action', 'Actual first aid'); h.input('status_after', 'closed'); h.input('disposition_after', 'none'); await h.submit(); assert.equal(h.writes.length, 0);
  h.input('disposition_after', 'guardian_handover'); await h.submit(); assert.equal(h.writes[0].data.expected_incident_revision, 7); assert.equal(h.writes[0].data.status_after, 'closed');
  await h.click('[data-health-record="15"]'); await h.click('[data-health-edit]'); assert.equal(h.ids.has('healthField-status_after'), false); assert.equal(h.ids.has('healthField-disposition_after'), false); h.ids.get('healthCorrectionReason').value = 'Actual action text correction'; await h.submit();
  assert.equal(h.writes[1].data.expected_revision, 2); assert.equal(h.writes[1].data.expected_incident_revision, 7); assert.equal('status_after' in h.writes[1].data, false);
});
test('notifications use current relationship IDs but never substitute current contact into historical attempt', async () => {
  const h = harness(); await h.incident(); await h.click('[data-health-group="notifications"]'); await h.click('healthNewEntry');
  h.input('guardian_id', '11'); const choice = h.ids.get('healthField-guardian_id'); choice.listeners.change({ target: choice }); assert.equal(h.ids.get('healthField-contact_used').value, '');
  h.input('channel', 'phone'); h.input('attempted_at', '2026-10-11T12:40'); h.input('outcome', 'no_answer'); h.input('contact_used', 'actual-contact'); await h.submit(); assert.equal(h.writes[0].data.guardian_id, 11); assert.equal(h.writes[0].data.contact_used, 'actual-contact');
  await h.click('[data-health-group="notifications"]'); await h.click('[data-health-record="16"]'); assert.match(h.modals.at(-1).body.innerHTML, /Historical Guardian|historical-contact/); assert.doesNotMatch(h.modals.at(-1).body.innerHTML, /current-contact/);
  await h.click('[data-health-edit]'); assert.equal(h.ids.has('healthField-guardian_id'), false); assert.equal(h.ids.get('healthField-contact_used').value, 'historical-contact');
});
test('referrals record actual school handover and follow-up without external delivery or actor override', async () => {
  const h = harness(); await h.incident(); await h.click('[data-health-group="referrals"]'); await h.click('healthNewEntry');
  h.input('referred_at', '2026-10-11T12:50'); h.input('reason', 'Actual school reason'); h.input('follow_up_status', 'handed_over'); h.input('authorization_details', 'Known authorization'); h.input('handover_details', 'Actual handover'); await h.submit();
  assert.equal(h.writes[0].url, '/api/v1/health/incidents/10/referrals'); assert.equal(h.writes[0].data.expected_incident_revision, 7); assert.equal('actor_id' in h.writes[0].data, false); assert.equal(h.writes[0].data.follow_up_status, 'handed_over');
});
test('409 blocks all resubmissions until explicit reload and does not synthesize a newer revision', async () => {
  const h = harness({ write: () => ({ ok: false, status: 409, error: 'The record changed.' }) }); await h.choose(8); await h.click('healthEditProfile'); h.ids.get('healthCorrectionReason').value = 'Reviewed correction'; await h.submit(); assert.equal(h.writes.length, 1); assert.equal(h.ids.get('healthRecordSave').disabled, true);
  await h.submit(); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].data.expected_revision, 4); await h.click('[data-health-reload]'); assert.equal(h.ids.has('healthRecordForm'), false);
});
test('unchanged network retries reuse the same create UUID, while double submit is blocked', async () => {
  let release, confirmations = 0; const h = harness({ write: () => ({ ok: false, error: 'Network unavailable' }), confirm: () => { confirmations++; return new Promise(resolve => { release = resolve; }); } }); await h.choose(8); await h.click('healthNewAlert'); h.input('alert_type', 'allergy'); h.input('description', 'Actual source instruction'); h.input('starts_on', '2026-10-10'); h.input('source', 'guardian_report');
  const first = h.submit(); await h.submit(); assert.equal(confirmations, 1); release(true); await first;
  const second = h.submit(); release(true); await second; assert.equal(h.writes[0].data.request_id, h.writes[1].data.request_id);
});
test('learner switching clears narrative state and ignores an earlier private profile response', async () => {
  let release; const h = harness({ get: url => url === '/api/v1/health/profiles/3' ? new Promise(resolve => { release = resolve; }) : undefined }); await h.choose(8); await h.choose(9); release(ok({ ...h.records.profile, allergy_information: 'stale-private-sentinel' })); await flush();
  assert.match(h.ids.get('healthPanel').innerHTML, /No Health profile/); assert.doesNotMatch(h.ids.get('healthPanel').innerHTML, /stale-private-sentinel|Private emergency/);
});
test('authorization loss clears the entire workspace and all private dialog contents', async () => {
  for (const status of [401, 403]) {
    const h = harness({ write: () => ({ ok: false, status }) }); await h.choose(8); await h.click('healthEditProfile'); h.ids.get('healthCorrectionReason').value = 'Reviewed correction'; await h.submit();
    assert.match(h.ids.get('appMain').innerHTML, /Health access unavailable/); assert.equal(h.ids.has('healthLearners'), false); assert.equal(h.modals.at(-1).body.innerHTML, ''); assert.equal(h.modals.at(-1).closed, true);
  }
});
test('restricted revision disclosure is explicit, escaped and allowlisted; access logs contain no narratives', async () => {
  const h = harness(); await h.choose(8); await h.click('healthProfileHistory'); assert.doesNotMatch(h.modals.at(-1).body.innerHTML, /Private emergency|Private correction/); await h.click('[data-health-revision]');
  const snapshot = h.modals.at(-1).body.querySelector('[data-health-snapshot]').innerHTML;
  assert.match(snapshot, /&lt;Private correction&gt;/); assert.doesNotMatch(snapshot, /DO-NOT-RENDER|<Private/);
  assert.equal(h.modals.at(-1).body.querySelector('[data-health-revision]').getAttribute('aria-expanded'), 'true');
  await h.click('[data-health-revision]'); assert.equal(h.modals.at(-1).body.querySelector('[data-health-snapshot]').innerHTML, '');
  h.modals.at(-1).close(); assert.equal(h.modals.at(-1).body.innerHTML, ''); await h.click('[data-health-tab="logs"]'); assert.doesNotMatch(h.ids.get('healthPanel').innerHTML, /DO-NOT-RENDER|Private emergency/);
});
test('page departure wipes sensitive dialogs and in-memory view; no Health persistence or logging exists', async () => {
  const h = harness(); await h.choose(8); await h.click('healthEditProfile'); h.events.pagehide.forEach(callback => callback()); assert.equal(h.ids.get('appMain').innerHTML, ''); assert.equal(h.modals.at(-1).body.innerHTML, '');
  const source = fs.readFileSync(path.resolve(__dirname, '../../public/assets/health-workspace.js'), 'utf8'); assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|caches\.|serviceWorker/);
  assert.ok(h.toasts.every(item => !String(item[0]).includes('Private')));
  const previousReads = h.reads.length; h.events.pageshow.forEach(callback => callback({ persisted: true })); await flush();
  assert.equal(h.reads[previousReads], '/api/v1/health/profiles?per_page=1'); assert.match(h.ids.get('healthPanel').innerHTML, /Choose an existing learner/);
});
test('date picker normalization cannot truncate an unchanged event; wide EAT years preserve explicit UTC', async () => {
  const h = harness({ normalizeTimes: true }); await h.incident(); await h.click('healthEditIncident'); assert.equal(h.ids.get('healthField-occurred_at').value, '2026-10-11T12:00:00.123'); h.ids.get('healthCorrectionReason').value = 'Text only correction'; await h.submit(); assert.equal(h.writes[0].data.occurred_at, '2026-10-11T09:00:00.123456Z');
  const wide = harness({ get: (url, records) => url === '/api/v1/health/incidents/10' ? ok({ ...records.incident, occurred_at: '9999-12-31T23:59:59.999999Z' }) : undefined }); await wide.incident(); await wide.click('healthEditIncident'); assert.equal(wide.ids.get('healthField-occurred_at').attrs.type, 'text'); wide.ids.get('healthCorrectionReason').value = 'Text only'; await wide.submit(); assert.equal(wide.writes[0].data.occurred_at, '9999-12-31T23:59:59.999999Z');
  assert.equal(wide.context.window.MGAEMSHealthFormat.eatInput('1000-01-01T09:00:00.123456Z'), '1000-01-01T12:00:00.123456');
});
test('an uncertain create cannot silently become a new event with changed facts', async () => {
  const h = harness({ write: () => ({ ok: false, status: 503, error: 'Unavailable' }) }); await h.choose(8); await h.click('healthNewAlert'); h.input('alert_type', 'allergy'); h.input('description', 'Original instruction'); h.input('starts_on', '2026-10-10'); h.input('source', 'guardian_report'); await h.submit(); h.input('description', 'Changed instruction'); await h.submit(); assert.equal(h.writes.length, 1); assert.match(h.errors.at(-1).error, /Reload and review/);
});
test('canceling confirmation, closing a loading dialog, and mismatched ownership cannot reveal or mutate another record', async () => {
  const h = harness({ confirm: async () => false }); await h.choose(8); await h.click('healthEditProfile'); h.ids.get('healthCorrectionReason').value = 'Human correction'; await h.submit(); assert.equal(h.writes.length, 0);
  let release; const late = harness({ get: url => url === '/api/v1/health/profiles/3/alerts/5' ? new Promise(resolve => { release = resolve; }) : undefined }); await late.choose(8); const pending = late.ids.get('appMain').querySelector('[data-health-record="5"]').listeners.click(); await flush(); late.modals.at(-1).close(); release(ok(late.records.alert)); await pending; await flush(); assert.equal(late.modals.at(-1).body.innerHTML, '');
  const foreign = harness({ get: (url, records) => url === '/api/v1/health/profiles/3' ? ok({ ...records.profile, student_id: 9, allergy_information: 'foreign-sensitive' }) : undefined }); await foreign.choose(8); assert.doesNotMatch(foreign.ids.get('healthPanel').innerHTML, /foreign-sensitive/); assert.match(foreign.ids.get('healthPanel').innerHTML, /Unexpected profile identity/);
});
test('loaded action pages are sorted chronologically at microsecond precision and exclude list narratives', async () => {
  const h = harness({ get: (url, records) => url.includes('/actions?page=') ? ok([{ ...records.action, id: 19, action_at: '2026-10-11T09:30:00.654322Z', action: 'DO-NOT-RENDER' }, { ...records.action, id: 18, action_at: '2026-10-11T09:30:00.654321Z', action: 'DO-NOT-RENDER' }]) : undefined }); await h.incident();
  const html = h.ids.get('healthEntryList').innerHTML; assert.ok(html.indexOf('Record #18') < html.indexOf('Record #19')); assert.doesNotMatch(html, /DO-NOT-RENDER/);
});

test('validation retains editable facts, pending saves freeze fields, and child success reloads the parent revision', async () => {
  let release, incidentReads = 0;
  const h = harness({ get: (url, records) => url === '/api/v1/health/incidents/10' ? ok({ ...records.incident, revision_number: 7 + incidentReads++ }) : undefined,
    write: () => new Promise(resolve => { release = resolve; }) });
  await h.incident(); await h.click('healthNewEntry'); h.input('action_type', 'first_aid'); h.input('action_at', '2026-10-11T12:30'); h.input('action', 'Actual action');
  const pending = h.submit(); await flush(); assert.equal(h.ids.get('healthField-action').disabled, true);
  release({ ok: false, status: 422, error: 'Review fields.', fields: { action: ['Review this field.'] } }); await pending;
  assert.equal(h.ids.get('healthField-action').disabled, false); assert.equal(h.ids.get('healthField-action').value, 'Actual action'); assert.deepEqual(h.errors.at(-1).fields.action, ['Review this field.']);
  const retry = h.submit(); await flush(); release(ok({ id: 15 })); await retry; await flush(); assert.equal(incidentReads, 2);
  await h.click('healthNewEntry'); h.input('action_type', 'observation'); h.input('action_at', '2026-10-11T12:40'); h.input('action', 'Later actual action');
  const next = h.submit(); await flush(); assert.equal(h.writes.at(-1).data.expected_incident_revision, 8); release(ok({ id: 16 })); await next;
});

test('loading another action page preserves chronological rows and working detail handlers', async () => {
  const h = harness({ get: (url, records) => url.includes('/actions?page=') ? ok([{ ...records.action, id: url.includes('?page=2&') ? 15 : 19, action_at: url.includes('?page=2&') ? '2026-10-11T09:30:00.654321Z' : '2026-10-11T09:30:00.654322Z' }], 21) : undefined });
  await h.incident(); await h.click('[data-health-more]'); const html = h.ids.get('healthEntryList').innerHTML;
  assert.ok(html.indexOf('Record #15') < html.indexOf('Record #19')); await h.click('[data-health-record="15"]'); assert.match(h.modals.at(-1).body.innerHTML, /&lt;Actual action&gt;/);
});
