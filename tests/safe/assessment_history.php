<?php

// Reuse the guarded memory bootstrap and fixtures; that runner replaces EVERY
// connection before boot and exercises the new additive migration in memory.
require __DIR__.'/academic_structure.php';

use App\Http\Controllers\Api\AssessmentController;
use App\Http\Controllers\Api\ParentPortalController;
use App\Http\Controllers\Api\ReportCardController;
use App\Http\Controllers\Api\SponsorPortalController;
use App\Models\Assessment;
use App\Models\AssessmentRevision;
use App\Models\ClassSubjectTeacher;
use App\Models\Guardian;
use App\Models\ReportCard;
use App\Models\ReportCardRevision;
use App\Models\SchoolSetting;
use App\Models\Sponsor;
use App\Models\Sponsorship;
use App\Services\AuditLogger;
use App\Services\ReportPublication;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpKernel\Exception\HttpException;

Schema::create('school_settings', function (Blueprint $table) { $table->id(); $table->string('school_name'); $table->string('motto')->nullable(); $table->string('logo_path')->nullable(); $table->timestamps(); });
Schema::create('guardians', function (Blueprint $table) { $table->id(); $table->foreignId('student_id')->constrained(); $table->foreignId('user_id')->nullable()->constrained(); $table->string('full_name'); $table->string('relationship'); $table->string('phone'); });
Schema::create('sponsors', function (Blueprint $table) { $table->id(); $table->string('name'); $table->string('sponsor_type'); $table->foreignId('user_id')->nullable()->constrained(); $table->timestamps(); });
Schema::create('sponsorships', function (Blueprint $table) {
    $table->id(); $table->foreignId('sponsor_id')->constrained(); $table->foreignId('student_id')->nullable()->constrained(); $table->string('sponsorship_type');
    $table->string('status'); $table->string('program_name')->nullable(); $table->date('start_date'); $table->date('end_date')->nullable(); $table->timestamps();
});
Schema::create('sponsorship_student', function (Blueprint $table) { $table->id(); $table->foreignId('sponsorship_id')->constrained(); $table->foreignId('student_id')->constrained(); $table->timestamps(); $table->unique(['sponsorship_id', 'student_id']); });
SchoolSetting::create(['school_name' => 'Configured test school', 'motto' => 'Configured test motto']);

class MemoryReportDisk
{
    public array $files = []; public array $deleted = []; public bool $failPut = false;
    public function exists($path): bool { return array_key_exists($path, $this->files); }
    public function get($path): string { return $this->files[$path]; }
    public function size($path): int { return strlen($this->get($path)); }
    public function put($path, $bytes): bool { $this->files[$path] = $this->failPut ? 'partial write' : $bytes; return !$this->failPut; }
    public function delete($path): bool { $this->deleted[] = $path; unset($this->files[$path]); return true; }
    public function download($path, $name) { return response($this->get($path), 200, ['Content-Type' => 'application/pdf', 'Content-Disposition' => 'attachment; filename="'.$name.'"']); }
}
class MemoryReports
{
    public MemoryReportDisk $private; public MemoryReportDisk $public;
    public function __construct() { $this->private = new MemoryReportDisk(); $this->public = new MemoryReportDisk(); }
    public function disk($name) { return $name === 'private' ? $this->private : $this->public; }
}
class SnapshotTestPublication extends ReportPublication
{
    protected function render(array $input): string { return '%PDF-memory-fixture '.json_encode($input, JSON_THROW_ON_ERROR); }
}
class FailingHistoryAudit extends AuditLogger
{
    public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): App\Models\AuditLog { throw new RuntimeException('Memory-only audit failure'); }
}
$memory = new MemoryReports(); Storage::swap($memory);
$assessmentController = new AssessmentController(); $reportController = new ReportCardController(); $publication = new SnapshotTestPublication();
$start = $passed;
function historyForbidden(callable $operation): void {
    try { $operation(); } catch (HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Expected 403'); return; }
    throw new RuntimeException('Expected authorization denial');
}
function assessmentSave($controller, $user, array $input) { $request = requestFor($user, $input); return $controller->store($request, new AuditLogger($request)); }
function teachingCase($leader): array {
    $teacher = actor('teacher'); $staff = staff($teacher); $class = classroom(); $subject = area(); $term = period(year()); $student = learner($class);
    $class->subjects()->attach($subject->id);
    $assignment = ClassSubjectTeacher::create(['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $staff->id, 'term_id' => $term->id]);
    return compact('teacher', 'staff', 'class', 'subject', 'term', 'student', 'assignment');
}
function resultInput(array $case, array $values = []): array {
    return array_replace(['class_id' => $case['class']->id, 'subject_id' => $case['subject']->id, 'term_id' => $case['term']->id,
        'student_id' => $case['student']->id, 'assessment_type' => 'continuous', 'score' => 70, 'competency_rating' => 'Meeting Expectation', 'remarks' => 'Saved test remark'], $values);
}

check('new teacher results capture immutable class/offering/assignment and a compact vocabulary snapshot', function () use ($assessmentController, $leader) {
    $case = teachingCase($leader); $response = assessmentSave($assessmentController, $case['teacher'], resultInput($case))->getData(true);
    $row = Assessment::findOrFail($response['data']['id']);
    ensure($row->class_id === $case['class']->id && $row->class_subject_id === DB::table('class_subjects')->where('class_id', $case['class']->id)->value('id'), 'Captured offering');
    ensure($row->authorization_assignment_id === $case['assignment']->id && $row->authority_type === 'teacher_assignment', 'Assignment authorization');
    ensure($row->context_snapshot['class']['name'] === $case['class']->name && $row->context_snapshot['performance_scale']['identifier'] === 'mgaems-performance-v1', 'Frozen labels/vocabulary');
    ensure($row->revision_number === 1 && $row->revisions()->count() === 1 && $row->revisions()->first()->change_type === 'creation', 'Creation revision');
    foreach (['recorded_by', 'recorded_at', 'context_snapshot', 'authorization_assignment_id'] as $field) ensure(!array_key_exists($field, $response['data']), 'Shaped teacher response');
});

check('inactive/unlinked/non-teaching accounts and Class Teacher-only ownership grant no assessment rights', function () use ($assessmentController, $leader) {
    $case = teachingCase($leader);
    $case['staff']->update(['status' => 'on_leave']); historyForbidden(fn () => assessmentSave($assessmentController, $case['teacher'], resultInput($case)));
    $case['staff']->update(['status' => 'active', 'staff_type' => 'non_teaching']); historyForbidden(fn () => $assessmentController->context(requestFor($case['teacher'])));
    $case['staff']->update(['staff_type' => 'teaching']); $case['teacher']->update(['status' => 'inactive']); historyForbidden(fn () => assessmentSave($assessmentController, $case['teacher'], resultInput($case)));
    $unlinked = actor('teacher'); historyForbidden(fn () => assessmentSave($assessmentController, $unlinked, resultInput($case)));
    $other = actor('teacher'); $otherStaff = staff($other); $case['class']->update(['class_teacher_id' => $otherStaff->id]);
    historyForbidden(fn () => assessmentSave($assessmentController, $other, resultInput($case)));
});

check('offering, active subject, learner membership, and nonempty values are validated before persistence', function () use ($assessmentController, $leader) {
    $case = teachingCase($leader); $case['class']->subjects()->detach($case['subject']->id);
    invalid(fn () => assessmentSave($assessmentController, $leader, resultInput($case)), 'subject_id');
    $case['class']->subjects()->attach($case['subject']->id); $case['subject']->update(['status' => 'inactive']);
    invalid(fn () => assessmentSave($assessmentController, $case['teacher'], resultInput($case)), 'subject_id');
    $case['subject']->update(['status' => 'active']); $other = learner(classroom());
    historyForbidden(fn () => assessmentSave($assessmentController, $case['teacher'], resultInput($case, ['student_id' => $other->id])));
    invalid(fn () => assessmentSave($assessmentController, $case['teacher'], resultInput($case, ['score' => null, 'competency_rating' => null, 'remarks' => '   '])), 'score');
    ensure(Assessment::where('student_id', $case['student']->id)->count() === 0, 'No rejected result persisted');
    ensure(assessmentSave($assessmentController, $case['teacher'], resultInput($case, ['score' => 0, 'competency_rating' => null, 'remarks' => null]))->getStatusCode() === 201, 'Zero is meaningful');
});

check('leadership writes record direct authority without a fabricated assignment and support performance-only results', function () use ($assessmentController, $leader) {
    $case = teachingCase($leader); $case['assignment']->delete();
    $response = assessmentSave($assessmentController, $leader, resultInput($case, ['score' => null, 'remarks' => null]))->getData(true);
    $row = Assessment::findOrFail($response['data']['id']);
    ensure($row->authority_type === 'leadership' && $row->authorization_assignment_id === null && $row->revisions()->first()->actor_id === $leader->id, 'Direct leadership provenance');
});

check('corrections append immutable prior states while preserving origin context and optimistic revision checks', function () use ($assessmentController, $leader) {
    $case = teachingCase($leader); $input = resultInput($case); $id = assessmentSave($assessmentController, $case['teacher'], $input)->getData(true)['data']['id'];
    $row = Assessment::findOrFail($id); $first = $row->revisions()->first(); $original = $first->toArray();
    $response = assessmentSave($assessmentController, $leader, array_replace($input, ['score' => 89, 'expected_revision' => 1]));
    ensure($response->getStatusCode() === 200 && $row->fresh()->revision_number === 2 && $first->fresh()->toArray() === $original, 'Prior revision retained');
    ensure($row->fresh()->authority_type === 'teacher_assignment' && $row->revisions()->where('revision_number', 2)->first()->authority_type === 'leadership', 'Origin versus editor authority');
    ensure(assessmentSave($assessmentController, $leader, array_replace($input, ['score' => 89]))->getData(true)['meta']['operation'] === 'unchanged', 'Idempotent retry');
    ensure(assessmentSave($assessmentController, $leader, array_replace($input, ['score' => 90, 'expected_revision' => 1]))->getStatusCode() === 409 && $row->revisions()->count() === 2, 'Stale correction refused');
    try { $first->update(['score' => 1]); throw new RuntimeException('Expected immutable revision'); } catch (LogicException $exception) {}
    try { $first->delete(); throw new RuntimeException('Expected retained revision'); } catch (LogicException $exception) {}
    ensure($first->fresh()->score === '70.00', 'Immutable saved state');
});

check('the logical unique key and revision sequence remain database-enforced', function () use ($assessmentController, $leader) {
    $case = teachingCase($leader); $id = assessmentSave($assessmentController, $case['teacher'], resultInput($case))->getData(true)['data']['id']; $row = Assessment::findOrFail($id);
    try { Assessment::create(['student_id' => $row->student_id, 'subject_id' => $row->subject_id, 'term_id' => $row->term_id, 'assessment_type' => 'continuous', 'recorded_by' => $leader->id]); throw new RuntimeException('Expected unique result'); }
    catch (QueryException $exception) { ensure(str_contains($exception->getMessage(), 'UNIQUE'), 'Result uniqueness'); }
    try { AssessmentRevision::create(array_diff_key($row->revisions()->first()->getAttributes(), ['id' => true])); throw new RuntimeException('Expected unique revision'); }
    catch (QueryException $exception) { ensure(str_contains($exception->getMessage(), 'UNIQUE'), 'Revision uniqueness'); }
    ensure(assessmentSave($assessmentController, $case['teacher'], resultInput($case, ['expected_revision' => 0]))->getStatusCode() === 409, 'Duplicate first-save client refused');
});

check('promotion does not reinterpret stored class or grant the new class teacher access to old results', function () use ($assessmentController, $leader) {
    $case = teachingCase($leader); $id = assessmentSave($assessmentController, $case['teacher'], resultInput($case))->getData(true)['data']['id'];
    $newClass = classroom(); $newTeacher = actor('teacher'); $newStaff = staff($newTeacher); $newClass->subjects()->attach($case['subject']->id);
    ClassSubjectTeacher::create(['class_id' => $newClass->id, 'subject_id' => $case['subject']->id, 'term_id' => $case['term']->id, 'staff_id' => $newStaff->id]);
    $case['student']->update(['class_id' => $newClass->id]);
    ensure(assessmentSave($assessmentController, $newTeacher, resultInput($case, ['class_id' => $newClass->id]))->getStatusCode() === 409, 'No silent historical class movement');
    $old = $assessmentController->index(requestFor($case['teacher'], ['student_id' => $case['student']->id], 'GET'))->getData(true)['data'];
    $new = $assessmentController->index(requestFor($newTeacher, ['student_id' => $case['student']->id], 'GET'))->getData(true)['data'];
    ensure(count($old) === 1 && count($new) === 0 && Assessment::findOrFail($id)->class_id === $case['class']->id, 'Reads use captured assignment context');
});

check('legacy corrections are leadership-only and preserve unknown context with an explicit baseline', function () use ($assessmentController, $leader) {
    $case = teachingCase($leader);
    $legacy = Assessment::create(['student_id' => $case['student']->id, 'subject_id' => $case['subject']->id, 'term_id' => $case['term']->id,
        'assessment_type' => 'continuous', 'score' => 12, 'recorded_by' => $case['teacher']->id, 'recorded_at' => now()]);
    historyForbidden(fn () => assessmentSave($assessmentController, $case['teacher'], resultInput($case)));
    $roster = $assessmentController->learners(requestFor($case['teacher'], resultInput($case), 'GET'))->getData(true)['data'];
    ensure(!$roster[0]['editable'] && $roster[0]['assessment'] === null, 'Legacy values are not disclosed to teachers');
    assessmentSave($assessmentController, $leader, resultInput($case)); $legacy = $legacy->fresh();
    ensure($legacy->class_id === null && $legacy->class_subject_id === null && $legacy->context_snapshot === null && $legacy->authority_type === 'legacy_unknown', 'No invented origin');
    $baseline = $legacy->revisions()->where('revision_number', 1)->first();
    ensure($baseline->score === '12.00' && $baseline->change_type === 'legacy_baseline' && $baseline->authority_type === 'legacy_unknown' && $legacy->revision_number === 2, 'Known stored baseline retained');
});

check('assessment projection, revision and audit roll back together', function () use ($assessmentController, $leader) {
    $case = teachingCase($leader); $request = requestFor($case['teacher'], resultInput($case));
    try { $assessmentController->store($request, new FailingHistoryAudit($request)); throw new LogicException('Expected failure'); }
    catch (HttpResponseException $exception) { ensure($exception->getResponse()->getStatusCode() === 503, 'Expected neutral save failure'); }
    ensure(Assessment::where('student_id', $case['student']->id)->count() === 0, 'No unaudited result/revision');
});

check('ordinary teachers cannot use generic report show/download while leadership receives shaped responses', function () use ($reportController, $leader) {
    $case = teachingCase($leader); $card = ReportCard::create(['student_id' => $case['student']->id, 'term_id' => $case['term']->id]);
    historyForbidden(fn () => $reportController->show(requestFor($case['teacher']), $card));
    historyForbidden(fn () => $reportController->download(requestFor($case['teacher']), $card));
    $data = $reportController->show(requestFor($leader), $card)->getData(true)['data'];
    ensure(!array_key_exists('file_path', $data) && !array_key_exists('generated_by', $data), 'Private implementation fields omitted');
});

check('report publication preserves legacy bytes and traces exact immutable assessment revisions', function () use ($assessmentController, $publication, $leader, $memory) {
    global $publishedCase, $publishedCard;
    $publishedCase = teachingCase($leader); $case = $publishedCase;
    assessmentSave($assessmentController, $case['teacher'], resultInput($case, ['score' => 60, 'competency_rating' => 'Approaching Expectation', 'remarks' => 'Continuous remark']));
    assessmentSave($assessmentController, $case['teacher'], resultInput($case, ['assessment_type' => 'end_term', 'score' => 80, 'remarks' => 'End-term remark']));
    $path = 'report-cards/legacy-memory.pdf'; $memory->private->files[$path] = '%PDF retained legacy bytes';
    $card = ReportCard::create(['student_id' => $case['student']->id, 'term_id' => $case['term']->id, 'file_path' => $path, 'generated_at' => now(), 'generated_by' => $leader->id]);
    $request = requestFor($leader); $publishedCard = $publication->publish($case['student']->id, $case['term']->id, 'Overall saved remark', $leader, new AuditLogger($request));
    ensure($publishedCard->id === $card->id && $publishedCard->revision_number === 2 && $publishedCard->file_path !== $path && $memory->private->files[$path] === '%PDF retained legacy bytes', 'Legacy artifact is not overwritten');
    $legacy = $card->revisions()->where('revision_number', 1)->first(); $revision = $card->revisions()->where('revision_number', 2)->first();
    ensure($legacy->provenance === 'legacy_artifact' && $legacy->input_snapshot === null && $legacy->source_manifest === null, 'Legacy sources stay unknown');
    ensure($revision->artifact_sha256 === hash('sha256', $memory->private->get($revision->artifact_path)) && count($revision->source_manifest) === 2, 'Verified artifact and manifest');
    ensure($revision->input_snapshot['revision_number'] === $revision->revision_number && $revision->input_snapshot['generated_at'] === $revision->generated_at->toISOString(), 'Rendered revision/time matches published metadata');
    foreach ($revision->source_manifest as $source) ensure(AssessmentRevision::findOrFail($source['assessment_revision_id'])->revision_number === $source['revision_number'], 'Exact source saved state');
    $row = $revision->input_snapshot['subject_rows'][0];
    ensure($row['continuous']['score'] === '60.00' && $row['end_term']['score'] === '80.00' && $row['continuous']['performance_level'] === 'Approaching Expectation' && $row['end_term']['performance_level'] === 'Meeting Expectation', 'No timestamp-based precedence');
    ensure($revision->input_snapshot['school']['name'] === 'Configured test school', 'Existing school settings identity');
});

check('regeneration publishes a new path without changing previous PDF/source snapshots, including renamed contexts', function () use ($assessmentController, $publication, $leader, $memory) {
    global $publishedCase, $publishedCard;
    $case = $publishedCase; $old = $publishedCard->revisions()->where('revision_number', 2)->first(); $before = $old->toArray(); $bytes = $memory->private->get($old->artifact_path);
    $case['class']->update(['name' => 'Renamed current class']); $case['subject']->update(['name' => 'Renamed current subject']);
    assessmentSave($assessmentController, $leader, resultInput($case, ['score' => 61, 'competency_rating' => 'Below Expectation', 'remarks' => 'Corrected continuous remark']));
    SchoolSetting::first()->update(['school_name' => 'Renamed school identity']);
    $request = requestFor($leader); $publishedCard = $publication->publish($case['student']->id, $case['term']->id, 'New overall remark', $leader, new AuditLogger($request));
    ensure($publishedCard->revision_number === 3 && $publishedCard->file_path !== $old->artifact_path && $memory->private->get($old->artifact_path) === $bytes && $old->fresh()->toArray() === $before, 'Earlier bytes and inputs retained');
    $latest = $publishedCard->revisions()->where('revision_number', 3)->first(); $row = $latest->input_snapshot['subject_rows'][0];
    ensure($row['continuous']['subject'] !== 'Renamed current subject' && $row['continuous']['class'] !== 'Renamed current class', 'Teaching labels remain frozen');
    ensure($row['continuous']['performance_level'] === 'Below Expectation' && $row['end_term']['performance_level'] === 'Meeting Expectation', 'Both types remain explicit after correction');
    ensure($latest->input_snapshot['school']['name'] === 'Renamed school identity' && $old->input_snapshot['school']['name'] === 'Configured test school', 'Rendered identity is revision-scoped');
});

check('failed storage does not publish a card/revision and partial UUID artifacts are cleaned up', function () use ($assessmentController, $publication, $leader, $memory) {
    $case = teachingCase($leader); assessmentSave($assessmentController, $leader, resultInput($case)); $files = $memory->private->files; $count = ReportCardRevision::count();
    $memory->private->failPut = true; $request = requestFor($leader);
    try { $publication->publish($case['student']->id, $case['term']->id, null, $leader, new AuditLogger($request)); throw new LogicException('Expected storage failure'); }
    catch (HttpResponseException $exception) { ensure($exception->getResponse()->getStatusCode() === 503, 'Storage verification rejected'); }
    $memory->private->failPut = false;
    ensure(ReportCard::where('student_id', $case['student']->id)->count() === 0 && ReportCardRevision::count() === $count && $memory->private->files === $files, 'No broken metadata or orphan fixture bytes');
});

check('publication audit failure rolls back pointers/revisions and cleans only the attempted new artifact', function () use ($publication, $leader, $memory) {
    global $publishedCase, $publishedCard;
    $before = $publishedCard->fresh()->toArray(); $files = $memory->private->files; $count = $publishedCard->revisions()->count(); $request = requestFor($leader);
    try { $publication->publish($publishedCase['student']->id, $publishedCase['term']->id, 'Failed remark', $leader, new FailingHistoryAudit($request)); throw new LogicException('Expected audit failure'); }
    catch (HttpResponseException $exception) { ensure($exception->getResponse()->getStatusCode() === 503, 'Expected neutral publication failure'); }
    ensure($publishedCard->fresh()->toArray() === $before && $publishedCard->revisions()->count() === $count && $memory->private->files === $files, 'Valid revisions survive failed publication');
});

check('Parent and Sponsor ownership downloads remain isolated with no paths or internal manifests disclosed', function () use ($leader, $memory) {
    global $publishedCase, $publishedCard;
    $student = $publishedCase['student']; $other = learner($publishedCase['class']); $parent = actor('parent_guardian');
    Guardian::create(['student_id' => $student->id, 'user_id' => $parent->id, 'full_name' => 'Memory parent', 'relationship' => 'parent', 'phone' => 'memory-only']);
    $portal = new ParentPortalController(); $request = requestFor($parent);
    ensure($portal->downloadReportCard($student, $publishedCard, new AuditLogger($request))->getStatusCode() === 200, 'Own-child latest artifact');
    ensure($portal->childReportCards($other, new AuditLogger($request))->getStatusCode() === 403, 'Other child denied');
    $json = json_encode($portal->childReportCards($student, new AuditLogger($request))->getData(true));
    foreach (['file_path', 'artifact_path', 'source_manifest', 'input_snapshot', 'generated_by'] as $field) ensure(!str_contains($json, $field), 'Minimized parent disclosure');
    $sponsorUser = actor('sponsor'); $sponsor = Sponsor::create(['name' => 'Memory sponsor', 'sponsor_type' => 'individual', 'user_id' => $sponsorUser->id]);
    $sponsorship = Sponsorship::create(['sponsor_id' => $sponsor->id, 'student_id' => null, 'sponsorship_type' => 'group', 'status' => 'ended', 'start_date' => '2026-01-01']); $sponsorship->students()->attach($student->id);
    $sponsorPortal = new SponsorPortalController(); $request = requestFor($sponsorUser);
    ensure($sponsorPortal->downloadLearnerReportCard($sponsorship, $student, $publishedCard, new AuditLogger($request))->getStatusCode() === 200, 'Owned group member artifact');
    ensure($sponsorPortal->learnerReportCards($sponsorship, $other, new AuditLogger($request))->getStatusCode() === 403, 'Nonmember denied');
    $json = json_encode($sponsorPortal->learnerReportCards($sponsorship, $student, new AuditLogger($request))->getData(true));
    ensure(!str_contains($json, 'artifact_path') && !str_contains($json, 'source_manifest') && !str_contains($json, 'file_path'), 'Minimized sponsor disclosure');
});

check('retained revision downloads are bound to their parent and verify artifact checksums', function () use ($reportController, $leader, $memory) {
    global $publishedCard;
    $request = requestFor($leader); $old = $publishedCard->revisions()->where('revision_number', 2)->first();
    ensure($reportController->downloadRevision($request, $publishedCard, $old)->getStatusCode() === 200, 'Leadership retained artifact download');
    $other = ReportCard::where('id', '!=', $publishedCard->id)->first();
    try { $reportController->downloadRevision($request, $other, $old); throw new RuntimeException('Expected parent mismatch'); } catch (HttpException $exception) { ensure($exception->getStatusCode() === 404, 'Revision bound to parent'); }
    $bytes = $memory->private->get($old->artifact_path); $memory->private->files[$old->artifact_path] = 'tampered';
    ensure($reportController->downloadRevision($request, $publishedCard, $old)->getStatusCode() === 409, 'Checksum mismatch blocked'); $memory->private->files[$old->artifact_path] = $bytes;
});

check('safe local logos are embedded in the rendered identity snapshot, not referenced through mutable paths', function () use ($publication, $leader, $memory) {
    global $publishedCase, $publishedCard;
    $bytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQkAAAAASUVORK5CYII=');
    $memory->public->files['school/memory-logo.png'] = $bytes; SchoolSetting::first()->update(['logo_path' => 'school/memory-logo.png']);
    $request = requestFor($leader); $card = $publication->publish($publishedCase['student']->id, $publishedCase['term']->id, 'Logo snapshot', $leader, new AuditLogger($request));
    $revision = $card->revisions()->where('revision_number', $card->revision_number)->first();
    $logo = $revision->input_snapshot['school']['logo_data_uri'];
    ensure($logo === 'data:image/png;base64,'.base64_encode($bytes), 'Actual local image bytes embedded');
    unset($memory->public->files['school/memory-logo.png']); SchoolSetting::first()->update(['logo_path' => null]);
    ensure($revision->fresh()->input_snapshot['school']['logo_data_uri'] === $logo, 'Later logo deletion cannot redefine the snapshot');
});

check('the actual PDF renderer accepts snapshotted inputs and neutral performance terminology', function () {
    global $publishedCard;
    $input = $publishedCard->revisions()->where('revision_number', 3)->first()->input_snapshot;
    $renderer = new class extends ReportPublication { public function preview(array $input): string { return $this->render($input); } };
    $bytes = $renderer->preview($input);
    ensure(str_starts_with($bytes, '%PDF-') && strlen($bytes) > 1000, 'Actual DomPDF bytes generated in memory; no report fixture persisted');
});

echo ($passed - $start).' Option A checks passed; report artifacts used in-process memory storage only.'.PHP_EOL;
