<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Additive only: persistent per-paper header templates and independent editable
 * exam-paper versions. Core authoring, review and export remain unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        $wanted = ['header_template', 'version_number', 'source_exam_paper_id', 'source_revision_number'];
        $missing = array_values(array_filter($wanted, fn (string $column) => ! Schema::hasColumn('exam_papers', $column)));

        if ($missing) {
            Schema::table('exam_papers', function (Blueprint $table) use ($missing) {
                if (in_array('header_template', $missing, true)) $table->string('header_template', 30)->default('classic');
                if (in_array('version_number', $missing, true)) $table->unsignedInteger('version_number')->default(1);
                if (in_array('source_exam_paper_id', $missing, true)) $table->foreignId('source_exam_paper_id')->nullable()->constrained('exam_papers')->cascadeOnUpdate()->nullOnDelete();
                if (in_array('source_revision_number', $missing, true)) $table->unsignedInteger('source_revision_number')->nullable();
            });
        }

        // One version number per source paper, so concurrent branches cannot collide.
        if (! Schema::hasIndex('exam_papers', 'uq_exam_paper_source_version')) {
            Schema::table('exam_papers', fn (Blueprint $table) => $table->unique(['source_exam_paper_id', 'version_number'], 'uq_exam_paper_source_version'));
        }
    }

    public function down(): void
    {
        if (Schema::hasIndex('exam_papers', 'uq_exam_paper_source_version')) {
            Schema::table('exam_papers', fn (Blueprint $table) => $table->dropUnique('uq_exam_paper_source_version'));
        }
        if (Schema::hasColumn('exam_papers', 'source_exam_paper_id') && Schema::getConnection()->getDriverName() === 'mysql') {
            Schema::table('exam_papers', fn (Blueprint $table) => $table->dropForeign(['source_exam_paper_id']));
        }
        $existing = array_values(array_filter(['header_template', 'version_number', 'source_exam_paper_id', 'source_revision_number'], fn (string $column) => Schema::hasColumn('exam_papers', $column)));
        if ($existing) Schema::table('exam_papers', fn (Blueprint $table) => $table->dropColumn($existing));
    }
};
