<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-ASM-01/02/03/04 and UC-ASM-01/02.
 *
 * NOTE: deviates from the original Database Schema doc's `staff_id` FK
 * (-> staff.id): the HR module isn't built yet, so there are no `staff`
 * rows to reference. Uses `recorded_by` -> users.id instead, matching
 * the pattern already used in attendance_students and audit_logs. This
 * can be migrated to staff_id once the HR module lands, if desired.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assessments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_id')->constrained('students')->cascadeOnUpdate()->cascadeOnDelete();
            $table->foreignId('subject_id')->constrained('subjects')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('term_id')->constrained('terms')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('recorded_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->enum('assessment_type', ['continuous', 'end_term']);
            $table->decimal('score', 5, 2)->nullable();
            $table->string('competency_rating', 30)->nullable();
            $table->text('remarks')->nullable();
            $table->timestamp('recorded_at')->useCurrent();

            $table->index(['student_id', 'term_id'], 'idx_assess_student_term');
            $table->index('subject_id', 'idx_assess_subject');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('assessments');
    }
};
