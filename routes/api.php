<?php

use App\Http\Controllers\Api\AuthController;
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

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/me', [AuthController::class, 'me']);

        // Example of an RBAC-gated route, per SRS FR-AUTH-04:
        // Route::get('/users', [UserController::class, 'index'])
        //     ->middleware('role:system_admin');

        // Remaining modules (Student, Academic, Assessment, Attendance, HR,
        // Sponsorship, Communication, Visitor, Reporting, Administration)
        // are added in subsequent phases per the Development Roadmap.
    });
});
