<?php

namespace App\Models\Concerns;

use Illuminate\Support\Carbon;

/** Health DATETIME(6) values are UTC; calendar DATE values remain literal dates. */
trait UsesHealthUtcDates
{
    public function getDateFormat()
    {
        return 'Y-m-d H:i:s.u';
    }

    protected function asDateTime($value)
    {
        if ($value instanceof \DateTimeInterface) {
            return Carbon::instance($value)->utc();
        }
        if (is_numeric($value)) {
            return Carbon::createFromTimestampUTC($value);
        }

        // Offset-free database strings must never inherit app.timezone.
        return Carbon::parse($value, 'UTC')->utc();
    }

    public function setAttribute($key, $value)
    {
        if ($value !== null && $this->hasCast($key, ['date', 'immutable_date'])) {
            $this->attributes[$key] = $value instanceof \DateTimeInterface ? $value->format('Y-m-d') : $value;

            return $this;
        }

        return parent::setAttribute($key, $value);
    }
}
