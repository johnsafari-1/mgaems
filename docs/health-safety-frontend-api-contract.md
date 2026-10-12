# Health & Safety frontend API contract — Checkpoint 1B

Verified against `routes/api.php`, Health controllers, `HealthAccess`, `HealthInput`,
`HealthView`, `HealthInstant`, and the deployed schema on 12 October 2026.
The isolated runtime contract regression verifies **34 concrete route definitions**.
All paths below are relative to `/api/v1`; all require `auth:sanctum`.

## Authorization and transactions

Management routes require an active Head Teacher or Deputy Head Teacher User,
an active eligible Staff link, and `health.access:manage`. System Administrator,
Teacher, Parent/Guardian, Sponsor, Sponsor Coordinator and Student have no management
access. Navigation visibility is only a usability aid. Backend authorization is
rechecked by `HealthOperations` inside the record/audit transaction.

The separate safety route requires an active Teacher linked to active teaching
Staff and a learner in the backend's verified Class Teacher or current subject
assignment scope. Subject-assignment scope requires a valid current academic
period and active subject/offering; the existing Class Teacher branch checks
current class ownership separately. Leadership management permission does not
itself grant this Teacher route. The frontend preserves these backend rules.

Health responses have private, no-store cache headers. Successful **GETs also
record restricted access audits**, so live development Health GETs are not a
zero-write verification method. Checkpoint 1B uses guarded read-only SQL/policy
checks and isolated controller fixtures instead of live Health HTTP smoke tests.

## Route inventory

| Path | Methods and purpose | Definitions |
| --- | --- | ---: |
| `/health/profiles` | GET summaries; POST profile | 2 |
| `/health/profiles/{profile}` | GET detail; PATCH correction | 2 |
| `/health/profiles/{profile}/review` | POST explicit human review | 1 |
| `/health/profiles/{profile}/revisions` | GET restricted revisions | 1 |
| `/health/profiles/{profile}/alerts` | GET summaries; POST alert | 2 |
| `/health/profiles/{profile}/alerts/{alert}` | GET detail; PATCH correction/publication change | 2 |
| `/health/profiles/{profile}/alerts/{alert}/verify` | POST operational verification | 1 |
| `/health/profiles/{profile}/alerts/{alert}/revisions` | GET restricted revisions | 1 |
| `/health/incidents` | GET summaries; POST incident | 2 |
| `/health/incidents/{incident}` | GET detail; PATCH factual correction | 2 |
| `/health/incidents/{incident}/revisions` | GET restricted revisions | 1 |
| `/health/incidents/{incident}/actions` | GET summaries; POST school action | 2 |
| `/health/incidents/{incident}/actions/{entry}` | GET detail; PATCH factual correction | 2 |
| `/health/incidents/{incident}/actions/{entry}/revisions` | GET restricted revisions | 1 |
| `/health/incidents/{incident}/notifications` | GET summaries; POST actual contact attempt | 2 |
| `/health/incidents/{incident}/notifications/{entry}` | GET detail; PATCH factual correction | 2 |
| `/health/incidents/{incident}/notifications/{entry}/revisions` | GET restricted revisions | 1 |
| `/health/incidents/{incident}/referrals` | GET summaries; POST school referral | 2 |
| `/health/incidents/{incident}/referrals/{entry}` | GET detail; PATCH factual correction | 2 |
| `/health/incidents/{incident}/referrals/{entry}/revisions` | GET restricted revisions | 1 |
| `/health/access-log` | GET restricted access metadata | 1 |
| `/health/safety/learners/{student}` | GET Teacher-only actionable projection | 1 |
| **Total** | No DELETE route | **34** |

Related existing learner APIs: GET `/students?page=N&per_page=20` returns authorized
leadership summaries (`id`, `admission_no`, `first_name`, `last_name`, `class_id`,
`school_class`, `status`). The picker filters names/admission numbers locally on
this loaded page. GET `/students/{student}` supplies actual Guardian relationships
for the new notification workflow; the frontend projects only learner ID and
Guardian `id`, `full_name`, `relationship`, `phone`, `email`. It does not import
legacy medical information or treat the primary-contact flag as consent. There
is no dedicated Health learner search or leadership-authorized User-name lookup.

## Common request rules

IDs are positive integers. All list/history APIs accept `page` (1–1,000,000) and
`per_page` (1–50, default 25). Profile and incident lists optionally accept exact
`student_id`; child lists are scoped through their parent URL. The UI uses pages
of 20 and does not automatically download the entire roster or record history.

All corrections require the **loaded** `expected_revision` (integer >=1) and a
nonempty `correction_reason` (string, maximum 500). Review and verification require
these same correction fields. All child creates/corrections additionally require
the loaded parent `expected_incident_revision`. Child corrections also require
the child's own expected revision. The server advances the aggregate incident
revision on child writes; the client reloads the incident after success.

Alert, incident, action, notification and referral creates require a UUID
`request_id`. An exact retry by the same actor replays the original response;
reusing it with changed validated facts produces 409. The client freezes each
unchanged retry UUID and refuses changed facts after an uncertain response until
the user reloads and reviews history. Profiles are unique by learner and have
no request UUID; an existing profile produces 409.

Source is required and must be `guardian_report`, `learner_report`,
`staff_observation`, `external_document` or `other_report`; `source_reference` is
nullable, maximum 200. The UI always asks the operator to select the source.

## Request bodies by record

Nullable text inputs may be submitted as null. Fields shown as required below
are validated by the backend; PATCH merges permitted factual fields with the
record before validation. The frontend submits only explicit permitted fields.

| Record / operation | Body fields |
| --- | --- |
| Profile POST | `student_id`; `allergy_information_state` = `unknown`, `none_reported`, `recorded`; nullable `allergy_information`, `emergency_information`, `support_information` (each <=1000); source fields |
| Profile PATCH | Same factual fields, excluding learner ID; correction fields |
| Profile review POST | Correction fields only; reviewer and time are server-derived |
| Alert POST | UUID; required `alert_type` = `allergy`, `emergency_support`, `activity_precaution`, `other_safety`; required `description` <=500; nullable `emergency_instructions` <=500; required boolean `is_active`; source fields; required `starts_on`, nullable `ends_on` |
| Alert PATCH | Permitted alert fields plus correction fields; activation/deactivation sends only `is_active` and correction fields |
| Alert verify POST | Required `verification_basis` <=200 plus correction fields |
| Incident POST | UUID; `student_id`; required `occurred_at`; required `location` <=120; required `category` = `illness_concern`, `injury`, `exposure`, `other_safety`; required `information_basis` = `observed`, `reported`; required `observations` <=2000 |
| Incident PATCH | Occurrence/location/category/basis/observations plus correction fields; no client status, disposition or historical context |
| Action POST | UUID; parent expected revision; required `action_type` = `first_aid`, `observation`, `follow_up`, `handover`, `status_change`; required `action_at`; required `action` <=1000; nullable `result` <=1000; optional paired `status_after` and `disposition_after` |
| Action PATCH | Type/time/action/result plus child and parent correction revisions/reason; both transition fields are prohibited |
| Notification POST | UUID; parent expected revision; nullable `guardian_id` belonging to this learner; required `channel` = `phone`, `sms`, `email`, `in_person`, `other`; required `attempted_at`; required `outcome` = `contacted`, `no_answer`, `message_left`, `failed`; nullable actual `contact_used` <=200 |
| Notification PATCH | Channel/time/outcome and explicit actual `contact_used` correction plus child and parent correction revisions/reason; `guardian_id` is prohibited |
| Referral POST | UUID; parent expected revision; required `referred_at`; required `reason` <=1000; nullable `destination` <=200; nullable `authorization_details`, `handover_details` <=1000 each; required `follow_up_status` = `pending`, `handed_over`, `completed`, `cancelled` |
| Referral PATCH | Referral factual fields plus child and parent correction revisions/reason |

`recorded` allergy state requires nonblank allergy details; `unknown` and
`none_reported` prohibit recorded allergy details. Blank information never proves
absence of allergies. Profile factual correction clears prior review attribution.

Alert dates are literal `YYYY-MM-DD` school calendar dates; ends must be >= starts.
Publication defaults to inactive in the UI. Correcting an alert clears its prior
operational verification. Verification is operational review, not medical clearance;
it is not a prerequisite automatically invented by the frontend for publication.

Incident status begins `open` with disposition `none`. New actions may pair status
`open`, `monitoring`, `closed` with disposition `none`, `monitoring`,
`returned_to_class`, `guardian_handover`, `external_referral`. Closing cannot use
`none`; reopening a closed incident requires `follow_up` or `status_change`.
Historical corrections cannot replay a status transition.

## Instants and historical context

`occurred_at`, `action_at`, `attempted_at`, `referred_at` require an unambiguous
ISO-8601 timestamp with seconds and explicit `Z` or numeric offset, optionally
1–6 fractional digits. Valid normalized UTC years are 1000–9999. Events cannot
be in the future; child events cannot precede incident occurrence. Incident
correction cannot move occurrence after existing child events.

The UI labels event entry as EAT (fixed UTC+03:00), sends the explicit offset,
and displays EAT without changing the instant. UTC storage/response microseconds
are preserved. Unchanged datetime-picker values retain the original UTC response,
including microseconds if the browser normalizes fractional input. The UTC upper
boundary that maps to EAT year 10000 uses an explicit-offset text input instead.

Record times, actors, profile reviewers and alert verifiers are server-generated.
Historical class/term are captured by the backend from placement/calendar evidence,
with unknown values retained when evidence is absent. They are never inferred
from current placement by the UI. Leadership sees actor IDs because the available
User-management lookup is restricted to System Administrator.

## Responses and allowlists

Detail/write responses wrap a record in `data`. Every record has `id` and integer
`revision_number`. New UUID-backed creates return 201 and `meta.operation=created`;
exact retries return 200 and `meta.operation=replayed`. Profile creation returns
201 without that operation metadata. PATCH/review/verify return 200.

| Type | Additional detail fields |
| --- | --- |
| Profile | `student_id`, allergy state/details, emergency/support information, source/reference, `recorded_by`, `recorded_at`, `reviewed_by`, `reviewed_at` |
| Alert | `profile_id`, type/description/instructions, active flag, source/reference, starts/ends, `verified_by`, `verified_at`, `verification_basis` |
| Incident | `student_id`, occurrence/record times, location/category/observations/basis, `recorded_by`, `historical_class_id`, `historical_term_id`, `context_snapshot`, status/disposition |
| Action | `incident_id`, `actor_id`, record time, action type/time/text/result, status/disposition after |
| Notification | `incident_id`, `actor_id`, record time, `guardian_id`, channel/attempt time/outcome, `contact_snapshot` |
| Referral | `incident_id`, `actor_id`, record time, referral time/reason/destination/authorization/handover/follow-up status |

`context_snapshot`: class basis, placement record ID, class name at recording,
term basis and term name at recording. `contact_snapshot`: Guardian ID and name
at recording, explicitly recorded actual contact used, basis
`recording_time_relationship`, and capture time. Corrections preserve the original
relationship/name snapshot and only change actual contact when explicitly supplied.
No current phone/email is substituted into a historical contact attempt.

Lists return `data` arrays and `meta: {page, per_page, total}`, newest record ID
first. Summaries contain ID/revision and only: profile learner ID; alert parent,
type/publication/dates; incident learner/time/category/status/disposition; action
parent/type/time; notification parent/channel/time/outcome; referral parent/time/
follow-up status. Confidential narrative fields require explicit detail requests.
The client orders loaded child pages by actual event time at microsecond precision.

Revisions return revision number, allowlisted snapshot, change type, correction
reason, actor ID and record time plus paging metadata. The UI initially shows
revision metadata; explicit inspect/hide controls disclose each escaped snapshot.
Access logs return only ID, actor ID, operation, record type, record ID and time.

Teacher safety returns `data: {student_id, alerts: [...]}` where each alert contains
only `id`, `alert_type`, `description`, `emergency_instructions`. Only active alerts
effective on the current school date are included. Empty alerts do not prove
absence of allergies. No full-profile request is made by the Teacher workspace.

## Errors and frontend behavior

401 expires the session; 403 denotes current authorization/scope denial. Health
management clears private state/dialogs and disables the workspace after either;
Teacher denial clears the learner dialog. 404 is generic unavailable/not found.
422 supplies validation feedback, including field errors; entered facts remain for
review. 409 blocks resubmission until an explicit reload obtains current revisions.
Network failures and 503 show safe retry behavior; uncertain creates retain their
exact retry UUID and require review before changed facts. Failed transactions do
not expose medical payloads through generic error messages.

No endpoint is invented for deletion, automated contact delivery, medical
attachments, clinical treatment, Welfare/Safeguarding or other excluded modules.
