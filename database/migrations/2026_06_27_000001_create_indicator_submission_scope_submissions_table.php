<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('indicator_submission_scope_submissions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('indicator_submission_id')
                ->constrained()
                ->cascadeOnDelete();
            $table->string('scope_id');
            $table->string('scope_type');
            $table->foreignId('submitted_by')
                ->nullable()
                ->constrained('users')
                ->nullOnDelete();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamps();

            $table->unique(['indicator_submission_id', 'scope_id'], 'indicator_scope_submissions_submission_scope_unique');
            $table->index(['indicator_submission_id', 'scope_type'], 'indicator_scope_submissions_submission_type_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('indicator_submission_scope_submissions');
    }
};
