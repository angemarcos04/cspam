<?php

namespace App\Support\FmQad;

use App\Models\FmQadTemplateVersion;
use App\Models\FmQadTemplateVersionBlob;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class FmQadTemplateStorage
{
    public function put(FmQadTemplateVersion $version, string $content, string $sha256): FmQadTemplateVersionBlob
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(
                <<<'SQL'
                insert into fm_qad_template_version_blobs
                    (fm_qad_template_version_id, content, content_sha256, created_at, updated_at)
                values (?, decode(?, 'hex'), ?, ?, ?)
                on conflict (fm_qad_template_version_id)
                do update set content = excluded.content, content_sha256 = excluded.content_sha256, updated_at = excluded.updated_at
                SQL,
                [$version->id, bin2hex($content), $sha256, now(), now()],
            );

            return FmQadTemplateVersionBlob::query()->where('fm_qad_template_version_id', $version->id)->firstOrFail();
        }

        return FmQadTemplateVersionBlob::query()->updateOrCreate(
            ['fm_qad_template_version_id' => $version->id],
            ['content' => $content, 'content_sha256' => $sha256],
        );
    }

    public function content(FmQadTemplateVersion $version): string
    {
        $blob = $version->relationLoaded('blob') ? $version->blob : $version->blob()->first();
        if (! $blob) {
            throw new RuntimeException('The template file is not available.');
        }
        $content = $blob->content;
        if (is_resource($content)) {
            $value = stream_get_contents($content);
            return $value === false ? '' : $value;
        }
        return is_string($content) ? $content : (string) $content;
    }
}
