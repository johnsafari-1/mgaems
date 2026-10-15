<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('exam_papers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_subject_teacher_id')->constrained('class_subject_teacher')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('examination_type', 80);
            $table->string('title', 160);
            $table->text('instructions')->nullable();
            $table->unsignedSmallInteger('duration_minutes')->nullable();
            $table->date('exam_date')->nullable();
            $table->string('status', 20)->default('draft');
            $table->unsignedInteger('revision_number')->default(1);
            $table->text('review_notes')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->timestamps();
            $table->index(['class_subject_teacher_id', 'exam_date'], 'idx_exam_papers_assignment_date');
            $table->index('status', 'idx_exam_papers_status');
        });

        Schema::create('exam_paper_sections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('exam_paper_id')->constrained('exam_papers')->cascadeOnUpdate()->cascadeOnDelete();
            $table->unsignedSmallInteger('position');
            $table->string('title', 160);
            $table->text('instructions')->nullable();
            $table->timestamps();
            $table->unique(['exam_paper_id', 'position'], 'uq_exam_paper_section_position');
        });

        Schema::create('exam_paper_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('exam_paper_id')->constrained('exam_papers')->cascadeOnUpdate()->cascadeOnDelete();
            $table->string('storage_path', 500);
            $table->string('original_name', 255);
            $table->string('mime_type', 100);
            $table->unsignedBigInteger('byte_size');
            $table->char('sha256', 64);
            $table->foreignId('uploaded_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->timestamps();
        });

        Schema::create('exam_paper_questions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('exam_paper_id')->constrained('exam_papers')->cascadeOnUpdate()->cascadeOnDelete();
            $table->foreignId('exam_paper_section_id')->nullable()->constrained('exam_paper_sections')->cascadeOnUpdate()->nullOnDelete();
            $table->foreignId('exam_paper_attachment_id')->nullable()->constrained('exam_paper_attachments')->cascadeOnUpdate()->nullOnDelete();
            $table->unsignedSmallInteger('position');
            $table->string('question_type', 30);
            $table->text('prompt');
            $table->unsignedSmallInteger('marks')->nullable();
            $table->string('diagram_reference', 255)->nullable();
            $table->text('options')->nullable();
            $table->text('answer_key')->nullable();
            $table->text('marking_guidance')->nullable();
            $table->boolean('ai_generated')->default(false);
            $table->string('ai_source', 80)->nullable();
            $table->timestamps();
            $table->unique(['exam_paper_id', 'position'], 'uq_exam_paper_question_position');
        });

        Schema::create('exam_paper_revisions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('exam_paper_id')->constrained('exam_papers')->cascadeOnUpdate()->cascadeOnDelete();
            $table->unsignedInteger('revision_number');
            $table->string('status', 20);
            $table->json('snapshot');
            $table->string('paper_pdf_path', 500)->nullable();
            $table->string('marking_pdf_path', 500)->nullable();
            $table->char('snapshot_sha256', 64);
            $table->foreignId('created_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->timestamp('created_at');
            $table->unique(['exam_paper_id', 'revision_number'], 'uq_exam_paper_revision');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exam_paper_revisions');
        Schema::dropIfExists('exam_paper_questions');
        Schema::dropIfExists('exam_paper_attachments');
        Schema::dropIfExists('exam_paper_sections');
        Schema::dropIfExists('exam_papers');
    }
};
