<?php

namespace Tests\Feature;

use App\Models\ReportCard;
use App\Models\Role;
use App\Models\Sponsor;
use App\Models\Sponsorship;
use App\Models\Student;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SponsorPortalApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_sponsor_ownership_types_statuses_membership_and_download_are_enforced(): void
    {
        $role = Role::create(['name' => 'sponsor']); $adminRole = Role::create(['name' => 'system_admin']);
        $user = $this->user('sponsor', $role); $otherUser = $this->user('other', $role); $admin = $this->user('admin', $adminRole);
        $sponsor = Sponsor::create(['name' => 'Own', 'sponsor_type' => 'individual', 'user_id' => $user->id]);
        $otherSponsor = Sponsor::create(['name' => 'Other', 'sponsor_type' => 'individual', 'user_id' => $otherUser->id]);
        $class = DB::table('classes')->insertGetId(['name' => 'Grade 3', 'level' => 'primary', 'sequence' => 3]);
        $one = $this->student('S01', $class); $member = $this->student('S02', $class); $outsider = $this->student('S03', $class);
        $individual = $this->sponsorship($sponsor, $one, 'individual', 'paused', $admin);
        $group = $this->sponsorship($sponsor, null, 'group', 'ended', $admin); $group->students()->attach($member);
        $school = $this->sponsorship($sponsor, null, 'school_wide', 'active', $admin, 'Library');
        $foreign = $this->sponsorship($otherSponsor, $outsider, 'individual', 'active', $admin);
        $term = $this->term(); Storage::fake('private'); Storage::disk('private')->put('card.pdf', 'pdf');
        $card = ReportCard::create(['student_id' => $member->id, 'term_id' => $term, 'file_path' => 'card.pdf', 'generated_by' => $admin->id]);
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/portal/sponsor/sponsorships')->assertOk()->assertJsonCount(3, 'data')
            ->assertJsonMissingPath('data.0.created_by')->assertJsonMissingPath('data.0.created_at');
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$foreign->id}/attendance")->assertForbidden();
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$individual->id}/attendance")->assertOk(); // paused remains readable
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$individual->id}/report-cards")->assertOk();
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$individual->id}/comments")->assertOk();
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$group->id}/learners")->assertOk()->assertJsonCount(1, 'data');
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$group->id}/learners/{$member->id}/comments")->assertOk(); // ended remains readable
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$group->id}/learners/{$outsider->id}/attendance")->assertForbidden();
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$school->id}/attendance")->assertStatus(422)->assertJsonPath('error.code', 'SPONSORSHIP_TYPE_UNSUPPORTED');
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$group->id}/learners/{$member->id}/report-cards")->assertOk()
            ->assertJsonMissingPath('data.0.file_path')->assertJsonMissingPath('data.0.generated_by');
        $this->get("/api/v1/portal/sponsor/sponsorships/{$group->id}/learners/{$member->id}/report-cards/{$card->id}/download")->assertOk();
        $this->getJson("/api/v1/portal/sponsor/sponsorships/{$group->id}/learners/{$outsider->id}/report-cards/{$card->id}/download")->assertForbidden();
        $this->postJson('/api/v1/sponsors', [])->assertForbidden(); $this->patchJson("/api/v1/sponsorships/{$individual->id}", [])->assertForbidden();
    }

    private function user(string $name, Role $role): User { return User::create(['username' => $name, 'email' => "$name@test", 'password_hash' => bcrypt('x'), 'role_id' => $role->id, 'status' => 'active']); }
    private function student(string $number, int $class): Student { return Student::create(['admission_no' => $number, 'first_name' => 'Test', 'last_name' => 'Learner', 'date_of_birth' => '2017-01-01', 'gender' => 'male', 'class_id' => $class, 'status' => 'active', 'admission_date' => '2026-01-01']); }
    private function sponsorship(Sponsor $sponsor, ?Student $student, string $type, string $status, User $admin, ?string $program = null): Sponsorship { return Sponsorship::create(['sponsor_id' => $sponsor->id, 'student_id' => $student?->id, 'program_name' => $program, 'sponsorship_type' => $type, 'start_date' => '2026-01-01', 'status' => $status, 'created_by' => $admin->id]); }
    private function term(): int { $year = DB::table('academic_years')->insertGetId(['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31']); return DB::table('terms')->insertGetId(['academic_year_id' => $year, 'name' => 'Term 1', 'start_date' => '2026-01-01', 'end_date' => '2026-04-01']); }
}
