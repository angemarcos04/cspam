<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FmQadTemplateDownloadGrant extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['downloaded_at' => 'datetime'];
    }

    public function version(): BelongsTo
    {
        return $this->belongsTo(FmQadTemplateVersion::class, 'fm_qad_template_version_id');
    }

    public function form(): BelongsTo
    {
        return $this->belongsTo(FmQadForm::class, 'fm_qad_form_id');
    }

    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class);
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
