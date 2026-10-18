<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

abstract class HealthRecord extends Model
{
    use \App\Models\Concerns\UsesHealthUtcDates;

    protected $guarded = ['id'];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new \LogicException('School health records cannot be hard deleted.'));
    }

    public function revisions()
    {
        return $this->hasMany(HealthRecordRevision::class, 'record_id')->where('record_type', static::TYPE);
    }
}
