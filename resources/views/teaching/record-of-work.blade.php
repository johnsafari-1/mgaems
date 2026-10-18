<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: DejaVu Sans, sans-serif; font-size: 10px; color: #222; }
h1 { font-size: 16px; margin-bottom: 3px; } .muted { color: #555; }
table { width: 100%; border-collapse: collapse; margin-top: 14px; }
th, td { border: 1px solid #ccc; padding: 6px; text-align: left; vertical-align: top; }
th { background: #1F3864; color: white; width: 26%; }
.section { white-space: pre-wrap; }
</style></head>
<body>
<h1>{{ $document['school']['name'] }}</h1>
@if ($document['school']['motto'])<div class="muted">{{ $document['school']['motto'] }}</div>@endif
<p><strong>{{ $document['document_type'] }}</strong> — {{ $document['class_name'] ?? 'Not available' }} · {{ $document['learning_area'] ?? 'Not available' }}</p>
<table>
<tr><th>Class / Grade</th><td>{{ $document['class_name'] ?? 'Not available' }}</td></tr>
<tr><th>Learning Area / Subject</th><td>{{ $document['learning_area'] ?? 'Not available' }}</td></tr>
<tr><th>Academic period</th><td>{{ $document['term'] ?? 'Not available' }}@if ($document['academic_year']), {{ $document['academic_year'] }}@endif</td></tr>
<tr><th>Teacher</th><td>{{ $document['teacher'] ?? 'Not available' }}</td></tr>
<tr><th>Actual teaching date</th><td>{{ $document['taught_on'] ?? 'Not available' }}</td></tr>
<tr><th>Workflow status</th><td>{{ $document['status'] ?? 'Not available' }}</td></tr>
<tr><th>Linked lesson plan</th><td>{{ $document['lesson_plan'] ?? 'Not linked' }}</td></tr>
<tr><th>Content covered</th><td class="section">{{ $document['content_covered'] }}</td></tr>
<tr><th>Learning activities conducted</th><td class="section">{{ $document['learning_activities_conducted'] }}</td></tr>
<tr><th>Work completed</th><td class="section">{{ $document['work_completed'] }}</td></tr>
<tr><th>Work not completed</th><td class="section">{{ $document['work_not_completed'] ?? 'None recorded' }}</td></tr>
<tr><th>Reasons for deviations</th><td class="section">{{ $document['reasons_for_deviations'] ?? 'None recorded' }}</td></tr>
<tr><th>Teacher observations</th><td class="section">{{ $document['teacher_observations'] }}</td></tr>
<tr><th>Follow-up actions</th><td class="section">{{ $document['follow_up_actions'] ?? 'None recorded' }}</td></tr>
</table>
@if ($document['review_notes'])<p class="section"><strong>Review note:</strong><br>{{ $document['review_notes'] }}</p>@endif
<p class="muted">Delivery is recorded only by an explicit record of work; a lesson plan never marks a lesson as delivered. Generated {{ $document['generated_at'] }}.</p>
</body></html>
