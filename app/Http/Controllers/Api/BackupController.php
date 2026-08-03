<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Symfony\Component\Process\Process;

/**
 * Implements SRS FR-ADM-06 and UC-ADM-02.
 *
 * Uses `mysqldump` directly via Symfony Process (already a framework
 * dependency — no new package needed) rather than a backup package, to
 * keep this transparent and easy to reason about. Dumps are stored on
 * the 'private' disk, outside the web root, per FR-AUTH-11.
 *
 * Requires `mysqldump` to be reachable — either on the system PATH, or
 * pointed to explicitly via MYSQLDUMP_PATH in .env (XAMPP users:
 * MYSQLDUMP_PATH="D:\xampp\mysql\bin\mysqldump.exe").
 */
class BackupController extends Controller
{
    private function backupDir(): string
    {
        $dir = storage_path('app/private/backups');
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        return $dir;
    }

    public function index()
    {
        $dir = $this->backupDir();
        $files = collect(glob($dir.'/*.sql'))
            ->map(function ($path) {
                return [
                    'filename' => basename($path),
                    'size_bytes' => filesize($path),
                    'created_at' => date('Y-m-d H:i:s', filemtime($path)),
                ];
            })
            ->sortByDesc('created_at')
            ->values();

        return response()->json(['data' => $files]);
    }

    public function store(AuditLogger $auditLogger)
    {
        $db = config('database.connections.mysql');
        $mysqldumpPath = env('MYSQLDUMP_PATH', 'mysqldump');
        $filename = 'backup-'.now()->format('Y-m-d_H-i-s').'.sql';
        $fullPath = $this->backupDir().DIRECTORY_SEPARATOR.$filename;

        $command = [
            $mysqldumpPath,
            '--host='.$db['host'],
            '--port='.$db['port'],
            '--user='.$db['username'],
        ];
        if (! empty($db['password'])) {
            $command[] = '--password='.$db['password'];
        }
        $command[] = $db['database'];

        // On Windows, mysqldump (like many console apps) needs SystemRoot
        // in its environment to initialize Winsock for a TCP connection.
        // PHP's subprocess spawning doesn't always pass this through
        // reliably (this is what caused "Can't create TCP/IP socket
        // (10106)" when running under `php artisan serve`), so we set it
        // explicitly rather than relying on inheritance.
        $env = array_merge($_SERVER, $_ENV);
        if (! isset($env['SystemRoot']) && ! isset($env['SYSTEMROOT'])) {
            $env['SystemRoot'] = 'C:\\Windows';
        }

        $process = new Process($command, null, $env);
        $process->setTimeout(300);
        $process->run();

        if (! $process->isSuccessful()) {
            $auditLogger->log('BACKUP_FAILED', null, null, ['error' => $process->getErrorOutput()]);

            return response()->json([
                'error' => [
                    'code' => 'BACKUP_FAILED',
                    'message' => 'The backup could not be completed. Check that mysqldump is installed and reachable.',
                    'detail' => $process->getErrorOutput(),
                ],
            ], 500);
        }

        file_put_contents($fullPath, $process->getOutput());

        $auditLogger->log('BACKUP_CREATED', null, null, ['filename' => $filename, 'size_bytes' => filesize($fullPath)]);

        return response()->json([
            'data' => [
                'filename' => $filename,
                'size_bytes' => filesize($fullPath),
                'created_at' => now()->toDateTimeString(),
            ],
        ], 201);
    }

    public function download(string $filename)
    {
        $safeFilename = basename($filename);
        $fullPath = $this->backupDir().DIRECTORY_SEPARATOR.$safeFilename;

        if (! str_ends_with($safeFilename, '.sql') || ! file_exists($fullPath)) {
            return response()->json([
                'error' => ['code' => 'NOT_FOUND', 'message' => 'Backup file not found.'],
            ], 404);
        }

        return response()->download($fullPath);
    }
}
