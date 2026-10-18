<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('curriculum_sources', function (Blueprint $table) {
            $table->id();
            $table->string('identifier', 120)->unique();
            $table->string('title', 200);
            $table->string('official_url', 1000);
            $table->string('publisher', 160);
            $table->unsignedTinyInteger('grade');
            $table->string('learning_area', 160);
            $table->foreignId('subject_id')->nullable()->constrained('subjects')->restrictOnDelete();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->index(['grade', 'learning_area']);
        });
        Schema::create('curriculum_source_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('curriculum_source_id')->constrained()->restrictOnDelete();
            $table->string('edition', 120);
            $table->date('publication_date')->nullable();
            $table->string('document_url', 1000);
            $table->char('document_sha256', 64);
            $table->string('document_path', 255);
            $table->unsignedBigInteger('document_bytes');
            $table->string('authorization_basis', 2000);
            $table->string('approval_status', 20)->default('draft');
            $table->string('verification_status', 20)->default('pending');
            $table->text('verification_notes')->nullable();
            $table->char('content_sha256', 64)->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();
            $table->unique(['curriculum_source_id', 'edition'], 'curriculum_version_edition_unique');
            $table->unique(['curriculum_source_id', 'document_sha256'], 'curriculum_version_document_unique');
        });
        Schema::create('curriculum_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('curriculum_source_version_id')->constrained()->restrictOnDelete();
            $table->string('record_key', 80);
            $table->string('strand', 200);
            $table->string('sub_strand', 200);
            $table->json('suggested_learning_experiences');
            $table->json('key_inquiry_questions');
            $table->json('assessment_approaches');
            $table->string('page_reference', 200);
            $table->timestamps();
            $table->unique(['curriculum_source_version_id', 'record_key'], 'curriculum_record_key_unique');
        });
        Schema::create('curriculum_learning_outcomes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('curriculum_record_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('position');
            $table->text('description');
            $table->unique(['curriculum_record_id', 'position'], 'curriculum_outcome_position_unique');
        });
    }

    public function down(): void
    {
        // Source references are retained evidence. Removal requires a separately
        // reviewed archival procedure; rollback must never discard curriculum.
        throw new RuntimeException('Curriculum library rollback is intentionally non-destructive.');
    }
};
