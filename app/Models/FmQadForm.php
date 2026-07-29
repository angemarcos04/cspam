<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FmQadForm extends Model
{
    protected $fillable = ['scope_id', 'code', 'name', 'description', 'sort_order', 'is_enabled'];

    protected function casts(): array
    {
        return ['sort_order' => 'integer', 'is_enabled' => 'boolean'];
    }

    public function versions(): HasMany
    {
        return $this->hasMany(FmQadTemplateVersion::class);
    }

    public function downloads(): HasMany
    {
        return $this->hasMany(FmQadTemplateDownload::class);
    }

    public function scopeEnabled(Builder $query): Builder
    {
        return $query->where('is_enabled', true);
    }
}
