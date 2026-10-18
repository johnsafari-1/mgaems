<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class PromotionTransferResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'effective_date' => $this->effective_date?->toDateString(),
            'reason' => $this->reason,
            'from_class' => $this->fromClass ? ['id' => $this->fromClass->id, 'name' => $this->fromClass->name] : null,
            'to_class' => $this->toClass ? ['id' => $this->toClass->id, 'name' => $this->toClass->name] : null,
            'term' => $this->term ? ['id' => $this->term->id, 'name' => $this->term->name] : null,
        ];
    }
}
