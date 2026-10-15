<?php

namespace App\Services;

use App\Models\TeachingDocumentRevision;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

class TeachingDocumentVersions
{
    /** Snapshot transitions rather than replacing the reviewed content in place. */
    public function capture(string $type, Model $document, string $event, User $actor): TeachingDocumentRevision
    {
        $snapshot = $document->attributesToArray();
        $revision = (int) TeachingDocumentRevision::where('document_type', $type)->where('document_id', $document->id)->max('revision_number') + 1;
        $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR);

        return TeachingDocumentRevision::create(['document_type' => $type, 'document_id' => $document->id,
            'revision_number' => $revision, 'event' => $event, 'status' => $document->status,
            'snapshot' => $snapshot, 'snapshot_sha256' => hash('sha256', $encoded), 'acted_by' => $actor->id, 'created_at' => now()]);
    }
}
