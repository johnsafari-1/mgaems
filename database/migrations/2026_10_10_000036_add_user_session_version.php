<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedBigInteger('session_version')->default(0);
        });
    }

    public function down(): void
    {
        throw new RuntimeException('Session revocation is forward-only; removing the version could restore revoked sessions.');
    }
};
