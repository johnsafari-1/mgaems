<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-COM-01/03 and UC-COM-01.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('announcements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('published_by')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('title', 200);
            $table->text('body');
            $table->enum('audience', ['school_wide', 'class', 'parents', 'sponsors', 'staff']);
            $table->timestamp('published_at')->useCurrent();

            $table->index('audience', 'idx_announce_audience');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('announcements');
    }
};
