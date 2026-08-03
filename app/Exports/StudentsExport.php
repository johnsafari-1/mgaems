<?php

namespace App\Exports;

use App\Models\Student;
use Maatwebsite\Excel\Concerns\FromCollection;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;

/**
 * Per SRS FR-REP-01: student reports in Excel format.
 */
class StudentsExport implements FromCollection, WithHeadings, WithMapping
{
    public function __construct(private ?int $classId = null, private ?string $status = null)
    {
    }

    public function collection()
    {
        return Student::with('schoolClass', 'stream')
            ->when($this->classId, fn ($q) => $q->where('class_id', $this->classId))
            ->when($this->status, fn ($q) => $q->where('status', $this->status))
            ->orderBy('last_name')
            ->get();
    }

    public function headings(): array
    {
        return ['Admission No', 'First Name', 'Last Name', 'Gender', 'Date of Birth', 'Class', 'Stream', 'Status', 'Admission Date'];
    }

    public function map($student): array
    {
        return [
            $student->admission_no,
            $student->first_name,
            $student->last_name,
            ucfirst($student->gender),
            $student->date_of_birth->format('Y-m-d'),
            $student->schoolClass->name ?? '',
            $student->stream->name ?? '',
            ucfirst($student->status),
            $student->admission_date->format('Y-m-d'),
        ];
    }
}
