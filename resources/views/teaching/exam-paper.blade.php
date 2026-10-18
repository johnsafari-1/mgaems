<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { font-family: DejaVu Sans, sans-serif; font-size: 10px; color: #222; } h1 { font-size: 16px; margin: 0 0 4px; } .muted { color: #555; } .school-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; } .school-logo { max-width: 70px; max-height: 55px; }
.school-header-branded { background: #14213d; color: #fff; padding: 8px 10px; border-radius: 4px; } .school-header-branded h1, .school-header-branded .school-motto { color: #fff; } .school-header-branded .school-motto { font-size: 9px; }
.school-header-compact { gap: 6px; } .school-header-compact .school-logo { max-width: 34px; max-height: 28px; } .school-header-compact .school-compact-name { font-size: 13px; font-weight: bold; } .school-header-compact .school-compact-motto { font-size: 9px; color: #555; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; } th,td { border: 1px solid #bbb; padding: 5px; text-align: left; vertical-align: top; } th { width: 26%; background: #1f3864; color: #fff; }
.section { margin-top: 16px; page-break-inside: avoid; } .question { margin-top: 10px; page-break-inside: avoid; } .options { margin: 5px 0 0 16px; } .question-diagram { max-width: 100%; max-height: 260px; margin: 6px 0; } .answer { background: #fdecea; border-left: 3px solid #c0392b; padding: 5px; margin-top: 5px; white-space: pre-wrap; } .space { height: 22px; border-bottom: 1px dotted #777; }
</style></head><body>
@include('teaching.partials.school-header')
<h2>{{ $document['examination_type'] }}: {{ $document['title'] }}</h2>
@if($document['marking_scheme'])<p><strong>RESTRICTED STAFF MARKING SCHEME. Do not distribute to learners or families.</strong></p>@endif
<table><tr><th>Class / Grade</th><td>{{ $document['class_name'] ?? 'Not available' }}</td></tr><tr><th>Learning Area / Subject</th><td>{{ $document['learning_area'] ?? 'Not available' }}</td></tr><tr><th>Academic period</th><td>{{ $document['academic_year'] }} {{ $document['term'] }}</td></tr><tr><th>Examination date</th><td>{{ $document['exam_date'] ?? 'Not set' }}</td></tr><tr><th>Duration</th><td>{{ $document['duration_minutes'] ? $document['duration_minutes'].' minutes' : 'Not set' }}</td></tr><tr><th>Total marks</th><td>{{ $document['total_marks'] }}</td></tr></table>
@if(! $document['marking_scheme'])<p>Learner name: ________________________________ Admission number: ________________________</p>@endif
@if($document['instructions'])<p><strong>Instructions</strong><br>{{ $document['instructions'] }}</p>@endif
@foreach($document['sections'] as $section)<div class="section"><h3>{{ $section['title'] }}</h3>@if($section['instructions'])<p>{{ $section['instructions'] }}</p>@endif @foreach($section['questions'] as $question)
<div class="question"><strong>{{ $question['position'] }}. {{ $question['prompt'] }} @if($question['marks'])({{ $question['marks'] }} marks)@endif</strong>
@if($question['diagram_reference'])<div>Diagram/reference: {{ $question['diagram_reference'] }}</div>@endif @if($question['image_data_uri'] ?? null)<div><img class="question-diagram" src="{{ $question['image_data_uri'] }}" alt="{{ $question['attachment_name'] }}"></div>@elseif($question['attachment_name'])<div>Approved attachment: {{ $question['attachment_name'] }}</div>@endif
@if($question['options'])<div class="options">@foreach($question['options'] as $option)<div>{{ chr(65 + $loop->index) }}. {{ $option }}</div>@endforeach</div>@endif
@if($document['marking_scheme'])<div class="answer"><strong>Answer key:</strong> {{ $question['answer_key'] ?? 'Not recorded' }}<br><strong>Marking guidance:</strong> {{ $question['marking_guidance'] ?? 'Not recorded' }}</div>@else<div class="space"></div><div class="space"></div>@endif</div>
@endforeach</div>@endforeach
@foreach($document['unsectioned_questions'] as $question)<div class="question"><strong>{{ $question['position'] }}. {{ $question['prompt'] }} @if($question['marks'])({{ $question['marks'] }} marks)@endif</strong>
@if($question['diagram_reference'])<div>Diagram/reference: {{ $question['diagram_reference'] }}</div>@endif @if($question['image_data_uri'] ?? null)<div><img class="question-diagram" src="{{ $question['image_data_uri'] }}" alt="{{ $question['attachment_name'] }}"></div>@elseif($question['attachment_name'])<div>Approved attachment: {{ $question['attachment_name'] }}</div>@endif
@if($question['options'])<div class="options">@foreach($question['options'] as $option)<div>{{ chr(65 + $loop->index) }}. {{ $option }}</div>@endforeach</div>@endif
@if($document['marking_scheme'])<div class="answer"><strong>Answer key:</strong> {{ $question['answer_key'] ?? 'Not recorded' }}<br><strong>Marking guidance:</strong> {{ $question['marking_guidance'] ?? 'Not recorded' }}</div>@else<div class="space"></div><div class="space"></div>@endif</div>@endforeach
</body></html>
