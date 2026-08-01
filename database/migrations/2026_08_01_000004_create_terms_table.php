<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('terms', function (Blueprint $table) {
            $table->id();
            $table->foreignId('academic_year_id')->constrained('academic_years')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('name', 20); // e.g. 'Term 1'
            $table->date('start_date');
            $table->date('end_date');
            $table->boolean('is_current')->default(false);

            $table->unique(['academic_year_id', 'name'], 'uq_term');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('terms');
    }
};
