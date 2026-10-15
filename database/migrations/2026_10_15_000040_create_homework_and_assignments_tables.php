<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('homeworks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_subject_teacher_id')->constrained('class_subject_teacher')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('lesson_plan_id')->nullable()->constrained('lesson_plans')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('scheme_of_work_week_id')->nullable()->constrained('scheme_of_work_weeks')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('title', 160);
            $table->text('instructions');
            $table->text('learning_outcomes');
            $table->unsignedSmallInteger('total_marks')->nullable();
            $table->date('assigned_on');
            $table->date('due_on');
            $table->string('submission_method', 30);
            $table->text('teacher_notes')->nullable();
            $table->string('status', 20)->default('draft');
            $table->foreignId('created_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->timestamp('published_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->index(['class_subject_teacher_id', 'due_on'], 'idx_homeworks_assignment_due');
            $table->index('status', 'idx_homeworks_status');
        });

        Schema::create('homework_questions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('homework_id')->constrained('homeworks')->cascadeOnUpdate()->cascadeOnDelete();
            $table->unsignedSmallInteger('position');
            $table->string('question_type', 20);
            $table->text('prompt');
            $table->unsignedSmallInteger('marks')->nullable();
            $table->string('diagram_reference', 255)->nullable();
            $table->text('options')->nullable();
            $table->text('answer_key')->nullable();
            $table->text('marking_guidance')->nullable();
            $table->timestamps();

            $table->unique(['homework_id', 'position'], 'uq_homework_question_position');
        });

        // One row only exists when a teacher has recorded actual evidence for a
        // learner. An absent row means "not yet recorded", never "missing".
        Schema::create('homework_completions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('homework_id')->constrained('homeworks')->cascadeOnUpdate()->cascadeOnDelete();
            $table->foreignId('student_id')->constrained('students')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('status', 20);
            $table->text('notes')->nullable();
            $table->foreignId('recorded_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->timestamp('recorded_at')->useCurrent();
            $table->timestamps();

            $table->unique(['homework_id', 'student_id'], 'uq_homework_completion');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('homework_completions');
        Schema::dropIfExists('homework_questions');
        Schema::dropIfExists('homeworks');
    }
};
