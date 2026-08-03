<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-VIS-01/02/03/04 and UC-VIS-01. Covers visitors, church
 * teams, mission groups, volunteers, and donors.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('visitors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('host_staff_id')->constrained('staff')->cascadeOnUpdate()->restrictOnDelete();
            $table->string('visitor_name', 150);
            $table->enum('visitor_type', ['visitor', 'church_team', 'mission_group', 'volunteer', 'donor']);
            $table->string('purpose')->nullable();
            $table->date('visit_date');
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index('visit_date', 'idx_visitor_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('visitors');
    }
};
