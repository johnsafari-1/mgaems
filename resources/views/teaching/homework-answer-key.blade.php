<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: DejaVu Sans, sans-serif; font-size: 10px; color: #222; }
h1 { font-size: 16px; margin-bottom: 3px; } .muted { color: #555; } .school-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; } .school-logo { max-width: 70px; max-height: 55px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { border: 1px solid #ccc; padding: 6px; text-align: left; vertical-align: top; }
th { background: #1F3864; color: white; width: 24%; }
.restricted { background: #FDECEA; border: 1px solid #C0392B; color: #C0392B; padding: 6px; margin-top: 10px; font-weight: bold; }
.question { margin-top: 10px; page-break-inside: avoid; }
.question-title { font-weight: bold; }
.options { margin: 4px 0 0 14px; }
.answer { margin-top: 6px; white-space: pre-wrap; }
</style></head>
<body>
@include('teaching.partials.school-header')
<div class="restricted">Restricted staff document — contains answer keys and marking guidance. Do not distribute to learners or guardians.</div>
<p><strong>{{ $document['document_type'] }}</strong> — {{ $document['title'] }}</p>
<table>
<tr><th>Class / Grade</th><td>{{ $document['class_name'] ?? 'Not available' }}</td></tr>
<tr><th>Learning Area / Subject</th><td>{{ $document['learning_area'] ?? 'Not available' }}</td></tr>
<tr><th>Academic period</th><td>{{ $document['term'] ?? 'Not available' }}@if ($document['academic_year']), {{ $document['academic_year'] }}@endif</td></tr>
<tr><th>Assigned / Due</th><td>{{ $document['assigned_on'] ?? 'Not available' }} to {{ $document['due_on'] ?? 'Not available' }}</td></tr>
<tr><th>Total marks</th><td>{{ $document['total_marks'] ?? 'Not specified' }}</td></tr>
</table>
@foreach ($document['questions'] as $index => $question)
<div class="question">
<div class="question-title">{{ $index + 1 }}. {{ $question['prompt'] }}@if ($question['marks']) ({{ $question['marks'] }} marks)@endif</div>
@if ($question['options'])
<div class="options">
@foreach ($question['options'] as $option)
<div>{{ chr(65 + $loop->index) }}. {{ $option }}</div>
@endforeach
</div>
@endif
<div class="answer"><strong>Answer key:</strong> {{ $question['answer_key'] ?? 'Not recorded' }}</div>
<div class="answer"><strong>Marking guidance:</strong> {{ $question['marking_guidance'] ?? 'Not recorded' }}</div>
</div>
@endforeach
<p class="muted">Restricted staff export. Generated {{ $document['generated_at'] }}.</p>
</body></html>
