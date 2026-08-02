<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('streams', function (Blueprint $table) {
            $table->id();
            $table->foreignId('class_id')->constrained('classes')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('name', 30); // e.g. 'Blue'

            $table->unique(['class_id', 'name'], 'uq_stream');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('streams');
    }
};
