<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('username', 100)->unique();
            $table->string('email', 150)->unique();
            $table->string('password_hash', 255);
            $table->foreignId('role_id')->constrained('roles')->cascadeOnUpdate()->restrictOnDelete();
            $table->enum('status', ['active', 'inactive', 'locked'])->default('active');
            $table->timestamp('last_login_at')->nullable();
            $table->timestamps();

            $table->index('role_id', 'idx_users_role');
            $table->index('status', 'idx_users_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
