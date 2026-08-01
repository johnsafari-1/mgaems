<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

/**
 * Seeds the 8 canonical roles defined in docs/MGAEMS_UserRoleMatrix.docx.
 */
class RoleSeeder extends Seeder
{
    public function run(): void
    {
        $roles = [
            Role::SYSTEM_ADMIN,
            Role::HEAD_TEACHER,
            Role::DEPUTY_HEAD_TEACHER,
            Role::SPONSOR_COORDINATOR,
            Role::TEACHER,
            Role::PARENT_GUARDIAN,
            Role::SPONSOR,
            Role::STUDENT,
        ];

        foreach ($roles as $roleName) {
            Role::firstOrCreate(['name' => $roleName]);
        }
    }
}
