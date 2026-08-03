<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per SRS FR-COM-02 and UC-COM-02.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sender_id')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('recipient_id')->constrained('users')->cascadeOnUpdate()->restrictOnDelete();
            $table->text('body');
            $table->timestamp('sent_at')->useCurrent();
            $table->timestamp('read_at')->nullable();

            $table->index('recipient_id', 'idx_msg_recipient');
            $table->index('sender_id', 'idx_msg_sender');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
