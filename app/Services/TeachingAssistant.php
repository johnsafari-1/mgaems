<?php

namespace App\Services;

use App\Contracts\TeachingAssistantProvider;

class TeachingAssistant
{
    public function __construct(private TeachingAssistantProvider $provider) {}
    public function provider(): TeachingAssistantProvider { return $this->provider; }
}
