<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fm_qad_forms', function (Blueprint $table): void {
            $table->id();
            $table->string('scope_id', 64)->unique();
            $table->string('code', 32)->unique();
            $table->string('name');
            $table->text('description')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_enabled')->default(true);
            $table->timestamps();
        });

        Schema::create('fm_qad_template_versions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('fm_qad_form_id')->constrained('fm_qad_forms')->cascadeOnDelete();
            $table->foreignId('academic_year_id')->nullable()->constrained('academic_years')->nullOnDelete();
            $table->string('revision_label', 50);
            $table->string('normalized_revision_label', 50);
            $table->string('status', 16)->default('draft');
            $table->string('activation_key')->nullable()->unique();
            $table->string('original_filename');
            $table->string('mime_type', 127);
            $table->unsignedBigInteger('size_bytes');
            $table->string('sha256_hash', 64);
            $table->text('change_notes');
            $table->text('internal_note')->nullable();
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('activated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('activated_at')->nullable();
            $table->foreignId('archived_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->unique(['fm_qad_form_id', 'normalized_revision_label'], 'fm_qad_version_form_revision_unique');
            $table->unique(['fm_qad_form_id', 'sha256_hash'], 'fm_qad_version_form_hash_unique');
            $table->index(['fm_qad_form_id', 'academic_year_id', 'status'], 'fm_qad_version_effective_index');
            $table->index('created_at');
        });

        Schema::create('fm_qad_template_version_blobs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('fm_qad_template_version_id')->unique()->constrained('fm_qad_template_versions')->cascadeOnDelete();
            $table->binary('content');
            $table->string('content_sha256', 64);
            $table->timestamps();
        });

        Schema::table('indicator_submission_files', function (Blueprint $table): void {
            $table->foreignId('fm_qad_template_version_id')
                ->nullable()
                ->after('type')
                ->constrained('fm_qad_template_versions')
                ->nullOnDelete();
            $table->index('fm_qad_template_version_id', 'indicator_submission_files_fm_qad_version_index');
        });
    }

    public function down(): void
    {
        Schema::table('indicator_submission_files', function (Blueprint $table): void {
            $table->dropForeign(['fm_qad_template_version_id']);
            $table->dropIndex('indicator_submission_files_fm_qad_version_index');
            $table->dropColumn('fm_qad_template_version_id');
        });
        Schema::dropIfExists('fm_qad_template_version_blobs');
        Schema::dropIfExists('fm_qad_template_versions');
        Schema::dropIfExists('fm_qad_forms');
    }
};
