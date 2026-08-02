<?php

use App\Http\Controllers\Api\AcademicStructureController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes — v1
|--------------------------------------------------------------------------
| Mirrors docs/MGAEMS_APIDesign.docx. Each module's routes are added here
| as it is built, per docs/MGAEMS_DevelopmentRoadmap.docx.
*/

Route::prefix('v1')->group(function () {

    // --- Authentication (SRS §3.1, API Design §2) ---
    Route::post('/auth/login', [AuthController::class, 'login']);

    // --- Password Recovery (SRS FR-AUTH-03, UC-AUTH-02) ---
    // Throttled to slow down enumeration/abuse of a public, unauthenticated endpoint.
    Route::middleware('throttle:6,1')->group(function () {
        Route::post('/auth/password/forgot', [PasswordResetController::class, 'forgot']);
        Route::post('/auth/password/reset', [PasswordResetController::class, 'reset']);
    });

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/me', [AuthController::class, 'me']);

        // --- User Management (SRS FR-ADM-03, API Design §2) ---
        // Gated server-side by role, per FR-AUTH-04 — not just hidden in the UI.
        Route::middleware('role:system_admin')->group(function () {
            Route::get('/users', [UserController::class, 'index']);
            Route::post('/users', [UserController::class, 'store']);
            Route::get('/users/{user}', [UserController::class, 'show']);
            Route::patch('/users/{user}', [UserController::class, 'update']);
            Route::delete('/users/{user}', [UserController::class, 'destroy']);
        });

        // --- Audit Logs (SRS FR-AUTH-07, UC-AUTH-05) ---
        // User Role Matrix: System Administrator (Full), Head Teacher (Read).
        Route::middleware('role:system_admin,head_teacher')->group(function () {
            Route::get('/audit-logs', [AuditLogController::class, 'index']);
        });

        // --- Academic Management: Classes, Streams, Subjects (SRS FR-ACAD-02/03) ---
        // Read: broad (staff, teachers, parents, students per User Role Matrix §4).
        Route::get('/classes', [AcademicStructureController::class, 'indexClasses']);
        Route::get('/streams', [AcademicStructureController::class, 'indexStreams']);
        Route::get('/subjects', [AcademicStructureController::class, 'indexSubjects']);

        // Write: system_admin, head_teacher (Full); deputy_head_teacher (Manage).
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher')->group(function () {
            Route::post('/classes', [AcademicStructureController::class, 'storeClass']);
            Route::patch('/classes/{class}', [AcademicStructureController::class, 'updateClass']);
            Route::delete('/classes/{class}', [AcademicStructureController::class, 'destroyClass']);

            Route::post('/streams', [AcademicStructureController::class, 'storeStream']);
            Route::delete('/streams/{stream}', [AcademicStructureController::class, 'destroyStream']);

            Route::post('/subjects', [AcademicStructureController::class, 'storeSubject']);
            Route::delete('/subjects/{subject}', [AcademicStructureController::class, 'destroySubject']);
            Route::post('/class-subjects', [AcademicStructureController::class, 'attachSubjectToClass']);
        });

        // Remaining modules (Student, Assessment, Attendance, HR,
        // Sponsorship, Communication, Visitor, Reporting, Administration)
        // are added in subsequent phases per the Development Roadmap.
    });
});
