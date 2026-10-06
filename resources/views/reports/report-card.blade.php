<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: DejaVu Sans, sans-serif; font-size: 10px; color: #222; }
h1 { font-size: 16px; margin-bottom: 3px; } .muted { color: #555; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th, td { border: 1px solid #ccc; padding: 6px; text-align: left; vertical-align: top; }
th { background: #1F3864; color: white; } .logo { max-width: 80px; max-height: 65px; }
.remark { margin-top: 16px; white-space: pre-wrap; } .result { margin-bottom: 5px; }
</style></head>
<body>
@if ($input['school']['logo_data_uri'])
<img class="logo" src="{{ $input['school']['logo_data_uri'] }}" alt="">
@endif
<h1>{{ $input['school']['name'] }}</h1>
@if ($input['school']['motto'])<div class="muted">{{ $input['school']['motto'] }}</div>@endif
<p>{{ $input['term']['name'] }}, {{ $input['term']['academic_year'] }} — Learner Report Card</p>
<p><strong>Name:</strong> {{ $input['student']['first_name'] }} {{ $input['student']['last_name'] }}
<br><strong>Admission No:</strong> {{ $input['student']['admission_no'] }}</p>
<table>
<thead><tr><th>Learning Area / Subject</th><th>Recorded class context</th><th>Continuous score</th><th>End-term score</th><th>Performance Level</th><th>Remarks</th></tr></thead>
<tbody>
@foreach ($input['subject_rows'] as $row)
<tr>
<td>
@foreach (['continuous' => 'Continuous', 'end_term' => 'End-term'] as $type => $label)
@if (isset($row[$type]))<div class="result">{{ $label }}: {{ $row[$type]['subject'] }}@if ($row[$type]['context_state'] === 'legacy_unresolved') (legacy context unresolved)@endif</div>@endif
@endforeach
</td>
<td>
@foreach (['continuous' => 'Continuous', 'end_term' => 'End-term'] as $type => $label)
@if (isset($row[$type]))<div class="result">{{ $label }}: {{ $row[$type]['class'] }}</div>@endif
@endforeach
</td>
<td>{{ $row['continuous']['score'] ?? '—' }}</td>
<td>{{ $row['end_term']['score'] ?? '—' }}</td>
<td>
@foreach (['continuous' => 'Continuous', 'end_term' => 'End-term'] as $type => $label)
<div class="result">{{ $label }}: {{ $row[$type]['performance_level'] ?? 'Not recorded' }}</div>
@endforeach
</td>
<td>
@foreach (['continuous' => 'Continuous', 'end_term' => 'End-term'] as $type => $label)
<div class="result">{{ $label }}: {{ $row[$type]['remarks'] ?? 'Not recorded' }}</div>
@endforeach
</td></tr>
@endforeach
</tbody></table>
<div class="remark"><strong>Overall remark:</strong><br>{{ $input['overall_remark'] ?? 'Not recorded.' }}</div>
<p class="muted">Revision {{ $input['revision_number'] }} · Generated {{ $input['generated_at'] }}. Scores, performance levels and remarks remain separate by assessment type; no weighting is applied.</p>
</body></html>
