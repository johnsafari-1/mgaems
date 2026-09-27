<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Keep the newest row from every pre-existing logical duplicate set so
        // production data cannot make creation of the unique index fail.
        DB::table('assessments')
            ->select('student_id', 'subject_id', 'term_id', 'assessment_type', DB::raw('MAX(id) as keep_id'))
            ->groupBy('student_id', 'subject_id', 'term_id', 'assessment_type')
            ->havingRaw('COUNT(*) > 1')
            ->orderBy('keep_id')
            ->get()
            ->each(function ($duplicate) {
                DB::table('assessments')
                    ->where('student_id', $duplicate->student_id)
                    ->where('subject_id', $duplicate->subject_id)
                    ->where('term_id', $duplicate->term_id)
                    ->where('assessment_type', $duplicate->assessment_type)
                    ->where('id', '<>', $duplicate->keep_id)
                    ->delete();
            });

        Schema::table('assessments', function (Blueprint $table) {
            $table->unique(
                ['student_id', 'subject_id', 'term_id', 'assessment_type'],
                'uq_assessment_student_subject_term_type'
            );
        });
    }

    public function down(): void
    {
        Schema::table('assessments', function (Blueprint $table) {
            $table->dropUnique('uq_assessment_student_subject_term_type');
        });
    }
};
