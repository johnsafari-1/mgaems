<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Health instants use UTC DATETIME(6), without MySQL session-timezone conversion or the TIMESTAMP 2038 limit.
        // New records only. Legacy student_medical_info is deliberately untouched.
        Schema::create('learner_health_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_id')->unique()->constrained('students')->restrictOnDelete();
            $table->string('allergy_information_state', 20)->default('unknown');
            $table->text('allergy_information')->nullable();
            $table->text('emergency_information')->nullable();
            $table->text('support_information')->nullable();
            $table->string('source', 40);
            $table->string('source_reference', 200)->nullable();
            $table->foreignId('recorded_by')->constrained('users')->restrictOnDelete();
            $table->dateTime('recorded_at', 6);
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('reviewed_at', 6)->nullable();
            $table->unsignedInteger('revision_number')->default(0);
            $table->dateTime('created_at', 6)->nullable();
            $table->dateTime('updated_at', 6)->nullable();
        });
        Schema::create('health_safety_alerts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('profile_id')->constrained('learner_health_profiles')->restrictOnDelete();
            $table->string('alert_type', 30);
            $table->text('description');
            $table->text('emergency_instructions')->nullable();
            $table->boolean('is_active')->default(true);
            $table->string('source', 40);
            $table->string('source_reference', 200)->nullable();
            $table->date('starts_on');
            $table->date('ends_on')->nullable();
            $table->foreignId('verified_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->dateTime('verified_at', 6)->nullable();
            $table->string('verification_basis', 200)->nullable();
            $table->uuid('request_id')->unique();
            $table->char('request_hash', 64);
            $table->unsignedInteger('revision_number')->default(0);
            $table->dateTime('created_at', 6)->nullable();
            $table->dateTime('updated_at', 6)->nullable();
            $table->index(['profile_id', 'is_active', 'starts_on'], 'idx_health_alert_active');
        });
        Schema::create('school_health_incidents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_id')->constrained('students')->restrictOnDelete();
            $table->dateTime('occurred_at', 6);
            $table->dateTime('recorded_at', 6);
            $table->string('location', 120);
            $table->string('category', 30);
            $table->text('observations');
            $table->string('information_basis', 20);
            $table->foreignId('recorded_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('historical_class_id')->nullable()->constrained('classes')->restrictOnDelete();
            $table->foreignId('historical_term_id')->nullable()->constrained('terms')->restrictOnDelete();
            $table->json('context_snapshot')->nullable();
            $table->string('status', 20)->default('open');
            $table->string('disposition', 30)->default('none');
            $table->uuid('request_id')->unique();
            $table->char('request_hash', 64);
            $table->unsignedInteger('revision_number')->default(0);
            $table->dateTime('created_at', 6)->nullable();
            $table->dateTime('updated_at', 6)->nullable();
            $table->index(['student_id', 'occurred_at'], 'idx_health_incident_learner');
        });
        foreach (['health_incident_actions', 'health_guardian_notifications', 'health_external_referrals'] as $name) {
            Schema::create($name, function (Blueprint $table) use ($name) {
                $table->id();
                $table->foreignId('incident_id')->constrained('school_health_incidents')->restrictOnDelete();
                $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
                $table->dateTime('recorded_at', 6);
                $table->uuid('request_id')->unique();
                $table->char('request_hash', 64);
                $table->unsignedInteger('revision_number')->default(0);
                if ($name === 'health_incident_actions') {
                    $table->string('action_type', 30);
                    $table->dateTime('action_at', 6);
                    $table->text('action');
                    $table->text('result')->nullable();
                    $table->string('status_after', 20)->nullable();
                    $table->string('disposition_after', 30)->nullable();
                } elseif ($name === 'health_guardian_notifications') {
                    // Existing Guardian unlinking stays available; known contact
                    // facts and the original ID remain in the protected snapshot.
                    $table->foreignId('guardian_id')->nullable()->constrained('guardians')->nullOnDelete();
                    $table->string('channel', 20);
                    $table->dateTime('attempted_at', 6);
                    $table->string('outcome', 30);
                    $table->json('contact_snapshot')->nullable();
                } else {
                    $table->dateTime('referred_at', 6);
                    $table->text('reason');
                    $table->string('destination', 200)->nullable();
                    $table->text('authorization_details')->nullable();
                    $table->text('handover_details')->nullable();
                    $table->string('follow_up_status', 30);
                }
                $table->dateTime('created_at', 6)->nullable();
                $table->dateTime('updated_at', 6)->nullable();
                $table->index(['incident_id', 'recorded_at']);
            });
        }
        Schema::create('health_record_revisions', function (Blueprint $table) {
            $table->id();
            $table->string('record_type', 20);
            $table->unsignedBigInteger('record_id');
            $table->unsignedInteger('revision_number');
            $table->json('snapshot');
            $table->string('change_type', 30);
            $table->text('correction_reason')->nullable();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->dateTime('recorded_at', 6);
            $table->unique(['record_type', 'record_id', 'revision_number'], 'uq_health_record_revision');
        });
        Schema::create('health_access_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('operation', 40);
            $table->string('record_type', 20);
            $table->unsignedBigInteger('record_id')->nullable();
            $table->dateTime('recorded_at', 6);
            $table->index('recorded_at');
        });
    }

    public function down(): void
    {
        throw new RuntimeException('Health records and access history are forward-only; rollback would discard protected history.');
    }
};
