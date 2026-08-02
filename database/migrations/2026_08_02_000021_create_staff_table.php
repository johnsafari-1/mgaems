<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-HR-01/02/07 and UC-HR-01. Covers both teaching staff (Head
 * Teacher, Deputy, Class/Subject Teachers) and non-teaching staff
 * (Secretary, ICT Officer, Librarian, Accountant, Nurse, Storekeeper,
 * Kitchen Staff, Security, Cleaners, Groundskeepers, Maintenance) via
 * staff_type + a free-text role_title, per the development instructions.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->unique()->constrained('users')->cascadeOnUpdate()->nullOnDelete();
            $table->foreignId('department_id')->nullable()->constrained('departments')->cascadeOnUpdate()->nullOnDelete();
            $table->enum('staff_type', ['teaching', 'non_teaching']);
            $table->string('role_title', 60);
            $table->string('first_name', 80);
            $table->string('last_name', 80);
            $table->string('phone', 20)->nullable();
            $table->date('employment_date');
            $table->string('contract_type', 40)->nullable();
            $table->enum('status', ['active', 'on_leave', 'terminated'])->default('active');
            $table->timestamps();

            $table->index('staff_type', 'idx_staff_type');
            $table->index('department_id', 'idx_staff_department');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff');
    }
};
