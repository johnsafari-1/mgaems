<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Department;
use App\Services\AuditLogger;
use Illuminate\Http\Request;

/**
 * Per SRS FR-ADM-02.
 */
class DepartmentController extends Controller
{
    public function index()
    {
        return response()->json(['data' => Department::orderBy('name')->get()]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:80', 'unique:departments,name'],
        ]);

        $department = Department::create($validated);
        $auditLogger->log('CREATE_DEPARTMENT', 'Department', $department->id, $validated);

        return response()->json(['data' => $department], 201);
    }
}
