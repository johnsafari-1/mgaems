<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds fields identified as needed for the Academic Structure frontend:
 * class capacity, class teacher assignment, subject CBC learning area,
 * and subject active/inactive status.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('classes', function (Blueprint $table) {
            $table->unsignedSmallInteger('capacity')->nullable()->after('sequence');
            $table->foreignId('class_teacher_id')->nullable()->after('capacity')
                ->constrained('staff')->cascadeOnUpdate()->nullOnDelete();
        });

        Schema::table('subjects', function (Blueprint $table) {
            $table->string('learning_area', 80)->nullable()->after('code');
            $table->enum('status', ['active', 'inactive'])->default('active')->after('learning_area');
        });
    }

    public function down(): void
    {
        Schema::table('classes', function (Blueprint $table) {
            $table->dropForeign(['class_teacher_id']);
            $table->dropColumn(['capacity', 'class_teacher_id']);
        });
        Schema::table('subjects', function (Blueprint $table) {
            $table->dropColumn(['learning_area', 'status']);
        });
    }
};
