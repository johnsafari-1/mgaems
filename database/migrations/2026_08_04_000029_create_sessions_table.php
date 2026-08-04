<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Laravel's standard sessions table — required because config/session.php
 * uses the 'database' driver. This was never hit by our curl-based API
 * testing (pure Bearer token auth doesn't touch sessions), but Sanctum's
 * EnsureFrontendRequestsAreStateful middleware treats same-origin browser
 * requests from a "stateful" domain (127.0.0.1 is in config/sanctum.php)
 * as session-based, which surfaced the gap.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->foreignId('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sessions');
    }
};
