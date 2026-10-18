@php($headerTemplate = $document['header_template'] ?? 'classic')
@if ($headerTemplate === 'branded')
<div class="school-header school-header-branded">
@if ($document['school']['logo_data_uri'] ?? null)<img class="school-logo" src="{{ $document['school']['logo_data_uri'] }}" alt="">@endif
<div><h1>{{ $document['school']['name'] }}</h1>@if ($document['school']['motto'])<div class="school-motto">{{ $document['school']['motto'] }}</div>@endif</div>
</div>
@elseif ($headerTemplate === 'compact')
<div class="school-header school-header-compact">
@if ($document['school']['logo_data_uri'] ?? null)<img class="school-logo" src="{{ $document['school']['logo_data_uri'] }}" alt="">@endif
<span class="school-compact-name">{{ $document['school']['name'] }}</span>@if ($document['school']['motto'])<span class="school-compact-motto">{{ $document['school']['motto'] }}</span>@endif
</div>
@else
<div class="school-header">
@if ($document['school']['logo_data_uri'] ?? null)<img class="school-logo" src="{{ $document['school']['logo_data_uri'] }}" alt="">@endif
<div><h1>{{ $document['school']['name'] }}</h1>@if ($document['school']['motto'])<div class="muted">{{ $document['school']['motto'] }}</div>@endif</div>
</div>
@endif
