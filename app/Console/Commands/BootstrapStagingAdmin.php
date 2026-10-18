<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Models\SchoolSetting;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class BootstrapStagingAdmin extends Command
{
    protected $signature = 'staging:bootstrap-admin';
    protected $description = 'Interactively create the first administrator in a new staging database';

    public function handle(): int
    {
        $db = DB::connection();
        if (!config('staging.enabled') || !app()->environment('production') || !$this->input->isInteractive()
            || $db->getDriverName() !== 'mysql' || $db->getDatabaseName() === 'mgaems'
            || in_array($db->getConfig('host'), ['mysql', 'mgaems-mysql'], true)) {
            $this->error('Requires interactive staging mode and a separate MySQL database.'); return self::FAILURE;
        }
        try {
            if (!$db->getSchemaBuilder()->hasColumn('users', 'session_version') || !$db->getSchemaBuilder()->hasTable('health_access_logs')) {
                $this->error('Complete the reviewed fresh migrations before bootstrap.'); return self::FAILURE;
            }
            if (User::exists()) { $this->error('An account already exists. Initial bootstrap is refused.'); return self::FAILURE; }
        } catch (\Throwable $exception) {
            $this->error('Cannot verify the fresh staging database. Check its configuration.'); return self::FAILURE;
        }
        $this->line('Target database: '.$db->getDatabaseName());
        if ($this->ask('Type this database name to confirm the new staging target') !== $db->getDatabaseName()) return self::FAILURE;
        $username = trim((string) $this->ask('Administrator username'));
        $email = trim((string) $this->ask('Administrator email (use a demonstration address)'));
        $password = (string) $this->secret('Unique administrator password (16+ characters, at most 72 bytes)');
        $confirmation = (string) $this->secret('Confirm password');
        $validation = Validator::make(compact('username', 'email', 'password') + ['password_confirmation' => $confirmation], [
            'username' => ['required', 'string', 'max:100'], 'email' => ['required', 'email', 'max:150'],
            'password' => ['required', 'string', 'min:16', 'confirmed'],
        ]);
        if ($validation->fails() || strlen($password) > 72) { $this->error('Invalid identity, password length or mismatched confirmation. Nothing was created.'); return self::FAILURE; }
        $lock = false;
        try {
            $lock = (int) $db->selectOne("SELECT GET_LOCK('mgaems_staging_bootstrap', 0) AS acquired")->acquired === 1;
            if (!$lock) { $this->error('Another bootstrap is running.'); return self::FAILURE; }
            $db->transaction(function () use ($username, $email, $password) {
                if (User::exists()) throw new \RuntimeException('Bootstrap target is no longer empty.');
                (new RoleSeeder())->run();
                User::create(['username' => $username, 'email' => $email, 'password_hash' => Hash::make($password),
                    'role_id' => Role::where('name', Role::SYSTEM_ADMIN)->value('id'), 'status' => 'active']);
                // Minimal reference settings; no logo, contact or learner import.
                SchoolSetting::firstOrCreate(['id' => 1], ['school_name' => config('app.name')]);
            });
        } catch (\Throwable $exception) {
            $this->error('Bootstrap failed. No credentials are printed; inspect the target configuration.'); return self::FAILURE;
        } finally {
            if ($lock) $db->selectOne("SELECT RELEASE_LOCK('mgaems_staging_bootstrap')");
            unset($password, $confirmation);
        }
        $this->info('Initial staging administrator created. No Staff link or learner record was created.');
        return self::SUCCESS;
    }
}
