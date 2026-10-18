<?php

namespace App\Rules;

use Carbon\Carbon;
use Closure;
use DateTimeImmutable;
use Illuminate\Contracts\Validation\ValidationRule;

class HealthInstant implements ValidationRule
{
    public static function parse(mixed $value): ?Carbon
    {
        if (! is_string($value) || ! preg_match('/\A(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})\z/', $value, $parts)) {
            return null;
        }
        $offset = $parts[3];
        if ($offset === '-00:00' || ($offset !== 'Z' && (substr($offset, 1, 2) > 14
            || substr($offset, 4, 2) > 59 || (substr($offset, 1, 2) == 14 && substr($offset, 4, 2) != 0)))) {
            return null;
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s.uP',
            $parts[1].'.'.str_pad($parts[2] ?? '', 6, '0').($offset === 'Z' ? '+00:00' : $offset));
        $errors = DateTimeImmutable::getLastErrors();
        if (! $date || ($errors && ($errors['warning_count'] || $errors['error_count']))) {
            return null;
        }
        $utc = Carbon::instance($date)->utc();
        // MySQL DATETIME's supported range applies after offset conversion.
        if ($utc->year < 1000 || $utc->year > 9999) {
            return null;
        }

        return $utc;
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $instant = self::parse($value);
        if (! $instant) {
            $fail('The :attribute must be a valid timestamp with an explicit offset (or Z), up to six fractional digits, within the UTC years 1000–9999.');
        } elseif ($instant->gt(now())) {
            $fail('The :attribute must not be in the future.');
        }
    }
}
