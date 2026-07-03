<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IndicatorSubmissionFileBlob extends Model
{
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'indicator_submission_id',
        'type',
        'original_filename',
        'mime_type',
        'size_bytes',
        'sha256',
        'content',
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
}
