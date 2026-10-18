<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lesson_plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_subject_teacher_id')->constrained('class_subject_teacher')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('scheme_of_work_week_id')->nullable()->constrained('scheme_of_work_weeks')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('duplicated_from_lesson_plan_id')->nullable()->constrained('lesson_plans')->cascadeOnUpdate()->nullOnDelete();
            $table->string('title', 160);
            $table->date('lesson_date');
            $table->unsignedSmallInteger('duration_minutes');
            $table->string('strand', 255);
            $table->string('sub_strand', 255);
            $table->text('specific_learning_outcomes');
            $table->text('key_inquiry_questions');
            $table->text('teaching_learning_resources');
            $table->text('introduction');
            $table->text('lesson_development');
            $table->text('conclusion');
            $table->text('learning_activities');
            $table->text('assessment_approach');
            $table->text('teacher_reflection')->nullable();
            $table->string('status', 20)->default('draft');
            $table->text('review_notes')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->index(['class_subject_teacher_id', 'lesson_date'], 'idx_lesson_plans_assignment_date');
            $table->index('status', 'idx_lesson_plans_status');
        });

        Schema::create('records_of_work', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_subject_teacher_id')->constrained('class_subject_teacher')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('lesson_plan_id')->nullable()->constrained('lesson_plans')->cascadeOnUpdate()->restrictOnDelete();
            $table->date('taught_on');
            $table->text('content_covered');
            $table->text('learning_activities_conducted');
            $table->text('work_completed');
            $table->text('work_not_completed')->nullable();
            $table->text('reasons_for_deviations')->nullable();
            $table->text('teacher_observations');
            $table->text('follow_up_actions')->nullable();
            $table->string('status', 20)->default('draft');
            $table->text('review_notes')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->index(['class_subject_teacher_id', 'taught_on'], 'idx_records_of_work_assignment_date');
            $table->index('status', 'idx_records_of_work_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('records_of_work');
        Schema::dropIfExists('lesson_plans');
    }
};
