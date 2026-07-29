<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fm_qad_template_downloads', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('fm_qad_template_version_id')->constrained('fm_qad_template_versions')->cascadeOnDelete();
            $table->foreignId('fm_qad_form_id')->constrained('fm_qad_forms')->cascadeOnDelete();
            $table->foreignId('academic_year_id')->constrained('academic_years')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained('schools')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('downloaded_at');
            $table->timestamps();

            $table->unique(
                ['school_id', 'user_id', 'academic_year_id', 'fm_qad_form_id', 'fm_qad_template_version_id'],
                'fm_qad_template_download_receipt_unique',
            );
            $table->index(
                ['school_id', 'user_id', 'academic_year_id', 'fm_qad_form_id', 'downloaded_at'],
                'fm_qad_template_download_lookup',
            );
            $table->index('fm_qad_template_version_id', 'fm_qad_template_download_version_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fm_qad_template_downloads');
    }
};
