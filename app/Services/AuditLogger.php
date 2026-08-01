<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Http\Request;

/**
 * Central audit logging service, per SRS FR-AUTH-07:
 * "The system shall record an audit log of significant actions
 * (logins, record creation/edit/delete, permission changes) including
 * user, timestamp, and action."
 *
 * Every module calls this the same way, so audit behavior stays
 * consistent as the system grows (see System Architecture Diagram,
 * "Cross-Cutting Services").
 *
 * Usage:
 *   app(AuditLogger::class)->log(
 *       action: 'CREATE_USER',
 *       entityType: 'User',
 *       entityId: $user->id,
 *       details: ['role' => $user->role->name],
 *   );
 */
class AuditLogger
{
    public function __construct(private Request $request)
    {
    }

    public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): AuditLog
    {
        return AuditLog::create([
            'user_id' => $this->request->user()?->id,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'details' => $details ?: null,
            'ip_address' => $this->request->ip(),
            'created_at' => now(),
        ]);
    }
}
