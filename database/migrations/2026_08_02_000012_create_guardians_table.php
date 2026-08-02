<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guardians', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_id')->constrained('students')->cascadeOnUpdate()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->string('full_name', 150);
            $table->string('relationship', 30);
            $table->string('phone', 20);
            $table->string('email', 150)->nullable();
            $table->string('address')->nullable();
            $table->boolean('is_primary_contact')->default(false);

            $table->index('student_id', 'idx_guardians_student');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('guardians');
    }
};
