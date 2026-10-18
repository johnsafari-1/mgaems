<?php

namespace App\Http\Controllers\Api;

class HealthActionController extends HealthIncidentEntryController
{
    protected const TYPE = 'action';

    protected const MODEL = \App\Models\HealthIncidentAction::class;
}
