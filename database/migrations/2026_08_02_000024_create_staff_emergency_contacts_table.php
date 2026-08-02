<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_emergency_contacts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnUpdate()->cascadeOnDelete();
            $table->string('full_name', 150);
            $table->string('relationship', 30)->nullable();
            $table->string('phone', 20);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_emergency_contacts');
    }
};
