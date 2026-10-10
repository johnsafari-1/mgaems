<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\HealthRecord;
use App\Models\User;
use App\Services\HealthAudit;
use App\Services\HealthHistory;
use App\Services\HealthInput;
use App\Services\HealthOperations;
use App\Services\HealthView;
use Illuminate\Http\Request;

abstract class HealthController extends Controller
{
    protected function run(Request $request, callable $operation, string $mode = 'manage')
    {
        return (new HealthOperations)->run($request, $operation, $mode);
    }

    protected function audit(User $actor, string $operation, string $type, ?int $id = null): void
    {
        app(HealthAudit::class)->log($actor, $operation, $type, $id);
    }

    protected function record(HealthRecord $record, int $status = 200, ?string $operation = null)
    {
        $body = ['data' => (new HealthView)->record($record)];
        if ($operation) {
            $body['meta'] = ['operation' => $operation];
        }

        return response()->json($body, $status);
    }

    protected function listing(Request $request, $query)
    {
        $filters = $request->validate((new HealthInput)->page());
        $rows = $query->orderByDesc('id')->paginate($filters['per_page'] ?? 25);

        return response()->json(['data' => $rows->getCollection()->map(fn ($record) => (new HealthView)->record($record, true)),
            'meta' => ['page' => $rows->currentPage(), 'per_page' => $rows->perPage(), 'total' => $rows->total()]]);
    }

    protected function history(Request $request, HealthRecord $record, User $actor)
    {
        $filters = $request->validate((new HealthInput)->page());
        $rows = $record->revisions()->orderByDesc('revision_number')->paginate($filters['per_page'] ?? 25);
        $this->audit($actor, 'read_history', $record::TYPE, $record->id);

        return response()->json(['data' => $rows->getCollection()->map(fn ($row) => [
            'revision_number' => $row->revision_number, 'snapshot' => $row->snapshot, 'change_type' => $row->change_type,
            'correction_reason' => $row->correction_reason, 'actor_id' => $row->actor_id, 'recorded_at' => $row->recorded_at->toISOString(),
        ]), 'meta' => ['page' => $rows->currentPage(), 'per_page' => $rows->perPage(), 'total' => $rows->total()]]);
    }

    protected function correction(Request $request, HealthRecord $record): array
    {
        $input = $request->validate((new HealthInput)->correction());
        (new HealthHistory)->expect($record, $input['expected_revision']);

        return $input;
    }

    protected function hash(array $data): string
    {
        ksort($data);

        return hash_hmac('sha256', json_encode($data, JSON_THROW_ON_ERROR), config('app.key'));
    }
}
