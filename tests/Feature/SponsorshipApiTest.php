<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\Sponsor;
use App\Models\Sponsorship;
use App\Models\Student;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SponsorshipApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $coordinator;
    private User $head;
    private User $teacher;
    private Sponsor $sponsor;
    private Student $student;
    private Student $secondStudent;

    protected function setUp(): void
    {
        parent::setUp();
        foreach (['system_admin', 'sponsor_coordinator', 'head_teacher', 'teacher', 'sponsor'] as $role) {
            Role::create(['name' => $role]);
        }
        $this->admin = $this->user('admin', 'system_admin');
        $this->coordinator = $this->user('coordinator', 'sponsor_coordinator');
        $this->head = $this->user('head', 'head_teacher');
        $this->teacher = $this->user('teacher', 'teacher');
        $classId = DB::table('classes')->insertGetId(['name' => 'Grade 4', 'level' => 'primary', 'sequence' => 4]);
        $this->student = $this->student('MGA001', 'Ada', $classId);
        $this->secondStudent = $this->student('MGA002', 'Grace', $classId);
        $this->sponsor = Sponsor::create(['name' => 'Hope Fund', 'sponsor_type' => 'foundation']);
    }

    public function test_sponsor_create_and_duplicate_create_and_update_are_enforced(): void
    {
        Sanctum::actingAs($this->coordinator);
        $this->postJson('/api/v1/sponsors', ['name' => 'Community', 'sponsor_type' => 'ngo'])->assertCreated();
        $this->postJson('/api/v1/sponsors', ['name' => 'Community', 'sponsor_type' => 'ngo'])
            ->assertConflict()->assertJsonPath('error.code', 'DUPLICATE_SPONSOR');
        $other = Sponsor::create(['name' => 'Other', 'sponsor_type' => 'ngo']);
        $this->patchJson("/api/v1/sponsors/{$other->id}", ['name' => 'Community', 'sponsor_type' => 'ngo'])
            ->assertConflict()->assertJsonPath('error.code', 'DUPLICATE_SPONSOR');
        $this->patchJson("/api/v1/sponsors/{$other->id}", ['name' => 'Other'])->assertOk();
    }

    public function test_individual_creation_rejects_duplicate_active_and_invalid_dates(): void
    {
        Sanctum::actingAs($this->admin);
        $payload = $this->base('individual') + ['student_id' => $this->student->id];
        $this->postJson('/api/v1/sponsorships', $payload)->assertCreated()
            ->assertJsonPath('data.student.id', $this->student->id);
        $this->postJson('/api/v1/sponsorships', $payload)->assertConflict()
            ->assertJsonPath('error.code', 'ALREADY_SPONSORED');
        $this->postJson('/api/v1/sponsorships', $this->base('individual') + [
            'student_id' => $this->secondStudent->id, 'end_date' => '2025-12-31',
        ])->assertUnprocessable()->assertJsonValidationErrors('end_date');
    }

    public function test_group_and_school_wide_sponsorships_are_normalized_and_returned(): void
    {
        Sanctum::actingAs($this->coordinator);
        $group = $this->postJson('/api/v1/sponsorships', $this->base('group') + [
            'student_ids' => [$this->student->id, $this->secondStudent->id],
        ])->assertCreated()->assertJsonCount(2, 'data.students')->json('data');
        $this->assertDatabaseCount('sponsorship_student', 2);
        $this->getJson("/api/v1/sponsorships/{$group['id']}")->assertOk()->assertJsonCount(2, 'data.students');
        $this->postJson('/api/v1/sponsorships', $this->base('school_wide') + ['program_name' => 'Library Programme'])
            ->assertCreated()->assertJsonPath('data.program_name', 'Library Programme');
    }

    public function test_pause_resume_end_rules_and_terminal_state_are_enforced(): void
    {
        Sanctum::actingAs($this->admin);
        $item = Sponsorship::create($this->base('individual') + [
            'student_id' => $this->student->id, 'status' => 'active', 'created_by' => $this->admin->id,
        ]);
        $this->patchJson("/api/v1/sponsorships/{$item->id}", ['status' => 'paused'])->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'PAUSE_SPONSORSHIP']);
        $this->patchJson("/api/v1/sponsorships/{$item->id}", ['status' => 'active'])->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'RESUME_SPONSORSHIP']);
        $this->patchJson("/api/v1/sponsorships/{$item->id}", ['status' => 'ended'])
            ->assertUnprocessable()->assertJsonValidationErrors(['end_date', 'notes']);
        $this->patchJson("/api/v1/sponsorships/{$item->id}", [
            'status' => 'ended', 'end_date' => '2026-06-01', 'notes' => 'Programme completed',
        ])->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'END_SPONSORSHIP']);
        $this->patchJson("/api/v1/sponsorships/{$item->id}", ['status' => 'active'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'TERMINAL_STATE');
    }

    public function test_authorization_and_minimal_learner_lookup(): void
    {
        Sanctum::actingAs($this->head);
        $this->getJson('/api/v1/sponsorships')->assertOk();
        $this->postJson('/api/v1/sponsors', ['name' => 'Blocked', 'sponsor_type' => 'ngo'])->assertForbidden();
        $response = $this->getJson('/api/v1/sponsorships/learners')->assertOk()
            ->assertJsonMissingPath('data.0.date_of_birth')->assertJsonMissingPath('data.0.gender');
        $this->assertSame(['admission_no', 'class_id', 'first_name', 'has_active_individual_sponsorship', 'id', 'last_name', 'school_class', 'status'], array_keys($response->json('data.0')));
        Sanctum::actingAs($this->teacher);
        $this->getJson('/api/v1/sponsorships')->assertForbidden();
        $this->getJson('/api/v1/sponsorships/learners')->assertForbidden();
    }

    public function test_sponsor_portal_cannot_access_another_sponsors_records(): void
    {
        $portalUser = $this->user('portal', 'sponsor');
        $ownSponsor = Sponsor::create(['name' => 'Portal Sponsor', 'sponsor_type' => 'individual', 'user_id' => $portalUser->id]);
        $own = Sponsorship::create(array_merge($this->base('individual'), ['sponsor_id' => $ownSponsor->id, 'student_id' => $this->student->id, 'status' => 'active', 'created_by' => $this->admin->id]));
        $other = Sponsorship::create($this->base('individual') + ['student_id' => $this->secondStudent->id, 'status' => 'active', 'created_by' => $this->admin->id]);
        Sanctum::actingAs($portalUser);
        $this->getJson('/api/v1/portal/sponsor/sponsorships')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $own->id);
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$other->id}/attendance")->assertForbidden();
    }

    private function base(string $type): array
    {
        return ['sponsor_id' => $this->sponsor->id, 'sponsorship_type' => $type, 'start_date' => '2026-01-01'];
    }

    private function user(string $name, string $role): User
    {
        return User::create(['username' => $name, 'email' => "$name@example.test", 'password_hash' => bcrypt('password'), 'role_id' => Role::where('name', $role)->value('id'), 'status' => 'active']);
    }

    private function student(string $number, string $name, int $classId): Student
    {
        return Student::create(['admission_no' => $number, 'first_name' => $name, 'last_name' => 'Learner', 'date_of_birth' => '2015-01-01', 'gender' => 'female', 'class_id' => $classId, 'status' => 'active', 'admission_date' => '2026-01-01']);
    }
}
