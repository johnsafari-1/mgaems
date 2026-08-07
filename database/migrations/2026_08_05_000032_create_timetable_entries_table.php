<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-ACAD-06/07. "Foundation" scope: entries + basic
 * teacher-double-booking conflict check on save. A full drag-and-drop
 * grid builder UI is a larger follow-up feature.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('timetable_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_id')->constrained('classes')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('stream_id')->nullable()->constrained('streams')->cascadeOnUpdate()->nullOnDelete();
            $table->foreignId('subject_id')->constrained('subjects')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnUpdate()->restrictOnDelete();
            $table->unsignedTinyInteger('day_of_week'); // 1=Monday .. 7=Sunday
            $table->time('start_time');
            $table->time('end_time');
            $table->timestamps();

            $table->index(['staff_id', 'day_of_week', 'start_time'], 'idx_timetable_teacher_slot');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('timetable_entries');
    }
};
