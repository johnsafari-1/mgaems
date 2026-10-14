<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('academic_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('academic_year_id')->constrained('academic_years')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('term_id')->nullable()->constrained('terms')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('title', 160);
            $table->text('description')->nullable();
            $table->string('event_type', 30);
            $table->date('starts_on');
            $table->date('ends_on');
            $table->foreignId('created_by')->nullable()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->timestamps();

            $table->index(['academic_year_id', 'starts_on'], 'idx_academic_events_year_start');
            $table->index(['term_id', 'starts_on'], 'idx_academic_events_term_start');
        });

        Schema::create('schemes_of_work', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_subject_teacher_id')->constrained('class_subject_teacher')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('title', 160);
            $table->string('curriculum_reference', 500)->nullable();
            $table->string('status', 20)->default('draft');
            $table->text('review_notes')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->unique('class_subject_teacher_id', 'uq_scheme_of_work_assignment');
            $table->index('status', 'idx_schemes_of_work_status');
        });

        Schema::create('scheme_of_work_weeks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scheme_of_work_id')->constrained('schemes_of_work')->cascadeOnUpdate()->restrictOnDelete();
            $table->unsignedSmallInteger('week_number');
            $table->date('starts_on')->nullable();
            $table->date('ends_on')->nullable();
            $table->string('strand', 255);
            $table->string('sub_strand', 255);
            $table->text('learning_outcomes');
            $table->text('learning_activities');
            $table->text('resources');
            $table->timestamps();

            $table->unique(['scheme_of_work_id', 'week_number'], 'uq_scheme_of_work_week');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scheme_of_work_weeks');
        Schema::dropIfExists('schemes_of_work');
        Schema::dropIfExists('academic_events');
    }
};
