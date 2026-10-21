<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: DejaVu Sans, sans-serif; font-size: 10px; color: #222; }
h1 { font-size: 16px; margin-bottom: 3px; } .muted { color: #555; } .school-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; } .school-logo { max-width: 70px; max-height: 55px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { border: 1px solid #ccc; padding: 6px; text-align: left; vertical-align: top; }
th { background: #1F3864; color: white; width: 24%; }
.details { margin-top: 12px; }
.identity { border: 1px solid #ccc; padding: 8px; margin-top: 12px; display: flex; gap: 24px; }
.identity span { display: inline-block; border-bottom: 1px solid #666; min-width: 180px; }
.question { margin-top: 10px; page-break-inside: avoid; }
.question-title { font-weight: bold; }
.options { margin: 4px 0 0 14px; }
.answer-space { margin-top: 6px; border-bottom: 1px dotted #999; height: 16px; }
</style></head>
<body>
@include('teaching.partials.school-header')
<p><strong>{{ $document['document_type'] }}</strong> — {{ $document['title'] }}</p>
<table class="details">
<tr><th>Class / Grade</th><td>{{ $document['class_name'] ?? 'Not available' }}</td></tr>
<tr><th>Learning Area / Subject</th><td>{{ $document['learning_area'] ?? 'Not available' }}</td></tr>
<tr><th>Academic period</th><td>{{ $document['term'] ?? 'Not available' }}@if ($document['academic_year']), {{ $document['academic_year'] }}@endif</td></tr>
<tr><th>Teacher</th><td>{{ $document['teacher'] ?? 'Not available' }}</td></tr>
<tr><th>Assigned</th><td>{{ $document['assigned_on'] ?? 'Not available' }}</td></tr>
<tr><th>Due date</th><td>{{ $document['due_on'] ?? 'Not available' }}</td></tr>
<tr><th>Submission method</th><td>{{ $document['submission_method'] ?? 'Not available' }}</td></tr>
<tr><th>Total marks</th><td>{{ $document['total_marks'] ?? 'Not specified' }}</td></tr>
</table>
<div class="identity"><span>Learner name:</span><span>Admission number:</span></div>
<p><strong>Instructions</strong></p>
<p style="white-space: pre-wrap;">{{ $document['instructions'] }}</p>
<p class="muted"><strong>What you should be able to do:</strong> {{ $document['learning_outcomes'] }}</p>
<p class="muted">Questions: {{ count($document['questions']) }}</p>
@foreach ($document['questions'] as $index => $question)
<div class="question">
<div class="question-title">{{ $index + 1 }}. {{ $question['prompt'] }}@if ($question['marks']) ({{ $question['marks'] }} marks)@endif</div>
@if ($question['diagram_reference'])<div class="muted">Diagram to use: {{ $question['diagram_reference'] }}</div>@endif
@if ($question['options'])
<div class="options">
@foreach ($question['options'] as $option)
<div>{{ chr(65 + $loop->index) }}. {{ $option }}</div>
@endforeach
</div>
@endif
<div class="answer-space"></div><div class="answer-space"></div><div class="answer-space"></div>
</div>
@endforeach
<p class="muted">This worksheet is entered by school staff and is not verified or certified curriculum content. Generated {{ $document['generated_at'] }}.</p>
</body></html>
