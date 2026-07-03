<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('indicator_submission_file_blobs', function (Blueprint $table): void {
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
    }

    public function down(): void
    {
        Schema::dropIfExists('indicator_submission_file_blobs');
    }
};
