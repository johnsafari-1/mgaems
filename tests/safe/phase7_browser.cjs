// Real Edge/Chromium rendering with synthetic, browser-intercepted API fixtures.
// No web server, database, Ollama connection, or external network is used.
// Supply playwright-core via NODE_PATH; no application dependency is installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
if (!process.argv.includes('--synthetic')) throw new Error('Explicit --synthetic mode is required.');
const root = path.resolve(__dirname, '../..');
const origin = 'http://phase7.mgaems.invalid';
const assignment = { id: 11, class_id: 2, subject_id: 3, term_id: 4, school_class: { id: 2, name: 'Synthetic Grade 7', level: 'junior' },
  subject: { id: 3, name: 'Synthetic Pilot Science', learning_area: 'Synthetic Pilot Science', status: 'active' }, staff: { id: 5, first_name: 'Synthetic', last_name: 'Teacher' },
  term: { id: 4, name: 'Synthetic term', start_date: '2026-01-01', end_date: '2026-04-30', is_current: true, academic_year: { id: 1, name: 'Synthetic 2026' } } };
const common = { id: 9, class_subject_teacher_id: 11, title: 'Original synthetic temperature draft', status: 'draft', assignment, review_notes: null, updated_at: '2026-02-01T12:00:00Z' };
const specs = [
  { operation: 'scheme_of_work', page: 'schemes-of-work', view: '[data-scheme-action="view"]', ai: '#aiSchemeWeeks', detail: { weeks: [], curriculum_reference: '' } },
  { operation: 'lesson_plan', page: 'lesson-plans', view: '[data-plan-action="view"]', ai: '[data-plan-action="ai"]', detail: { lesson_date: '2026-02-03', duration_minutes: 40, strand: 'Observing', sub_strand: 'Temperature', specific_learning_outcomes: 'Read temperatures.', key_inquiry_questions: 'Which is warmer?', teaching_learning_resources: 'Original sheet', introduction: 'Compare', lesson_development: 'Read', conclusion: 'Explain', learning_activities: 'Read and compare', assessment_approach: 'Observe', has_record_of_work: false, record_of_work: null } },
  { operation: 'homework', page: 'homework', view: '[data-homework-action="view"]', ai: '[data-homework-action="ai"]', detail: { questions: [], question_count: 0, assigned_on: '2026-02-03', due_on: '2026-02-06', total_marks: 5, submission_method: 'exercise_book', eligible_learner_count: 0, completion_counts: { recorded: 0 } } },
  { operation: 'exam_paper', page: 'exam-papers', view: '[data-exam="open"]', ai: '[data-exam="grounded-draft"]', detail: { questions: [], sections: [], attachments: [], question_count: 0, total_marks: 0, duration_minutes: 40, examination_type: 'end_term', revision_number: 0, version_number: 1, header_template: 'classic', derived_versions: [] } },
];
function draft(operation) {
  const links = { curriculum_record_ids: [1], learning_outcome_ids: [1] };
  const question = { ...links, position: 1, question_type: 'short_answer', prompt: 'Compare 20 and 30 degrees Celsius. Which is warmer?', marks: 5, options: [], answer_key: '30 degrees Celsius.', marking_guidance: 'Credit the higher temperature.' };
  return { status: 'draft', grade: 7, learning_area: 'Synthetic Pilot Science', title: 'Original synthetic temperature', curriculum_claims: [],
    curriculum_references: [{ record_id: 1, source_version_id: 1, document_sha256: 'a'.repeat(64), page_reference: 'Original sheet, page 1', outcome_ids: [1] }], specific_learning_outcomes: [{ id: 1, text: 'Read temperatures.' }],
    ...({ scheme_of_work: { total_duration_minutes: 80, weeks: [{ ...links, week_number: 1, strand: 'Observing', sub_strand: 'Temperature', lessons_per_week: 2, lesson_duration_minutes: 40, total_duration_minutes: 80, learning_activities: ['Read temperatures.'], resources: ['Original sheet'], assessment_approach: 'Observe' }] },
      lesson_plan: { duration_minutes: 40, key_inquiry_questions: ['Which is warmer?'], resources: ['Original sheet'], assessment_approach: 'Observe', stages: ['introduction', 'development', 'conclusion'].map((phase, i) => ({ ...links, phase, duration_minutes: [5, 30, 5][i], activities: ['Read temperatures.'] })) },
      homework: { instructions: 'Compare temperatures.', total_marks: 5, questions: [question] },
      exam_paper: { instructions: 'Compare temperatures.', duration_minutes: 40, total_marks: 5, sections: [{ position: 1, title: 'Temperature questions', total_marks: 5, questions: [question] }] } })[operation] };
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PHASE7_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', args: ['--disable-background-networking'] });
  try {
    console.log('BROWSER ' + browser.version());
    for (const spec of specs) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
      await context.addInitScript(() => { localStorage.setItem('mgaems_token', 'synthetic-fixture-only'); localStorage.setItem('mgaems_user', JSON.stringify({ id: 1, username: 'synthetic.teacher', role: 'teacher' })); });
      const page = await context.newPage(), errors = [], unexpected = [], writes = [];
      const doc = { ...structuredClone(common), ...structuredClone(spec.detail) };
      let mode = 'disabled';
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) {
          const file = path.resolve(root, 'public', '.' + url.pathname);
          if (!file.startsWith(path.join(root, 'public') + path.sep) || !/\.(html|css|js|png|jpg|svg|ico)$/.test(file) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
          return route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' });
        }
        const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) });
        const endpoint = url.pathname.replace('/api/v1/', ''), method = request.method();
        if (endpoint === 'settings/school') return respond({ school_name: 'Synthetic Pilot School', motto: 'Original software fixtures' });
        if (endpoint === 'academic-years') return respond([{ id: 1, name: 'Synthetic 2026', is_current: true }]);
        if (endpoint === 'terms') return respond([assignment.term]);
        if (endpoint === 'me') return respond({ id: 1, username: 'synthetic.teacher', role: 'teacher' });
        if (endpoint === spec.page + '/context') return respond({ scope: 'assigned', assignments: [assignment], schemes: [], lesson_plans: [], submission_methods: ['exercise_book'], examination_types: ['end_term'], capabilities: { header_templates: true, versions: true } });
        if (endpoint === spec.page) return respond([doc]);
        if (endpoint.endsWith('/revisions')) return respond([]);
        if (endpoint === 'ai-teaching/status') return respond({ available: mode !== 'disabled', provider: mode === 'disabled' ? 'unavailable' : 'synthetic_browser_fixture', capabilities: { grounded: mode !== 'disabled' } });
        if (endpoint === 'ai-teaching/drafts') {
          await new Promise(resolve => setTimeout(resolve, 300));
          if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Synthetic model timeout. Manual authoring remains available.' } }) });
          return respond({ run_id: 1, label: 'Synthetic browser fixture, not live AI', disclosure: 'Original test material; review required.', draft: draft(spec.operation) }, 201);
        }
        if (method === 'GET' && endpoint === spec.page + '/9') return respond(doc);
        if (['POST', 'PATCH'].includes(method)) {
          const body = request.postDataJSON() || {}; writes.push({ endpoint, body });
          if (endpoint.endsWith('/accept')) return respond({ id: 1, state: 'accepted' });
          if (endpoint.endsWith('/weeks')) doc.weeks.push({ id: 1, ...body });
          else if (endpoint.endsWith('/sections')) doc.sections.push({ id: 1, ...body });
          else if (endpoint.endsWith('/questions')) { doc.questions.push({ id: 1, ...body }); doc.question_count = doc.questions.length; doc.total_marks = doc.questions.reduce((total, q) => total + Number(q.marks || 0), 0); }
          else Object.assign(doc, body);
          return respond(doc, method === 'POST' ? 201 : 200);
        }
        unexpected.push(endpoint); return route.fulfill({ status: 500, body: '{}' });
      });
      await page.goto(origin + '/' + spec.page + '.html');
      await page.locator(spec.view).first().click();
      await page.locator(spec.ai).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('[name="grade"]').fill('7');
      await dialog.locator('[data-grounded-request]').click();
      await dialog.getByText('AI drafting is disabled or not configured.', { exact: false }).waitFor();
      assert.equal(writes.length, 0);
      mode = 'error'; await dialog.locator('[data-grounded-request]').click();
      await dialog.getByText('Synthetic model timeout.', { exact: false }).waitFor();
      mode = 'success'; await dialog.locator('[data-grounded-request]').click();
      await page.getByRole('button', { name: 'Generating draft…', exact: true }).waitFor();
      const editor = dialog.locator('[data-draft-json]'); await editor.waitFor();
      assert.equal(await editor.isEditable(), true); assert.equal(writes.length, 0);
      await dialog.locator('summary').click();
      assert.match(await dialog.innerText(), /Original sheet, page 1/);
      await editor.fill('{ invalid JSON'); await dialog.locator('[data-grounded-import]').click();
      await dialog.getByText('The draft is not valid JSON.', { exact: false }).waitFor(); assert.equal(writes.length, 0);
      const edited = draft(spec.operation); edited.title = 'Reviewed synthetic fixture';
      if (spec.operation === 'scheme_of_work') edited.weeks[0].learning_activities = ['Teacher-edited synthetic content'];
      else if (spec.operation === 'lesson_plan') edited.stages[0].activities = ['Teacher-edited synthetic content'];
      else if (spec.operation === 'homework') edited.questions[0].prompt = 'Teacher-edited synthetic content: compare 20 and 30 degrees Celsius.';
      else edited.sections[0].questions[0].prompt = 'Teacher-edited synthetic content: compare 20 and 30 degrees Celsius.';
      await editor.fill(JSON.stringify(edited)); await dialog.locator('[data-grounded-import]').click();
      await dialog.waitFor({ state: 'detached' });
      assert.ok(writes.some(write => !write.endpoint.endsWith('/accept')));
      assert.match(JSON.stringify(writes), /Teacher-edited synthetic content/);
      assert.equal(writes.filter(write => write.endpoint.endsWith('/accept')).length, 1); assert.equal(doc.status, 'draft');
      if (spec.operation === 'exam_paper') {
        await page.locator('#questionEditor').waitFor();
        const labels = await page.locator('#questionEditor [name="exam_paper_section_id"] option').allTextContents();
        console.log('GAP exam section selector labels=' + JSON.stringify(labels));
        assert.equal(await page.locator('.exam-preview-answer').count(), 0);
        await page.locator('[data-exam="preview-marking"]').click(); await page.locator('.exam-preview-answer').waitFor();
      }
      const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      await page.setViewportSize({ width: 375, height: 812 });
      const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      console.log('PASS_BROWSER ' + JSON.stringify({ operation: spec.operation, disabled: true, loading: true, error: true, editablePreview: true, invalidJSONBlocked: true, explicitImport: true, acceptanceCalls: 1, draftRetained: true, desktopOverflow, mobileOverflow, backend: 'intercepted synthetic fixtures; not a live backend or human acceptance' }));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
