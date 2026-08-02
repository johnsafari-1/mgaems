<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('students', function (Blueprint $table) {
            $table->id();
            $table->string('admission_no', 20)->unique();
            $table->string('first_name', 80);
            $table->string('last_name', 80);
            $table->date('date_of_birth');
            $table->enum('gender', ['male', 'female']);
            $table->foreignId('class_id')->constrained('classes')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('stream_id')->nullable()->constrained('streams')->cascadeOnUpdate()->nullOnDelete();
            $table->string('photo_path')->nullable();
            $table->enum('status', ['active', 'promoted', 'transferred', 'left'])->default('active');
            $table->date('admission_date');
            $table->timestamps();

            $table->index(['class_id', 'stream_id'], 'idx_students_class');
            $table->index('status', 'idx_students_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('students');
    }
};
