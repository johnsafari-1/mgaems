<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('teaching_document_revisions', function (Blueprint $table) {
            $table->id();
            $table->string('document_type', 40);
            $table->unsignedBigInteger('document_id');
            $table->unsignedInteger('revision_number');
            $table->string('event', 40);
            $table->string('status', 20);
            $table->json('snapshot');
            $table->char('snapshot_sha256', 64);
            $table->foreignId('acted_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->timestamp('created_at');
            $table->unique(['document_type', 'document_id', 'revision_number'], 'uq_teaching_document_revision');
            $table->index(['document_type', 'status', 'created_at'], 'idx_teaching_document_review_queue');
        });

        Schema::create('ai_generation_runs', function (Blueprint $table) {
            $table->id();
            $table->string('operation', 50);
            $table->string('provider', 80);
            $table->string('state', 20);
            $table->string('document_type', 40)->nullable();
            $table->unsignedBigInteger('document_id')->nullable();
            $table->char('input_sha256', 64);
            $table->json('output')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('accepted_by')->nullable()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();
            $table->index(['operation', 'created_at'], 'idx_ai_generation_runs_operation');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_generation_runs');
        Schema::dropIfExists('teaching_document_revisions');
    }
};
