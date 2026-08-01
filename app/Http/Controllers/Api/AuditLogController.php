<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\Request;

/**
 * Implements API Design §2 (GET /audit-logs) and UC-AUTH-05.
 * Route-gated to System Administrator + Head Teacher (see routes/api.php).
 */
class AuditLogController extends Controller
{
    public function index(Request $request)
    {
        $perPage = min((int) $request->query('per_page', 25), 100);

        $logs = AuditLog::with('user:id,username,email')
            ->when($request->query('user_id'), fn ($q, $id) => $q->where('user_id', $id))
            ->when($request->query('action'), fn ($q, $action) => $q->where('action', $action))
            ->when($request->query('from'), fn ($q, $from) => $q->where('created_at', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('created_at', '<=', $to))
            ->orderByDesc('created_at')
            ->paginate($perPage);

        return response()->json([
            'data' => $logs->items(),
            'meta' => [
                'page' => $logs->currentPage(),
                'per_page' => $logs->perPage(),
                'total' => $logs->total(),
            ],
        ]);
    }
}
