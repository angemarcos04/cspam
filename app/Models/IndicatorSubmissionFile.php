<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IndicatorSubmissionFile extends Model
{
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'indicator_submission_id',
        'type',
        'fm_qad_template_version_id',
        'path',
        'original_filename',
        'size_bytes',
        'uploaded_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'uploaded_at' => 'datetime',
        ];
    }

    public function submission(): BelongsTo
    {
        return $this->belongsTo(IndicatorSubmission::class, 'indicator_submission_id');
    }

    public function fmQadTemplateVersion(): BelongsTo
    {
        return $this->belongsTo(FmQadTemplateVersion::class);
    }
}
