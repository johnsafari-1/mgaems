<?php

namespace Database\Seeders;

use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Creates the first System Administrator account so someone can log in
 * and start provisioning the rest of the users (SRS FR-ADM-03, UC-AUTH-04).
 *
 * Credentials are read from environment variables so a real password is
 * never committed to source control. Set these in your local .env before
 * running `php artisan db:seed`:
 *
 *   ADMIN_USERNAME=admin
 *   ADMIN_EMAIL=admin@mgaems.example
 *   ADMIN_PASSWORD=choose-a-strong-password
 */
class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $adminRole = Role::where('name', Role::SYSTEM_ADMIN)->firstOrFail();

        $username = env('ADMIN_USERNAME', 'admin');
        $email = env('ADMIN_EMAIL', 'admin@mgaems.example');
        $password = env('ADMIN_PASSWORD');

        if (! $password) {
            $this->command?->warn(
                'ADMIN_PASSWORD not set in .env — skipping AdminUserSeeder. '.
                'Set ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD then re-run db:seed.'
            );

            return;
        }

        User::firstOrCreate(
            ['username' => $username],
            [
                'email' => $email,
                'password_hash' => Hash::make($password),
                'role_id' => $adminRole->id,
                'status' => 'active',
            ]
        );

        $this->command?->info("System Administrator account ready: {$username}");
    }
}
