<?php

namespace App\Services;

use App\Models\SchoolSetting;
use Illuminate\Support\Facades\Storage;

/** Builds a bounded, self-contained school identity for server-side exports. */
class SchoolExportIdentity
{
    public function current(): array
    {
        $identity = ['name' => 'MGAEMS', 'motto' => null, 'logo_data_uri' => null];

        try {
            $settings = SchoolSetting::query()->first();
            if (! $settings) return $identity;
            $identity['name'] = $settings->school_name ?: $identity['name'];
            $identity['motto'] = $settings->motto;

            // Only embed the existing, validated local school-logo upload in PDFs.
            if (! $settings->logo_path || ! preg_match('~^school/[A-Za-z0-9._-]+\.(png|jpe?g)$~i', $settings->logo_path)) return $identity;
            $disk = Storage::disk('public');
            if (! $disk->exists($settings->logo_path) || $disk->size($settings->logo_path) > 262144) return $identity;
            $bytes = $disk->get($settings->logo_path); $info = @getimagesizefromstring($bytes);
            if (! $info || $info[0] > 2048 || $info[1] > 2048 || ! in_array($info['mime'], ['image/png', 'image/jpeg'], true)) return $identity;
            $identity['logo_data_uri'] = 'data:'.$info['mime'].';base64,'.base64_encode($bytes);
        } catch (\Throwable) {
            // Export content remains available if settings or storage are unavailable.
        }

        return $identity;
    }
}
