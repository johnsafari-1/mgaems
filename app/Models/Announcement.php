<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Announcement extends Model
{
    public $timestamps = false;

    protected $fillable = ['published_by', 'title', 'body', 'audience'];

    protected $casts = ['published_at' => 'datetime'];

    public function publisher()
    {
        return $this->belongsTo(User::class, 'published_by');
    }
}
