<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Remove stream columns from dependent tables before dropping streams.
        if (Schema::hasTable('class_subject_teacher') && Schema::hasColumn('class_subject_teacher', 'stream_id')) {
            // Drop the foreign key first. The old composite unique index
            // is also the supporting index for the stream_id foreign key.
            Schema::table('class_subject_teacher', function (Blueprint $table) {
                $table->dropForeign(['stream_id']);
                $table->dropUnique('uq_allocation');
                $table->dropColumn('stream_id');
            });

            Schema::table('class_subject_teacher', function (Blueprint $table) {
                $table->unique(['class_id', 'subject_id', 'term_id'], 'uq_allocation');
            });
        }

        if (Schema::hasTable('timetable_entries') && Schema::hasColumn('timetable_entries', 'stream_id')) {
            Schema::table('timetable_entries', function (Blueprint $table) {
                $table->dropForeign(['stream_id']);
                $table->dropColumn('stream_id');
            });
        }

        if (Schema::hasTable('students') && Schema::hasColumn('students', 'stream_id')) {
            // Drop the stream foreign key before removing the composite index
            // that supports it.
            Schema::table('students', function (Blueprint $table) {
                $table->dropForeign(['stream_id']);
                $table->dropIndex('idx_students_class');
                $table->dropColumn('stream_id');
            });

            Schema::table('students', function (Blueprint $table) {
                $table->index('class_id', 'idx_students_class');
            });
        }

        Schema::dropIfExists('streams');
    }

    public function down(): void
    {
        // This migration intentionally does not recreate the old stream model.
        // Restore from a database backup if the previous stream architecture is required.
    }
};
