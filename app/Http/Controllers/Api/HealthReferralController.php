<?php

namespace App\Http\Controllers\Api;

class HealthReferralController extends HealthIncidentEntryController
{
    protected const TYPE = 'referral';

    protected const MODEL = \App\Models\HealthExternalReferral::class;
}
