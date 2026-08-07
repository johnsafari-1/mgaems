<?php

use App\Http\Controllers\Api\AcademicCalendarController;
use App\Http\Controllers\Api\AcademicStructureController;
use App\Http\Controllers\Api\AnnouncementController;
use App\Http\Controllers\Api\AssessmentController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\DepartmentController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\ParentPortalController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\ReportCardController;
use App\Http\Controllers\Api\ReportingController;
use App\Http\Controllers\Api\SchoolSettingController;
use App\Http\Controllers\Api\SponsorController;
use App\Http\Controllers\Api\SponsorPortalController;
use App\Http\Controllers\Api\SponsorshipController;
use App\Http\Controllers\Api\StaffController;
use App\Http\Controllers\Api\StudentController;
use App\Http\Controllers\Api\TeacherAssignmentController;
use App\Http\Controllers\Api\TimetableController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VisitorController;
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

        // --- Academic Calendar: Years & Terms (SRS FR-ACAD-01) ---
        Route::get('/academic-years', [AcademicCalendarController::class, 'indexYears']);
        Route::get('/terms', [AcademicCalendarController::class, 'indexTerms']);

        Route::middleware('role:system_admin,head_teacher')->group(function () {
            Route::post('/academic-years', [AcademicCalendarController::class, 'storeYear']);
            Route::patch('/academic-years/{academicYear}', [AcademicCalendarController::class, 'updateYear']);
            Route::post('/academic-years/{academicYear}/activate', [AcademicCalendarController::class, 'activateYear']);
            Route::delete('/academic-years/{academicYear}', [AcademicCalendarController::class, 'destroyYear']);

            Route::post('/terms', [AcademicCalendarController::class, 'storeTerm']);
            Route::patch('/terms/{term}', [AcademicCalendarController::class, 'updateTerm']);
            Route::post('/terms/{term}/activate', [AcademicCalendarController::class, 'activateTerm']);
            Route::delete('/terms/{term}', [AcademicCalendarController::class, 'destroyTerm']);
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
            Route::patch('/streams/{stream}', [AcademicStructureController::class, 'updateStream']);
            Route::delete('/streams/{stream}', [AcademicStructureController::class, 'destroyStream']);

            Route::post('/subjects', [AcademicStructureController::class, 'storeSubject']);
            Route::patch('/subjects/{subject}', [AcademicStructureController::class, 'updateSubject']);
            Route::delete('/subjects/{subject}', [AcademicStructureController::class, 'destroySubject']);
            Route::post('/class-subjects', [AcademicStructureController::class, 'attachSubjectToClass']);
            Route::delete('/class-subjects', [AcademicStructureController::class, 'detachSubjectFromClass']);

            // --- Teacher Subject Assignments (SRS FR-ACAD-04) ---
            Route::get('/teacher-assignments', [TeacherAssignmentController::class, 'index']);
            Route::post('/teacher-assignments', [TeacherAssignmentController::class, 'store']);
            Route::delete('/teacher-assignments/{classSubjectTeacher}', [TeacherAssignmentController::class, 'destroy']);

            // --- Timetable (SRS FR-ACAD-06/07) ---
            Route::get('/timetable/by-class', [TimetableController::class, 'indexByClass']);
            Route::get('/timetable/by-teacher', [TimetableController::class, 'indexByTeacher']);
            Route::post('/timetable', [TimetableController::class, 'store']);
            Route::delete('/timetable/{timetableEntry}', [TimetableController::class, 'destroy']);
        });

        // --- Student Management (SRS FR-STU-01..04) ---
        // Read: system_admin, head_teacher, deputy_head_teacher, teacher, HR/admin (Full/Read per matrix).
        // NOTE: Parent/Sponsor "own-child-only" access is added when the Parent/Sponsor
        // Portal modules land — deliberately not opened here yet to avoid a
        // half-built authorization check on sensitive student data.
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher,teacher')->group(function () {
            Route::get('/students', [StudentController::class, 'index']);
            Route::get('/students/{student}', [StudentController::class, 'show']);
            Route::get('/students/{student}/academic-history', [StudentController::class, 'academicHistory']);
        });

        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher')->group(function () {
            Route::post('/students', [StudentController::class, 'store']);
            Route::patch('/students/{student}', [StudentController::class, 'update']);
            Route::post('/students/{student}/promote', [StudentController::class, 'promote']);
            Route::post('/students/{student}/transfer', [StudentController::class, 'transfer']);
        });

        // --- Attendance (SRS FR-ATT-01/02/03) ---
        // Write: system_admin, head_teacher, deputy_head_teacher, teacher (see
        // AttendanceController note re: teacher-own-class scoping being a follow-up).
        // Read: same roles — Parent/Sponsor own-child access added with those portals.
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher,teacher')->group(function () {
            Route::post('/attendance/students', [AttendanceController::class, 'store']);
            Route::get('/attendance/students', [AttendanceController::class, 'index']);
            Route::get('/attendance/students/summary', [AttendanceController::class, 'summary']);
        });

        // --- CBC Assessment (SRS FR-ASM-01..07) ---
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher,teacher')->group(function () {
            Route::post('/assessments', [AssessmentController::class, 'store']);
            Route::get('/assessments', [AssessmentController::class, 'index']);
            Route::get('/report-cards/{reportCard}', [ReportCardController::class, 'show']);
            Route::get('/report-cards/{reportCard}/download', [ReportCardController::class, 'download']);
        });

        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher')->group(function () {
            Route::post('/students/{student}/report-cards/generate', [ReportCardController::class, 'generate']);
        });

        // --- Sponsorship & Partnership (SRS FR-SPN-01..08) ---
        // Deliberately the most restricted module outside System Administration,
        // per FR-SPN-07 and the User Role Matrix — sponsor data is sensitive.
        Route::middleware('role:system_admin,sponsor_coordinator,head_teacher,deputy_head_teacher')->group(function () {
            Route::get('/sponsors', [SponsorController::class, 'index']);
            Route::get('/sponsors/{sponsor}', [SponsorController::class, 'show']);
            Route::get('/sponsorships', [SponsorshipController::class, 'index']);
        });

        Route::middleware('role:system_admin,sponsor_coordinator')->group(function () {
            Route::post('/sponsors', [SponsorController::class, 'store']);
            Route::patch('/sponsors/{sponsor}', [SponsorController::class, 'update']);
            Route::post('/sponsorships', [SponsorshipController::class, 'store']);
            Route::patch('/sponsorships/{sponsorship}', [SponsorshipController::class, 'update']);
        });

        // --- Parent Portal (SRS FR-PAR-01..06) ---
        Route::middleware('role:parent_guardian')->prefix('portal/parent')->group(function () {
            Route::get('/children', [ParentPortalController::class, 'myChildren']);
            Route::get('/children/{student}/attendance', [ParentPortalController::class, 'childAttendance']);
            Route::get('/children/{student}/report-cards', [ParentPortalController::class, 'childReportCards']);
            Route::get('/children/{student}/progress', [ParentPortalController::class, 'childProgress']);
        });

        // --- Sponsor Portal (SRS FR-SPP-01..06) ---
        Route::middleware('role:sponsor')->prefix('portal/sponsor')->group(function () {
            Route::get('/sponsorships', [SponsorPortalController::class, 'mySponsorships']);
            Route::get('/sponsorships/{sponsorship}/attendance', [SponsorPortalController::class, 'sponsorshipAttendance']);
            Route::get('/sponsorships/{sponsorship}/report-cards', [SponsorPortalController::class, 'sponsorshipReportCards']);
            Route::get('/sponsorships/{sponsorship}/comments', [SponsorPortalController::class, 'sponsorshipComments']);
        });

        // --- Human Resources (SRS FR-HR-01..07, FR-ADM-02) ---
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher')->group(function () {
            Route::get('/staff', [StaffController::class, 'index']);
            Route::get('/staff/{staff}', [StaffController::class, 'show']);
            Route::patch('/staff/{staff}', [StaffController::class, 'update']);
            Route::get('/departments', [DepartmentController::class, 'index']);
        });

        Route::middleware('role:system_admin,head_teacher')->group(function () {
            Route::post('/staff', [StaffController::class, 'store']);
            Route::post('/departments', [DepartmentController::class, 'store']);
        });

        // --- Communication (SRS FR-COM-01/02/03) ---
        // Publish: staff-side roles (Teacher scoped to "own class" — same
        // tracked simplification noted in AttendanceController/AssessmentController).
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher,sponsor_coordinator,teacher')->group(function () {
            Route::post('/announcements', [AnnouncementController::class, 'store']);
        });
        // Receive: every authenticated role (per User Role Matrix — all "R").
        Route::get('/announcements', [AnnouncementController::class, 'index']);

        // Messaging: every role except Student per the User Role Matrix.
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher,sponsor_coordinator,teacher,parent_guardian,sponsor')->group(function () {
            Route::post('/messages', [MessageController::class, 'store']);
            Route::get('/messages', [MessageController::class, 'index']);
            Route::patch('/messages/{message}/read', [MessageController::class, 'markRead']);
        });

        // --- Visitor & Volunteer Management (SRS FR-VIS-01..04) ---
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher,sponsor_coordinator')->group(function () {
            Route::get('/visitors', [VisitorController::class, 'index']);
        });
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher')->group(function () {
            Route::post('/visitors', [VisitorController::class, 'store']);
        });

        // --- Reporting (SRS FR-REP-01..07) ---
        Route::middleware('role:system_admin,head_teacher,deputy_head_teacher')->group(function () {
            Route::get('/reports/school-statistics', [ReportingController::class, 'schoolStatistics']);
            Route::get('/reports/students/export', [ReportingController::class, 'exportStudents']);
        });

        // --- Administration: Backups (SRS FR-ADM-06, UC-ADM-02) ---
        Route::middleware('role:system_admin,head_teacher')->group(function () {
            Route::get('/backups', [BackupController::class, 'index']);
        });
        Route::middleware('role:system_admin')->group(function () {
            Route::post('/backups', [BackupController::class, 'store']);
            Route::get('/backups/{filename}/download', [BackupController::class, 'download']);
        });

        // --- Administration: School Settings & Logo (SRS FR-ADM-05) ---
        Route::get('/settings/school', [SchoolSettingController::class, 'show']);
        Route::middleware('role:system_admin,head_teacher')->group(function () {
            Route::patch('/settings/school', [SchoolSettingController::class, 'update']);
            Route::post('/settings/school/logo', [SchoolSettingController::class, 'uploadLogo']);
        });
    });
});
