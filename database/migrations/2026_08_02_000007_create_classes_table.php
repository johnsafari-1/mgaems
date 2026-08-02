<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('classes', function (Blueprint $table) {
            $table->id();
            $table->string('name', 30)->unique(); // e.g. 'Grade 4'
            $table->enum('level', ['primary', 'junior']);
            $table->unsignedTinyInteger('sequence'); // ordering, e.g. 1-9
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('classes');
    }
};
