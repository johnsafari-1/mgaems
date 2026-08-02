<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnUpdate()->cascadeOnDelete();
            $table->string('doc_type', 60);
            $table->string('file_path');
            $table->timestamp('uploaded_at')->useCurrent();

            $table->index('staff_id', 'idx_staffdocs_staff');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_documents');
    }
};
