<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-ASM-06/07 and UC-ASM-03. One report card per student per term.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('report_cards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_id')->constrained('students')->cascadeOnUpdate()->cascadeOnDelete();
            $table->foreignId('term_id')->constrained('terms')->cascadeOnUpdate()->restrictOnDelete();
            $table->text('overall_remark')->nullable();
            $table->string('file_path')->nullable();
            $table->timestamp('generated_at')->nullable();
            $table->foreignId('generated_by')->nullable()->constrained('users')->cascadeOnUpdate()->nullOnDelete();

            $table->unique(['student_id', 'term_id'], 'uq_report_card');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_cards');
    }
};
