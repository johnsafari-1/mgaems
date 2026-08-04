<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SchoolSetting;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Implements SRS FR-ADM-05. Single-row settings — always id=1.
 */
class SchoolSettingController extends Controller
{
    public function show()
    {
        $settings = SchoolSetting::firstOrFail();

        return response()->json(['data' => $settings]);
    }

    public function update(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'school_name' => ['sometimes', 'string', 'max:150'],
            'motto' => ['nullable', 'string', 'max:150'],
            'vision' => ['nullable', 'string'],
            'mission' => ['nullable', 'string'],
            'address' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:150'],
        ]);

        $settings = SchoolSetting::firstOrFail();
        $settings->update($validated);

        $auditLogger->log('UPDATE_SCHOOL_SETTINGS', 'SchoolSetting', $settings->id, $validated);

        return response()->json(['data' => $settings->fresh()]);
    }

    public function uploadLogo(Request $request, AuditLogger $auditLogger)
    {
        $request->validate([
            'logo' => ['required', 'image', 'mimes:jpg,jpeg,png', 'max:2048'],
        ]);

        $settings = SchoolSetting::firstOrFail();

        // Remove the previous logo file, if any, before storing the new one.
        if ($settings->logo_path && Storage::disk('public')->exists($settings->logo_path)) {
            Storage::disk('public')->delete($settings->logo_path);
        }

        $path = $request->file('logo')->store('school', 'public');
        $settings->update(['logo_path' => $path]);

        $auditLogger->log('UPDATE_SCHOOL_LOGO', 'SchoolSetting', $settings->id, ['logo_path' => $path]);

        return response()->json(['data' => [
            'logo_path' => $path,
            'url' => Storage::disk('public')->url($path),
        ]]);
    }
}
