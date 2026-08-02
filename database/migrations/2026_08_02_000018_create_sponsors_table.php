<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-SPN-01 and UC-SPN-01. sponsor_type covers individuals and
 * every institutional category the school works with.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sponsors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->unique()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->enum('sponsor_type', ['individual', 'church', 'ministry', 'ngo', 'foundation', 'general']);
            $table->string('name', 150);
            $table->string('contact_person', 150)->nullable();
            $table->string('phone', 20)->nullable();
            $table->string('email', 150)->nullable();
            $table->string('address')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index('sponsor_type', 'idx_sponsor_type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sponsors');
    }
};
