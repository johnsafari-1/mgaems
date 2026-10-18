<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sponsorship_student', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sponsorship_id')->constrained()->cascadeOnDelete();
            $table->foreignId('student_id')->constrained()->restrictOnDelete();
            $table->timestamps();
            $table->unique(['sponsorship_id', 'student_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sponsorship_student');
    }
};
