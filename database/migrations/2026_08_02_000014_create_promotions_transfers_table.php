<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-STU-07/08 and UC-STU-03: an immutable historical trail of
 * class promotions and school transfers. from_class_id/to_class_id are
 * captured independently of the student's live class_id so this record
 * stays accurate even after later promotions change the student's
 * current class.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('promotions_transfers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_id')->constrained('students')->cascadeOnUpdate()->cascadeOnDelete();
            $table->enum('type', ['promotion', 'transfer_in', 'transfer_out']);
            $table->foreignId('from_class_id')->nullable()->constrained('classes')->cascadeOnUpdate()->nullOnDelete();
            $table->foreignId('to_class_id')->nullable()->constrained('classes')->cascadeOnUpdate()->nullOnDelete();
            $table->foreignId('term_id')->constrained('terms')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('reason')->nullable();
            $table->date('effective_date');
            $table->foreignId('recorded_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->index('student_id', 'idx_promo_student');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('promotions_transfers');
    }
};
