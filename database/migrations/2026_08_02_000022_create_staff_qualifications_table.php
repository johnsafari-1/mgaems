<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_qualifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnUpdate()->cascadeOnDelete();
            $table->string('qualification', 150);
            $table->string('institution', 150)->nullable();
            $table->year('year_obtained')->nullable();

            $table->index('staff_id', 'idx_qual_staff');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_qualifications');
    }
};
