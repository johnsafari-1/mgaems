<?php

namespace App\Http\Controllers\Api;

class HealthNotificationController extends HealthIncidentEntryController
{
    protected const TYPE = 'notification';

    protected const MODEL = \App\Models\HealthGuardianNotification::class;
}
