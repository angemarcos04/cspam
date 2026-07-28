<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FmQadTemplateVersionBlob extends Model
{
    protected $fillable = ['fm_qad_template_version_id', 'content', 'content_sha256'];
    public function version(): BelongsTo { return $this->belongsTo(FmQadTemplateVersion::class, 'fm_qad_template_version_id'); }
}
