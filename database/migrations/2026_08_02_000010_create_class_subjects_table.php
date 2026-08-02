<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Junction table: which subjects are taught in which class.
 * Per SRS FR-ACAD-03 and Database Schema §2.9 (class_subjects).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('class_subjects', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_id')->constrained('classes')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('subject_id')->constrained('subjects')->cascadeOnUpdate()->restrictOnDelete();

            $table->unique(['class_id', 'subject_id'], 'uq_class_subject');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('class_subjects');
    }
};
