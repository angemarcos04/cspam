<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const TABLE = 'indicator_submission_file_blobs';

    public function up(): void
    {
        if (! Schema::hasTable(self::TABLE)) {
            Schema::create(self::TABLE, function (Blueprint $table): void {
                $table->id();
                $table->foreignId('indicator_submission_id')
                    ->constrained('indicator_submissions')
                    ->cascadeOnDelete();
                $table->string('type', 64);
                $table->string('original_filename')->nullable();
                $table->string('mime_type', 120)->nullable();
                $table->unsignedBigInteger('size_bytes')->default(0);
                $table->string('sha256', 64)->nullable();
                $table->binary('content');
                $table->timestamp('uploaded_at')->nullable();
                $table->timestamps();

                $table->unique(
                    ['indicator_submission_id', 'type'],
                    'indicator_submission_file_blobs_submission_type_unique',
                );
                $table->index('type', 'indicator_submission_file_blobs_type_index');
            });

            return;
        }

        $this->repairMissingColumns();
        $this->ensurePostgresContentColumnIsBytea();
        $this->ensureIndexes();
    }

    public function down(): void
    {
        // This migration is an additive production repair. Do not drop columns or data on rollback.
    }

    private function repairMissingColumns(): void
    {
        if (! Schema::hasColumn(self::TABLE, 'id')) {
            if ($this->rowCount() > 0) {
                throw new RuntimeException('Cannot add indicator_submission_file_blobs.id automatically while rows exist.');
            }

            Schema::table(self::TABLE, function (Blueprint $table): void {
                $table->id();
            });
        }

        Schema::table(self::TABLE, function (Blueprint $table): void {
            if (! Schema::hasColumn(self::TABLE, 'indicator_submission_id')) {
                $table->foreignId('indicator_submission_id')->nullable();
            }

            if (! Schema::hasColumn(self::TABLE, 'type')) {
                $table->string('type', 64)->nullable();
            }

            if (! Schema::hasColumn(self::TABLE, 'original_filename')) {
                $table->string('original_filename')->nullable();
            }

            if (! Schema::hasColumn(self::TABLE, 'mime_type')) {
                $table->string('mime_type', 120)->nullable();
            }

            if (! Schema::hasColumn(self::TABLE, 'size_bytes')) {
                $table->unsignedBigInteger('size_bytes')->default(0);
            }

            if (! Schema::hasColumn(self::TABLE, 'sha256')) {
                $table->string('sha256', 64)->nullable();
            }

            if (! Schema::hasColumn(self::TABLE, 'content')) {
                $table->binary('content')->nullable();
            }

            if (! Schema::hasColumn(self::TABLE, 'uploaded_at')) {
                $table->timestamp('uploaded_at')->nullable();
            }

            if (! Schema::hasColumn(self::TABLE, 'created_at')) {
                $table->timestamp('created_at')->nullable();
            }

            if (! Schema::hasColumn(self::TABLE, 'updated_at')) {
                $table->timestamp('updated_at')->nullable();
            }
        });
    }

    private function ensurePostgresContentColumnIsBytea(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql' || ! Schema::hasColumn(self::TABLE, 'content')) {
            return;
        }

        $type = $this->postgresColumnType('content');
        if ($type === null || $type === 'bytea') {
            return;
        }

        if ($this->rowCount() > 0) {
            throw new RuntimeException(
                'indicator_submission_file_blobs.content is not bytea and rows exist. Manual data-preserving repair is required.',
            );
        }

        DB::statement('alter table ' . self::TABLE . ' drop column content');
        Schema::table(self::TABLE, function (Blueprint $table): void {
            $table->binary('content')->nullable();
        });
    }

    private function ensureIndexes(): void
    {
        if (! Schema::hasColumn(self::TABLE, 'indicator_submission_id') || ! Schema::hasColumn(self::TABLE, 'type')) {
            return;
        }

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql' || $driver === 'sqlite') {
            DB::statement(
                'create unique index if not exists indicator_submission_file_blobs_submission_type_unique '
                . 'on ' . self::TABLE . ' (indicator_submission_id, type)',
            );
            DB::statement(
                'create index if not exists indicator_submission_file_blobs_type_index '
                . 'on ' . self::TABLE . ' (type)',
            );

            return;
        }

        try {
            Schema::table(self::TABLE, function (Blueprint $table): void {
                $table->unique(
                    ['indicator_submission_id', 'type'],
                    'indicator_submission_file_blobs_submission_type_unique',
                );
            });
        } catch (Throwable) {
            // Index may already exist on drivers without CREATE INDEX IF NOT EXISTS support.
        }

        try {
            Schema::table(self::TABLE, function (Blueprint $table): void {
                $table->index('type', 'indicator_submission_file_blobs_type_index');
            });
        } catch (Throwable) {
            // Index may already exist on drivers without CREATE INDEX IF NOT EXISTS support.
        }
    }

    private function rowCount(): int
    {
        return (int) DB::table(self::TABLE)->count();
    }

    private function postgresColumnType(string $column): ?string
    {
        $row = DB::selectOne(
            <<<'SQL'
            select data_type
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = ?
              and column_name = ?
            limit 1
            SQL,
            [self::TABLE, $column],
        );

        $type = is_object($row) && isset($row->data_type) ? trim((string) $row->data_type) : '';

        return $type !== '' ? strtolower($type) : null;
    }
};
