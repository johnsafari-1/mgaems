<?php

namespace Database\Seeders;

use App\Models\SchoolSetting;
use Illuminate\Database\Seeder;

class SchoolSettingSeeder extends Seeder
{
    public function run(): void
    {
        SchoolSetting::updateOrCreate(
            ['id' => 1],
            [
                'school_name' => 'Manna Goodnews Academy',
                'motto' => 'Committed to Excellence',
                'vision' => 'To be a Christian institution that people look up to for spiritual help and high academic performance.',
                'mission' => 'Using the unique benefits of Christianity, we are here to serve people by presenting the truth of God with love so that lives can be changed to the glory of God and to bring excellent academic results from our learners.',
                'address' => 'Majaoni, Mombasa',
                'phone' => '0728897009',
                'email' => 'info@manna.ac.ke',
            ]
        );
    }
}
