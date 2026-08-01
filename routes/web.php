<?php

use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
| MGAEMS is an API-first application (see docs/MGAEMS_APIDesign.docx).
| The frontend (Blade or a decoupled SPA — to be decided in Phase 2 of the
| Development Roadmap) will be wired here.
*/

Route::get('/', function () {
    return response()->json(['message' => 'MGAEMS API — see /api/v1']);
});
