<?php

namespace App\Http\Middleware;

use App\Services\AuditLogger;
use Closure;
use Illuminate\Http\Request;

/** Audit denied/invalid sensitive attempts, including failures before auth. */
class AuditStaffAccountLinkFailures
{
    public function handle(Request $request, Closure $next)
    {
        $link = $request->isMethod('PATCH') && preg_match('#^api/v1/users/([1-9][0-9]*)/staff-link$#', $request->path(), $match);
        $legacy = in_array($request->method(), ['POST', 'PATCH'], true)
            && preg_match('#^api/v1/staff(?:/[1-9][0-9]*)?$#', $request->path())
            && array_key_exists('user_id', $request->all());
        $response = $next($request);
        if (($link || $legacy) && $response->getStatusCode() >= 400) {
            $payload = json_decode($response->getContent(), true);
            app(AuditLogger::class)->log('STAFF_ACCOUNT_LINK_REJECTED', 'User', $link ? (int) $match[1] : null, [
                'status' => $response->getStatusCode(),
                'reason' => $legacy ? 'use_account_link_workflow' : ($payload['error']['code'] ?? 'request_rejected'),
            ]);
        }

        return $response;
    }
}
