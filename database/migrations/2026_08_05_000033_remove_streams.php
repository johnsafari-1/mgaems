<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * Manna Goodnews Academy does not use streams — removes the streams
 * table and every stream_id reference.
 *
 * Written defensively (hasColumn/try-catch checks) because MySQL DDL is
 * not transactional: an earlier failed attempt at this migration may
 * have partially applied before erroring, leaving some columns/FKs
 * already gone even though Laravel's migrations table doesn't record
 * it as complete. This version is safe to run from any partial state.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->dropStreamColumn('students', 'idx_students_class', ['class_id']);
        $this->dropStreamColumnWithUniqueRebuild(
            'class_subject_teacher',
            'uq_allocation',
            ['class_id', 'subject_id', 'term_id']
        );
        $this->dropStreamColumn('timetable_entries', null, null);

        Schema::dropIfExists('streams');
    }

    public function down(): void
    {
        // Intentionally not reversible — restore from a backup if the
        // previous stream architecture is ever needed again.
    }

    private function hasForeignKey(string $table, string $column): bool
    {
        $constraintName = "{$table}_{$column}_foreign";
        $result = DB::select(
            "SELECT COUNT(*) as cnt FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE()
             AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?",
            [$table, $constraintName]
        );

        return $result[0]->cnt > 0;
    }

    private function dropStreamColumn(string $table, ?string $rebuildIndexName, ?array $rebuildIndexColumns): void
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'stream_id')) {
            return;
        }

        if ($this->hasForeignKey($table, 'stream_id')) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropForeign(['stream_id']);
            });
        }

        Schema::table($table, function (Blueprint $t) {
            $t->dropColumn('stream_id');
        });

        if ($rebuildIndexName && $rebuildIndexColumns) {
            $indexExists = DB::select(
                "SELECT COUNT(*) as cnt FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
                [$table, $rebuildIndexName]
            )[0]->cnt > 0;

            if (! $indexExists) {
                Schema::table($table, function (Blueprint $t) use ($rebuildIndexColumns, $rebuildIndexName) {
                    $t->index($rebuildIndexColumns, $rebuildIndexName);
                });
            }
        }
    }

    private function dropStreamColumnWithUniqueRebuild(string $table, string $uniqueName, array $uniqueColumns): void
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'stream_id')) {
            return;
        }

        // MySQL requires every FK column to be covered by some index. The
        // old uq_allocation index (leading with class_id) is what
        // currently supports the class_id foreign key — dropping it
        // before a replacement exists fails with error 1553. So: create
        // the new index FIRST, under a distinct name, then it's always
        // safe to drop the old one.
        $newIndexName = 'uq_class_subject_term';
        $newIndexExists = DB::select(
            "SELECT COUNT(*) as cnt FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
            [$table, $newIndexName]
        )[0]->cnt > 0;

        if (! $newIndexExists) {
            Schema::table($table, function (Blueprint $t) use ($uniqueColumns, $newIndexName) {
                $t->unique($uniqueColumns, $newIndexName);
            });
        }

        if ($this->hasForeignKey($table, 'stream_id')) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropForeign(['stream_id']);
            });
        }

        $oldIndexExists = DB::select(
            "SELECT COUNT(*) as cnt FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
            [$table, $uniqueName]
        )[0]->cnt > 0;

        if ($oldIndexExists) {
            Schema::table($table, function (Blueprint $t) use ($uniqueName) {
                $t->dropUnique($uniqueName);
            });
        }

        Schema::table($table, function (Blueprint $t) {
            $t->dropColumn('stream_id');
        });
    }
};
