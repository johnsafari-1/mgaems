<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-SPN-02/03/04/05 and UC-SPN-02/03. student_id is nullable —
 * a sponsorship may target a named program or be school-wide rather than
 * tied to one learner, per the school's group/school-wide sponsorship
 * requirement (this deliberately does NOT model fee billing — see BRD §5.2).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sponsorships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sponsor_id')->constrained('sponsors')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('student_id')->nullable()->constrained('students')->cascadeOnUpdate()->cascadeOnDelete();
            $table->string('program_name', 150)->nullable();
            $table->enum('sponsorship_type', ['individual', 'group', 'school_wide']);
            $table->date('start_date');
            $table->date('end_date')->nullable();
            $table->enum('status', ['active', 'ended', 'paused'])->default('active');
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->timestamps();

            $table->index('sponsor_id', 'idx_sponsorship_sponsor');
            $table->index('student_id', 'idx_sponsorship_student');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sponsorships');
    }
};
