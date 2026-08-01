<?php

use App\Http\Controllers\Api\AuthController;
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

        // Remaining modules (Student, Academic, Assessment, Attendance, HR,
        // Sponsorship, Communication, Visitor, Reporting, Administration)
        // are added in subsequent phases per the Development Roadmap.
    });
});
