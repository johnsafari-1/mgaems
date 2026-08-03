<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Message;
use Illuminate\Http\Request;

/**
 * Implements SRS FR-COM-02 and UC-COM-02.
 */
class MessageController extends Controller
{
    public function store(Request $request)
    {
        $validated = $request->validate([
            'recipient_id' => ['required', 'exists:users,id'],
            'body' => ['required', 'string'],
        ]);

        $message = Message::create([
            'sender_id' => auth()->id(),
            'recipient_id' => $validated['recipient_id'],
            'body' => $validated['body'],
            'sent_at' => now(),
        ]);

        return response()->json(['data' => $message], 201);
    }

    /**
     * Returns the authenticated user's full conversation history — both
     * sent and received — ordered most recent first.
     */
    public function index()
    {
        $userId = auth()->id();

        $messages = Message::with('sender:id,username', 'recipient:id,username')
            ->where('sender_id', $userId)
            ->orWhere('recipient_id', $userId)
            ->orderByDesc('sent_at')
            ->get();

        return response()->json(['data' => $messages]);
    }

    public function markRead(Message $message)
    {
        if ($message->recipient_id !== auth()->id()) {
            return response()->json([
                'error' => ['code' => 'FORBIDDEN', 'message' => 'You can only mark your own received messages as read.'],
            ], 403);
        }

        $message->update(['read_at' => now()]);

        return response()->json(['data' => $message->fresh()]);
    }
}
