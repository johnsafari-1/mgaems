<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: DejaVu Sans, sans-serif; font-size: 10px; color: #222; }
h1 { font-size: 16px; margin-bottom: 3px; } .muted { color: #555; } .school-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; } .school-logo { max-width: 70px; max-height: 55px; }
table { width: 100%; border-collapse: collapse; margin-top: 14px; }
th, td { border: 1px solid #ccc; padding: 6px; text-align: left; vertical-align: top; }
th { background: #1F3864; color: white; width: 26%; }
.section { white-space: pre-wrap; }
</style></head>
<body>
@include('teaching.partials.school-header')
<p><strong>{{ $document['document_type'] }}</strong> — {{ $document['title'] }}</p>
<table>
<tr><th>Class / Grade</th><td>{{ $document['class_name'] ?? 'Not available' }}</td></tr>
<tr><th>Learning Area / Subject</th><td>{{ $document['learning_area'] ?? 'Not available' }}</td></tr>
<tr><th>Academic period</th><td>{{ $document['term'] ?? 'Not available' }}@if ($document['academic_year']), {{ $document['academic_year'] }}@endif</td></tr>
<tr><th>Teacher</th><td>{{ $document['teacher'] ?? 'Not available' }}</td></tr>
<tr><th>Lesson date</th><td>{{ $document['lesson_date'] ?? 'Not available' }}</td></tr>
<tr><th>Duration (minutes)</th><td>{{ $document['duration_minutes'] ?? 'Not available' }}</td></tr>
<tr><th>Workflow status</th><td>{{ $document['status'] ?? 'Not available' }}</td></tr>
<tr><th>Linked scheme week</th><td>{{ $document['scheme_week'] ?? 'Not linked' }}</td></tr>
<tr><th>Strand</th><td class="section">{{ $document['strand'] }}</td></tr>
<tr><th>Sub-strand</th><td class="section">{{ $document['sub_strand'] }}</td></tr>
<tr><th>Specific learning outcomes</th><td class="section">{{ $document['specific_learning_outcomes'] }}</td></tr>
<tr><th>Key inquiry questions</th><td class="section">{{ $document['key_inquiry_questions'] }}</td></tr>
<tr><th>Teaching and learning resources</th><td class="section">{{ $document['teaching_learning_resources'] }}</td></tr>
<tr><th>Introduction</th><td class="section">{{ $document['introduction'] }}</td></tr>
<tr><th>Lesson development</th><td class="section">{{ $document['lesson_development'] }}</td></tr>
<tr><th>Conclusion</th><td class="section">{{ $document['conclusion'] }}</td></tr>
<tr><th>Learning activities</th><td class="section">{{ $document['learning_activities'] }}</td></tr>
<tr><th>Assessment approach</th><td class="section">{{ $document['assessment_approach'] }}</td></tr>
<tr><th>Teacher reflection</th><td class="section">{{ $document['teacher_reflection'] ?? 'Not recorded' }}</td></tr>
<tr><th>Record of work</th><td>{{ $document['record_of_work'] ? 'Recorded for '.$document['record_of_work'] : 'No record of work has been recorded for this lesson' }}</td></tr>
</table>
@if ($document['review_notes'])<p class="section"><strong>Review note:</strong><br>{{ $document['review_notes'] }}</p>@endif
<p class="muted">Planning content is entered by school staff and is not verified or certified curriculum content. Generated {{ $document['generated_at'] }}.</p>
</body></html>
