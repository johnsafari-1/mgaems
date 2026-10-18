<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

abstract class ImmutableRevision extends Model
{
    public $timestamps = false;
    protected $guarded = ['id'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Published revisions are append-only.'));
        static::deleting(fn () => throw new \LogicException('Published revisions cannot be deleted.'));
    }
}
