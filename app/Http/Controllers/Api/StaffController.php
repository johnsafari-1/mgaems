<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-HR-01..07 and UC-HR-01/02.
 * Access restricted to System Administrator and Head Teacher per the
 * User Role Matrix (Deputy Head Teacher gets Manage — read/update, no delete).
 */
class StaffController extends Controller
{
    public function index(Request $request)
    {
        $staff = Staff::with('department')
            ->when($request->query('staff_type'), fn ($q, $t) => $q->where('staff_type', $t))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->query('search'), fn ($q, $s) => $q->where(function ($q2) use ($s) {
                $q2->where('first_name', 'like', "%{$s}%")->orWhere('last_name', 'like', "%{$s}%");
            }))
            ->orderBy('last_name')
            ->get();

        return response()->json(['data' => $staff]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'user_id' => ['nullable', 'exists:users,id', 'unique:staff,user_id'],
            'department_id' => ['nullable', 'exists:departments,id'],
            'staff_type' => ['required', Rule::in(['teaching', 'non_teaching'])],
            'role_title' => ['required', 'string', 'max:60'],
            'first_name' => ['required', 'string', 'max:80'],
            'last_name' => ['required', 'string', 'max:80'],
            'phone' => ['nullable', 'string', 'max:20'],
            'employment_date' => ['required', 'date'],
            'contract_type' => ['nullable', 'string', 'max:40'],

            'qualifications' => ['sometimes', 'array'],
            'qualifications.*.qualification' => ['required_with:qualifications', 'string', 'max:150'],
            'qualifications.*.institution' => ['nullable', 'string', 'max:150'],
            'qualifications.*.year_obtained' => ['nullable', 'digits:4'],

            'emergency_contacts' => ['sometimes', 'array'],
            'emergency_contacts.*.full_name' => ['required_with:emergency_contacts', 'string', 'max:150'],
            'emergency_contacts.*.relationship' => ['nullable', 'string', 'max:30'],
            'emergency_contacts.*.phone' => ['required_with:emergency_contacts', 'string', 'max:20'],
        ]);

        $staff = DB::transaction(function () use ($validated) {
            $staff = Staff::create($validated + ['status' => 'active']);

            foreach ($validated['qualifications'] ?? [] as $q) {
                $staff->qualifications()->create($q);
            }
            foreach ($validated['emergency_contacts'] ?? [] as $c) {
                $staff->emergencyContacts()->create($c);
            }

            return $staff;
        });

        $auditLogger->log('CREATE_STAFF', 'Staff', $staff->id, ['name' => "{$staff->first_name} {$staff->last_name}"]);

        return response()->json(['data' => $staff->load('qualifications', 'emergencyContacts', 'department')], 201);
    }

    public function show(Staff $staff)
    {
        return response()->json(['data' => $staff->load('qualifications', 'documents', 'emergencyContacts', 'department')]);
    }

    public function update(Request $request, Staff $staff, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'department_id' => ['nullable', 'exists:departments,id'],
            'role_title' => ['sometimes', 'string', 'max:60'],
            'phone' => ['nullable', 'string', 'max:20'],
            'contract_type' => ['nullable', 'string', 'max:40'],
            'status' => ['sometimes', Rule::in(['active', 'on_leave', 'terminated'])],
        ]);

        $staff->update($validated);
        $auditLogger->log('UPDATE_STAFF', 'Staff', $staff->id, $validated);

        return response()->json(['data' => $staff->fresh(['department'])]);
    }
}
