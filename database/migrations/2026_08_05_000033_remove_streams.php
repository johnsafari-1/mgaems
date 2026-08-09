<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Manna Goodnews Academy does not use streams — removes the streams
 * table and every stream_id reference. Foreign keys are dropped before
 * the columns/table they reference, in dependency order.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('students', function (Blueprint $table) {
            $table->dropForeign(['stream_id']);
            $table->dropColumn('stream_id');
        });

        Schema::table('class_subject_teacher', function (Blueprint $table) {
            $table->dropForeign(['stream_id']);
            $table->dropUnique('uq_allocation');
            $table->dropColumn('stream_id');
            $table->unique(['class_id', 'subject_id', 'term_id'], 'uq_allocation');
        });

        Schema::table('timetable_entries', function (Blueprint $table) {
            $table->dropForeign(['stream_id']);
            $table->dropColumn('stream_id');
        });

        Schema::dropIfExists('streams');
    }

    public function down(): void
    {
        Schema::create('streams', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_id')->constrained('classes')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('name', 30);
            $table->unique(['class_id', 'name'], 'uq_stream');
        });

        Schema::table('students', function (Blueprint $table) {
            $table->foreignId('stream_id')->nullable()->constrained('streams')->cascadeOnUpdate()->nullOnDelete();
        });

        Schema::table('class_subject_teacher', function (Blueprint $table) {
            $table->dropUnique('uq_allocation');
            $table->foreignId('stream_id')->nullable()->constrained('streams')->cascadeOnUpdate()->nullOnDelete();
            $table->unique(['class_id', 'stream_id', 'subject_id', 'term_id'], 'uq_allocation');
        });

        Schema::table('timetable_entries', function (Blueprint $table) {
            $table->foreignId('stream_id')->nullable()->constrained('streams')->cascadeOnUpdate()->nullOnDelete();
        });
    }
};
