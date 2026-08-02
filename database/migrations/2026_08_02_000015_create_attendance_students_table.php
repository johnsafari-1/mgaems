<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-ATT-01/02/03 and UC-ATT-01: daily attendance per learner.
 * One row per student per day — the unique index both enforces this and
 * lets us implement "re-opening the same day edits rather than
 * duplicates" (UC-ATT-01 alternate flow) via updateOrCreate in the
 * controller.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attendance_students', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_id')->constrained('students')->cascadeOnUpdate()->cascadeOnDelete();
            $table->foreignId('class_id')->constrained('classes')->cascadeOnUpdate()->restrictOnDelete();
            $table->date('attendance_date');
            $table->enum('status', ['present', 'absent', 'late', 'excused']);
            $table->foreignId('recorded_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->timestamps();

            $table->unique(['student_id', 'attendance_date'], 'uq_student_attendance');
            $table->index(['class_id', 'attendance_date'], 'idx_attendance_class_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_students');
    }
};
