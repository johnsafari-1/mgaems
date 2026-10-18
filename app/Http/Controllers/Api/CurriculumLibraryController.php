<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CurriculumRecord;
use App\Models\CurriculumSource;
use App\Models\CurriculumSourceVersion;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\CurriculumAccess;
use App\Services\CurriculumLibrary;
use App\Services\CurriculumRetrieval;
use App\Services\TeachingDocumentAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class CurriculumLibraryController extends Controller
{
    public function __construct(private CurriculumAccess $access, private CurriculumLibrary $library) {}

    private function administrator(Request $request): User
    {
        $actor = $this->access->administrator($request->user());
        abort_unless($this->library->installed(), 503, 'CURRICULUM_LIBRARY_NOT_INSTALLED: the additive curriculum migration is pending installation.');

        return $actor;
    }

    public function index(Request $request)
    {
        $this->administrator($request);

        return response()->json(['data' => CurriculumSource::with('versions')->orderBy('grade')->orderBy('learning_area')->paginate(25)]);
    }

    public function store(Request $request, AuditLogger $audit)
    {
        $actor = $this->administrator($request);

        return response()->json(['data' => $this->library->register($request->all(), $actor, $audit)], 201);
    }

    public function storeVersion(Request $request, int $source, AuditLogger $audit)
    {
        $actor = $this->administrator($request);
        $source = CurriculumSource::findOrFail($source);
        $request->validate(['document' => ['required', 'file']]);

        return response()->json(['data' => $this->library->addVersion($source, $request->except('document'), $request->file('document'), $actor, $audit)], 201);
    }

    public function updateSource(Request $request, int $source, AuditLogger $audit)
    {
        $this->administrator($request);

        return response()->json(['data' => $this->library->updateSource(CurriculumSource::findOrFail($source), $request->all(), $audit)]);
    }

    public function updateVersion(Request $request, int $version, AuditLogger $audit)
    {
        $this->administrator($request);

        return response()->json(['data' => $this->library->updateVersion(CurriculumSourceVersion::findOrFail($version), $request->all(), $audit)]);
    }

    public function showVersion(Request $request, int $version)
    {
        $this->administrator($request);
        $version = CurriculumSourceVersion::findOrFail($version);

        return response()->json(['data' => ['version' => $version->load('source', 'records.outcomes')->makeVisible(['authorization_basis', 'verification_notes', 'created_by', 'reviewed_by']), 'review_content_sha256' => $this->library->contentChecksum($version)]]);
    }

    public function import(Request $request, int $version, AuditLogger $audit)
    {
        $this->administrator($request);

        return response()->json(['data' => $this->library->import(CurriculumSourceVersion::findOrFail($version), $request->all(), $audit)], 201);
    }

    public function correct(Request $request, int $version, int $record, AuditLogger $audit)
    {
        $this->administrator($request);

        return response()->json(['data' => $this->library->correct(CurriculumSourceVersion::findOrFail($version), CurriculumRecord::findOrFail($record), $request->all(), $audit)]);
    }

    public function approve(Request $request, int $version, AuditLogger $audit)
    {
        $actor = $this->administrator($request);

        return response()->json(['data' => $this->library->approve(CurriculumSourceVersion::findOrFail($version), $request->all(), $actor, $audit)]);
    }

    public function withdraw(Request $request, int $version, AuditLogger $audit)
    {
        $actor = $this->administrator($request);

        return response()->json(['data' => $this->library->withdraw(CurriculumSourceVersion::findOrFail($version), $request->all(), $actor, $audit)]);
    }

    public function document(Request $request, int $version)
    {
        $this->administrator($request);
        $version = CurriculumSourceVersion::findOrFail($version);
        abort_unless(Storage::disk('private')->exists($version->document_path), 404);

        return Storage::disk('private')->download($version->document_path, 'curriculum-source-'.$version->id.'.pdf', ['Content-Type' => 'application/pdf', 'Cache-Control' => 'private, no-store']);
    }

    public function retrieve(Request $request, TeachingDocumentAccess $access, CurriculumRetrieval $retrieval)
    {
        $user = $access->user($request->user());
        if (! $access->leader($user)) {
            $access->staff($user);
        }

        return response()->json(['data' => $retrieval->retrieve($request->all())]);
    }
}
