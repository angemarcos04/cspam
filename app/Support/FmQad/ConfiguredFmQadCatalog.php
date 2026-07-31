<?php

namespace App\Support\FmQad;

use App\Models\FmQadForm;
use App\Models\FmQadTemplateVersion;
use Illuminate\Support\Collection;

class ConfiguredFmQadCatalog
{
    /** @return Collection<int, string> */
    public function scopeIds(): Collection
    {
        return collect(config('fm_qad.forms', []))
            ->pluck('scope_id')
            ->filter(fn ($scopeId): bool => is_string($scopeId) && $scopeId !== '')
            ->values();
    }

    public function ensureForm(FmQadForm $form): void
    {
        abort_unless($this->scopeIds()->contains($form->scope_id), 404);
    }

    public function ensureVersion(FmQadTemplateVersion $version): void
    {
        $version->loadMissing('form');
        abort_unless($version->form, 404);
        $this->ensureForm($version->form);
    }
}
