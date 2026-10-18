<?php

namespace Tests\Feature;

use App\Models\Guardian;
use App\Models\ReportCard;
use App\Models\Role;
use App\Models\Student;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ParentPortalApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_parent_resources_are_owned_and_minimized_and_download_is_scoped(): void
    {
        $role = Role::create(['name' => 'parent_guardian']);
        $parent = User::create(['username' => 'parent', 'email' => 'parent@test', 'password_hash' => bcrypt('x'), 'role_id' => $role->id, 'status' => 'active']);
        $class = DB::table('classes')->insertGetId(['name' => 'Grade 2', 'level' => 'primary', 'sequence' => 2]);
        $own = $this->student('P01', $class); $foreign = $this->student('P02', $class);
        Guardian::create(['student_id' => $own->id, 'user_id' => $parent->id, 'full_name' => 'Parent', 'relationship' => 'parent', 'phone' => '1']);
        $term = $this->term();
        DB::table('attendance_students')->insert(['student_id' => $own->id, 'class_id' => $class, 'attendance_date' => '2026-01-02', 'status' => 'present', 'recorded_by' => $parent->id]);
        DB::table('subjects')->insert(['id' => 1, 'name' => 'Math', 'code' => 'MAT', 'status' => 'active']);
        DB::table('assessments')->insert(['student_id' => $own->id, 'subject_id' => 1, 'term_id' => $term, 'recorded_by' => $parent->id, 'assessment_type' => 'continuous', 'score' => 80, 'remarks' => 'Good']);
        Storage::fake('private'); Storage::disk('private')->put('cards/own.pdf', 'pdf'); Storage::disk('private')->put('cards/foreign.pdf', 'pdf');
        $ownCard = ReportCard::create(['student_id' => $own->id, 'term_id' => $term, 'file_path' => 'cards/own.pdf']);
        $foreignCard = ReportCard::create(['student_id' => $foreign->id, 'term_id' => $term, 'file_path' => 'cards/foreign.pdf']);
        Sanctum::actingAs($parent);

        $this->getJson('/api/v1/portal/parent/children')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonMissingPath('data.0.date_of_birth')->assertJsonMissingPath('data.0.created_at');
        $this->getJson("/api/v1/portal/parent/children/{$own->id}/attendance")->assertOk()->assertJsonPath('data.summary.total', 1);
        $this->getJson("/api/v1/portal/parent/children/{$own->id}/progress")->assertOk()
            ->assertJsonMissingPath('data.0.recorded_by')->assertJsonPath('data.0.subject', 'Math');
        $this->getJson("/api/v1/portal/parent/children/{$own->id}/report-cards")->assertOk()
            ->assertJsonMissingPath('data.0.file_path')->assertJsonMissingPath('data.0.generated_by');
        $this->get("/api/v1/portal/parent/children/{$own->id}/report-cards/{$ownCard->id}/download")->assertOk();
        $this->getJson("/api/v1/portal/parent/children/{$foreign->id}/attendance")->assertForbidden();
        $this->getJson("/api/v1/portal/parent/children/{$own->id}/report-cards/{$foreignCard->id}/download")->assertForbidden();
        $this->postJson('/api/v1/sponsorships', [])->assertForbidden();
    }

    private function student(string $number, int $class): Student { return Student::create(['admission_no' => $number, 'first_name' => 'Test', 'last_name' => 'Learner', 'date_of_birth' => '2018-01-01', 'gender' => 'female', 'class_id' => $class, 'status' => 'active', 'admission_date' => '2026-01-01']); }
    private function term(): int { $year = DB::table('academic_years')->insertGetId(['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31']); return DB::table('terms')->insertGetId(['academic_year_id' => $year, 'name' => 'Term 1', 'start_date' => '2026-01-01', 'end_date' => '2026-04-01']); }
}
