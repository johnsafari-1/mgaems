<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\DB;

class StagingHealthController extends Controller
{
    public function __invoke()
    {
        $ready = false;
        try {
            $db = DB::connection();
            if ($db->getDriverName() === 'mysql' && $db->getDatabaseName() !== 'mgaems') {
                $db->selectOne('SELECT 1');
                $ready = $db->getSchemaBuilder()->hasTable('sessions')
                    && $db->getSchemaBuilder()->hasColumn('users', 'session_version')
                    && $db->getSchemaBuilder()->hasTable('health_access_logs');
            }
        } catch (\Throwable $exception) { /* No connection details in responses or logs. */ }
        return response()->json(['status' => $ready ? 'ready' : 'unavailable'], $ready ? 200 : 503)
            ->header('Cache-Control', 'no-store');
    }
}
