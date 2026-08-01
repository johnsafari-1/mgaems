<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

/**
 * FR-AUTH-03 / UC-AUTH-02: sends the single-use, time-limited reset link.
 * Deliberately plain-text — this is a transactional security email, not
 * a marketing template.
 */
class PasswordResetMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $resetUrl,
        public int $expiresInMinutes,
    ) {
    }

    public function build()
    {
        return $this
            ->subject('Reset your MGAEMS password')
            ->text('emails.password-reset-plain')
            ->with([
                'resetUrl' => $this->resetUrl,
                'expiresInMinutes' => $this->expiresInMinutes,
            ]);
    }
}
