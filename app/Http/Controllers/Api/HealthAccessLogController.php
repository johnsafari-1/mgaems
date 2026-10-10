<?php

namespace App\Http\Controllers\Api;

use App\Models\HealthAccessLog;
use App\Services\HealthInput;
use Illuminate\Http\Request;

class HealthAccessLogController extends HealthController
{
    public function index(Request $request)
    {
        return $this->run($request, function ($actor) use ($request) {
            $filters = $request->validate((new HealthInput)->page());
            $rows = HealthAccessLog::orderByDesc('id')->paginate($filters['per_page'] ?? 25);
            $this->audit($actor, 'read_access_log', 'access_log');

            return response()->json(['data' => $rows->getCollection()->map(fn ($log) => [
                'id' => $log->id, 'actor_id' => $log->actor_id, 'operation' => $log->operation,
                'record_type' => $log->record_type, 'record_id' => $log->record_id, 'recorded_at' => $log->recorded_at->toISOString(),
            ]), 'meta' => ['page' => $rows->currentPage(), 'per_page' => $rows->perPage(), 'total' => $rows->total()]]);
        });
    }
}
