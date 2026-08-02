<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: sans-serif; font-size: 12px; color: #222; }
        h1 { font-size: 16px; color: #1F3864; margin-bottom: 2px; }
        .subtitle { color: #555; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #1F3864; color: #fff; }
        .meta td { border: none; padding: 2px 8px 2px 0; }
        .remark-box { border: 1px solid #ccc; padding: 10px; margin-top: 10px; }
    </style>
</head>
<body>
    <h1>Manna Goodnews Academy</h1>
    <div class="subtitle">{{ $term->name }}, {{ $term->academicYear->name ?? '' }} — Learner Report Card</div>

    <table class="meta">
        <tr>
            <td><strong>Name:</strong> {{ $student->first_name }} {{ $student->last_name }}</td>
            <td><strong>Admission No:</strong> {{ $student->admission_no }}</td>
            <td><strong>Class:</strong> {{ $student->schoolClass->name ?? '' }}</td>
        </tr>
    </table>

    <table>
        <thead>
            <tr>
                <th>Subject</th>
                <th>CA Score</th>
                <th>Exam Score</th>
                <th>Competency</th>
                <th>Remarks</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($subjectRows as $row)
            <tr>
                <td>{{ $row['subject'] }}</td>
                <td>{{ $row['ca_score'] ?? '-' }}</td>
                <td>{{ $row['exam_score'] ?? '-' }}</td>
                <td>{{ $row['competency_rating'] ?? '-' }}</td>
                <td>{{ $row['remarks'] ?? '-' }}</td>
            </tr>
            @endforeach
        </tbody>
    </table>

    <div class="remark-box">
        <strong>Overall Remark:</strong><br>
        {{ $overallRemark ?? 'Not yet recorded.' }}
    </div>
</body>
</html>
