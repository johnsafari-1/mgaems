<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-ACAD-04 and Database Schema §2.10: allocates a teacher to a
 * subject/class/stream for a given term.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('class_subject_teacher', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_id')->constrained('classes')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('stream_id')->nullable()->constrained('streams')->cascadeOnUpdate()->nullOnDelete();
            $table->foreignId('subject_id')->constrained('subjects')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('term_id')->constrained('terms')->cascadeOnUpdate()->restrictOnDelete();
            $table->timestamps();

            $table->unique(['class_id', 'stream_id', 'subject_id', 'term_id'], 'uq_allocation');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('class_subject_teacher');
    }
};
