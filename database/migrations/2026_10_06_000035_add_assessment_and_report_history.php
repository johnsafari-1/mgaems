<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Additive only: do not derive historical context from current placement.
        Schema::table('assessments', function (Blueprint $table) {
            $table->foreignId('class_id')->nullable()->constrained('classes')->restrictOnDelete();
            $table->foreignId('class_subject_id')->nullable()->constrained('class_subjects')->restrictOnDelete();
            $table->foreignId('authorization_assignment_id')->nullable()->constrained('class_subject_teacher')->restrictOnDelete();
            $table->string('authority_type', 30)->default('legacy_unknown');
            $table->json('context_snapshot')->nullable();
            $table->unsignedInteger('revision_number')->default(0);
            $table->index(['class_id', 'subject_id', 'term_id'], 'idx_assessment_historical_context');
        });
        Schema::create('assessment_revisions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('assessment_id')->constrained('assessments')->restrictOnDelete();
            $table->unsignedInteger('revision_number');
            $table->decimal('score', 5, 2)->nullable();
            $table->string('competency_rating', 30)->nullable();
            $table->text('remarks')->nullable();
            $table->foreignId('actor_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('recorded_at')->nullable();
            $table->string('change_type', 30);
            $table->string('authority_type', 30);
            $table->foreignId('assignment_id')->nullable()->constrained('class_subject_teacher')->restrictOnDelete();
            $table->json('context_snapshot')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['assessment_id', 'revision_number'], 'uq_assessment_revision');
        });
        Schema::table('report_cards', function (Blueprint $table) {
            // Latest published sequence; file_path remains a compatible projection.
            $table->unsignedInteger('revision_number')->default(0);
        });
        Schema::create('report_card_revisions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('report_card_id')->constrained('report_cards')->restrictOnDelete();
            $table->unsignedInteger('revision_number');
            $table->timestamp('generated_at')->nullable();
            $table->foreignId('generated_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('artifact_path')->nullable()->unique();
            $table->char('artifact_sha256', 64)->nullable();
            $table->unsignedBigInteger('artifact_size')->nullable();
            $table->json('input_snapshot')->nullable();
            $table->json('source_manifest')->nullable();
            $table->string('template_version', 50)->nullable();
            $table->string('provenance', 30);
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['report_card_id', 'revision_number'], 'uq_report_card_revision');
        });
    }

    public function down(): void
    {
        // Intentionally irreversible: rolling this history migration back would
        // discard educational records. Restore reviewed backups instead.
        throw new RuntimeException('Assessment/report history is forward-only; rollback would delete preserved records.');
    }
};
