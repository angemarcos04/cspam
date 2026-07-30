<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class FmQadTemplateVersion extends Model
{
    public const DRAFT = 'draft';

    public const ACTIVE = 'active';

    public const ARCHIVED = 'archived';

    protected $fillable = [
        'fm_qad_form_id', 'academic_year_id', 'revision_label', 'normalized_revision_label',
        'status', 'activation_key', 'original_filename', 'mime_type', 'size_bytes',
        'sha256_hash', 'change_notes', 'internal_note', 'uploaded_by', 'activated_by',
        'activated_at', 'archived_by', 'archived_at',
    ];

    protected function casts(): array
    {
        return ['size_bytes' => 'integer', 'activated_at' => 'datetime', 'archived_at' => 'datetime'];
    }

    public function form(): BelongsTo
    {
        return $this->belongsTo(FmQadForm::class, 'fm_qad_form_id');
    }

    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class);
    }

    public function blob(): HasOne
    {
        return $this->hasOne(FmQadTemplateVersionBlob::class);
    }

    public function downloadGrants(): HasMany
    {
        return $this->hasMany(FmQadTemplateDownloadGrant::class);
    }

    public function submissionFiles(): HasMany
    {
        return $this->hasMany(IndicatorSubmissionFile::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function activator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'activated_by');
    }

    public function archiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'archived_by');
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('status', self::ACTIVE);
    }

    public function scopeDraft(Builder $query): Builder
    {
        return $query->where('status', self::DRAFT);
    }

    public function scopeArchived(Builder $query): Builder
    {
        return $query->where('status', self::ARCHIVED);
    }

    public function scopeForAcademicYear(Builder $query, ?int $id): Builder
    {
        return $id === null ? $query->whereNull('academic_year_id') : $query->where('academic_year_id', $id);
    }
}
