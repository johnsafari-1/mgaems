<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Supports FR-AUTH-03 (secure password recovery via a time-limited,
 * single-use token) and UC-AUTH-02.
 *
 * Tokens are stored hashed, keyed by email — matching Laravel's built-in
 * password broker conventions so we can lean on framework-tested logic
 * (Illuminate\Auth\Passwords\PasswordBroker) rather than hand-rolling
 * token generation/expiry ourselves.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email', 150)->primary();
            $table->string('token', 255);
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('password_reset_tokens');
    }
};
