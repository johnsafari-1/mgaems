<?php

namespace Tests\Feature;

use App\Models\Assessment;
use App\Models\ClassSubjectTeacher;
use App\Models\Role;
use App\Models\Staff;
use App\Models\Student;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AssessmentApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $teacher;
    private User $otherTeacher;
    private Staff $teacherStaff;
    private array $context;
    private Student $student;
    private Student $otherStudent;

    protected function setUp(): void
    {
        parent::setUp();

        $adminRole = Role::create(['name' => 'system_admin']);
        $teacherRole = Role::create(['name' => 'teacher']);
        $this->admin = $this->user('admin', $adminRole->id);
        $this->teacher = $this->user('teacher', $teacherRole->id);
        $this->otherTeacher = $this->user('other', $teacherRole->id);

        $this->teacherStaff = $this->staff($this->teacher, 'Assigned');
        $this->staff($this->otherTeacher, 'Unassigned');

        $yearId = DB::table('academic_years')->insertGetId([
            'name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31', 'is_current' => true,
        ]);
        $termId = DB::table('terms')->insertGetId([
            'academic_year_id' => $yearId, 'name' => 'Term 1', 'start_date' => '2026-01-01',
            'end_date' => '2026-04-01', 'is_current' => true,
        ]);
        $classId = DB::table('classes')->insertGetId(['name' => 'Grade 4', 'level' => 'primary', 'sequence' => 4]);
        $otherClassId = DB::table('classes')->insertGetId(['name' => 'Grade 5', 'level' => 'primary', 'sequence' => 5]);
        $subjectId = DB::table('subjects')->insertGetId(['name' => 'Mathematics', 'code' => 'MAT', 'status' => 'active']);
        DB::table('class_subjects')->insert(['class_id' => $classId, 'subject_id' => $subjectId]);

        $this->context = [
            'class_id' => $classId, 'subject_id' => $subjectId, 'term_id' => $termId,
            'assessment_type' => 'continuous',
        ];
        ClassSubjectTeacher::create($this->context + ['staff_id' => $this->teacherStaff->id]);
        $this->student = $this->student('MGA001', $classId, 'Ada');
        $this->otherStudent = $this->student('MGA002', $otherClassId, 'Grace');
    }

    public function test_administrator_receives_school_wide_context(): void
    {
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/v1/assessments/context')->assertOk()
            ->assertJsonPath('data.scope', 'school')
            ->assertJsonCount(2, 'data.classes');
    }

    public function test_teacher_context_contains_only_that_staff_members_assignments(): void
    {
        Sanctum::actingAs($this->teacher);

        $this->getJson('/api/v1/assessments/context')->assertOk()
            ->assertJsonPath('data.scope', 'assigned')
            ->assertJsonCount(1, 'data.assignments')
            ->assertJsonPath('data.assignments.0.staff_id', $this->teacherStaff->id);
    }

    public function test_assigned_teacher_can_create_and_update_without_a_duplicate(): void
    {
        Sanctum::actingAs($this->teacher);
        $payload = $this->context + ['student_id' => $this->student->id, 'score' => 64];

        $this->postJson('/api/v1/assessments', $payload)->assertCreated();
        $this->postJson('/api/v1/assessments', $payload + ['score' => 88])->assertOk()
            ->assertJsonPath('data.score', '88.00');

        $this->assertDatabaseCount('assessments', 1);
        $this->assertDatabaseHas('assessments', ['score' => 88, 'recorded_by' => $this->teacher->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'RECORD_ASSESSMENT']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'UPDATE_ASSESSMENT']);
    }

    public function test_unassigned_teacher_cannot_record_an_assessment(): void
    {
        Sanctum::actingAs($this->otherTeacher);

        $this->postJson('/api/v1/assessments', $this->context + [
            'student_id' => $this->student->id, 'score' => 80,
        ])->assertForbidden()->assertJsonPath('error.code', 'FORBIDDEN');
    }

    public function test_teacher_cannot_assess_a_student_from_another_class(): void
    {
        Sanctum::actingAs($this->teacher);

        $this->postJson('/api/v1/assessments', $this->context + [
            'student_id' => $this->otherStudent->id, 'score' => 80,
        ])->assertForbidden();
    }

    public function test_score_and_competency_are_validated(): void
    {
        Sanctum::actingAs($this->teacher);
        $base = $this->context + ['student_id' => $this->student->id];

        $this->postJson('/api/v1/assessments', $base + ['score' => 101])
            ->assertUnprocessable()->assertJsonValidationErrors('score');
        $this->postJson('/api/v1/assessments', $base + ['competency_rating' => 'Excellent'])
            ->assertUnprocessable()->assertJsonValidationErrors('competency_rating');
    }

    public function test_roster_contains_only_active_class_learners_and_existing_assessment(): void
    {
        Assessment::create([
            'student_id' => $this->student->id, 'subject_id' => $this->context['subject_id'],
            'term_id' => $this->context['term_id'], 'assessment_type' => 'continuous',
            'score' => 75, 'recorded_by' => $this->teacher->id, 'recorded_at' => now(),
        ]);
        Sanctum::actingAs($this->teacher);

        $this->getJson('/api/v1/assessments/learners?'.http_build_query($this->context))->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $this->student->id)
            ->assertJsonPath('data.0.assessment.assessment_type', 'continuous');
    }

    public function test_assessments_remain_compatible_with_report_card_subject_grouping(): void
    {
        foreach (['continuous', 'end_term'] as $type) {
            Assessment::create([
                'student_id' => $this->student->id, 'subject_id' => $this->context['subject_id'],
                'term_id' => $this->context['term_id'], 'assessment_type' => $type,
                'score' => $type === 'continuous' ? 60 : 80,
                'competency_rating' => 'Meeting Expectation', 'remarks' => 'On track',
                'recorded_by' => $this->teacher->id, 'recorded_at' => now(),
            ]);
        }

        $rows = Assessment::with('subject')->where('student_id', $this->student->id)->get()->groupBy('subject_id');
        $this->assertSame(1, $rows->count());
        $this->assertNotNull($rows->first()->firstWhere('assessment_type', 'continuous'));
        $this->assertNotNull($rows->first()->firstWhere('assessment_type', 'end_term'));
    }

    private function user(string $name, int $roleId): User
    {
        return User::create([
            'username' => $name, 'email' => "$name@example.test", 'password_hash' => bcrypt('password'),
            'role_id' => $roleId, 'status' => 'active',
        ]);
    }

    private function staff(User $user, string $firstName): Staff
    {
        return Staff::create([
            'user_id' => $user->id, 'staff_type' => 'teaching', 'role_title' => 'Teacher',
            'first_name' => $firstName, 'last_name' => 'Teacher', 'employment_date' => '2026-01-01',
            'status' => 'active',
        ]);
    }

    private function student(string $admissionNo, int $classId, string $firstName): Student
    {
        return Student::create([
            'admission_no' => $admissionNo, 'first_name' => $firstName, 'last_name' => 'Learner',
            'date_of_birth' => '2015-01-01', 'gender' => 'female', 'class_id' => $classId,
            'status' => 'active', 'admission_date' => '2026-01-01',
        ]);
    }
}
