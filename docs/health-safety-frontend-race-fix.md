# Health & Safety learner-picker race correction

12 October 2026. Focused frontend correction after the browser/cross-role
verification checkpoint. The existing
[API contract](health-safety-frontend-api-contract.md) and
[Checkpoint 1B report](health-safety-frontend-checkpoint-1b.md) remain applicable.

## Repository and original reproduction

Initial repository: `D:\mgaems`, `feature/production-ui`, clean working tree,
HEAD `20e943385127d3bfa36e3608e740dd96eb82fe36`, eight ahead of origin.
No applicable `AGENTS.md` was found.

Using controlled fictional memory responses, both original cases reproduced:
switch to Incidents or Access Log while the roster is pending, then complete
the roster request. The response was discarded, leaving loading indefinitely,
no choices/paging/retry, and no recovery when returning to Profiles.

The four new regression cases (each tab, returning to Profiles before/after
completion) all fail against the original committed module and pass against the
corrected module. The original source was loaded in an isolated test process;
no working-tree rollback or development record was used for that comparison.

## Root cause and correction

`clear()` coupled the selected Health view generation to `pickerRequest`.
Tab/learner/incident changes correctly invalidated confidential detail requests,
but also invalidated the unrelated roster with no replacement roster load.

The correction keeps separate ownership using the existing counter pattern:

| Owner | Invalidation | Completion guards |
| --- | --- | --- |
| Paged learner roster | A newer roster load; full workspace reset, authorization loss, sign-out or departure | Current `pickerRequest`, workspace not denied |
| Selected Health view | Learner/tab/incident/group changes; full reset/disposal | Current `generation`, workspace not denied, expected record/parent/learner identity |
| Restricted dialog | Closing/replacing dialog or changing its Health context | View generation, dialog not closed, record ownership |
| Teacher safety | Existing learner-dialog/request lifecycle, unchanged | Existing scope/identity/request/dialog guards |

`clear()` now clears only selected Health content. `clearWorkspace()` invalidates
both owners and erases learner rows, selection, record state and private dialogs.
Startup, denial, departure and the shell sign-out control use the full reset.
Returning from browser history performs the existing fresh authorization check.
Responses invalidated by these resets cannot repopulate a new workspace.
No transport cancellation, API changes or arbitrary revision values were added.

Roster loads can finish while any unrelated tab is selected. Errors replace
loading with a working retry. Newer page loads win over older responses while
selected Health details remain independent. Empty successful results show an
actual empty roster with disabled paging.

## Related asynchronous findings

Local filter input previously replaced a pending loader or failed request's
error/retry with an apparent empty roster. `pickerReady` now permits filtering
only after a valid page loads. Loading/error feedback remains visible, and
completion applies the latest filter text. Search stays local to the loaded
authorized page: there are no asynchronous search API calls to supersede, no
new global search, and no names or narratives in request URLs.

Profile, alert, incident, action, notification, referral, revision and access-log
requests were reviewed. Their existing view-generation, parent/learner identity,
serial paging and modal-closure guards remain intact. Tests additionally prove
that an obsolete incident cannot replace another learner and a late action list
cannot replace the selected referral group. Existing late-profile/alert-dialog
checks remain passing. No additional source correction was needed for these
flows or Teacher safety.

## Validation

| Check | Result |
| --- | --- |
| Entire frontend suite | **136 unique Node test cases passed**, zero failures/skips |
| Health workspace suite | **35 passed**, including **12 new deterministic lifecycle tests** |
| Original-module comparison | All four new roster/tab cases fail on the original source and pass on the fix |
| Safe backend regressions | **14 suite invocations passed**, exit 0, no stderr |
| Backend counts | **577 passing executions; 225 distinct printed PASS labels; 352 repeated-label executions** |
| JavaScript syntax and whitespace | Changed module/test pass `node --check`; `git diff --check` passes |
| Served artifacts | Health HTML and five relevant shared assets return 200 and match workspace bytes |
| Unauthenticated deployed API | Profiles, incidents, access-log and Teacher safety each return 401 |
| Browser acceptance | **PENDING**: no connected browser surfaces; in-app browser unavailable |

Backend deduplication counts distinct printed check labels, rather than treating
inherited or parameterized repetitions as unique tests. It is not a count of
individual PHP assertions. Suites: authorization, staff_account_links,
health_safety, health_timestamps, health_frontend_contract, password_recovery,
teacher_workspace, parent_portal, sponsorship_workspace, attendance,
assessment_history, learner_guardian, academic_structure and announcements.
All ran in disposable network-disabled containers with read-only source/vendor
mounts and SQLite `:memory:`. No development migration or destructive DB test ran.

The new tests cover pending loads across both tabs and both return timings,
rapid switching, failure/retry, empty results, out-of-order paging, latest local
filtering, independent selected details, authorization loss, sign-out/departure,
history restoration and obsolete incident/group responses. Existing tests retain
coverage for learner A/B switching, alerts/incidents, revision conflicts,
confidential clearing, role navigation and Teacher read-only safety. Controlled
promises and event-loop draining are used; no arbitrary sleeps.

## Authorization, privacy and development preservation

Laravel authorization and response shaping are unchanged. Head/Deputy retain
management; Teachers retain assignment-scoped actionable safety only; other
roles remain excluded. Existing permission/session-invalidation checks pass.
No confidential browser storage, URL payload, console output, raw narrative
interpolation or new persistent state was introduced. Teacher, Parent and Sponsor
application source is unchanged.

Guarded read-only captures span `2026-10-12T17:40:33Z` to
`2026-10-12T17:47:10Z`. All **43 complete table snapshots and schemas match**,
including content/column hashes, native checksums and metadata/sequences.
Legacy medical records, Staff/User links, academics and authentication/audit
tables are unchanged. All eight Health tables remain empty. Migrations 000036
and 000037 remain applied; no rerun, real Health writes or fabricated records.
Protected evidence is retained outside tracked source in the ignored private
evidence directory. Credentials and real confidential content are not published.

## Scope, limitations and disposition

Changed files: `public/assets/health-workspace.js`,
`tests/frontend/health-workspace.test.cjs`, and this document. One local corrective
commit is created; its hash and clean post-commit status are returned in the final
response. No push or subsequent module work is performed.

The automated correction is ready for browser acceptance testing. Actual browser
acceptance remains **PENDING**, including desktop/mobile rendering, Light/Dark
contrast, learner/tab loading and retry, keyboard navigation and accessible
focus. DOM tests do not establish visual acceptance. The development environment
still has no Health records or scoped Teacher learners; no populated real-record
workflow was exercised. No real Health write smoke test was performed.

Recommendation: **GO to perform browser acceptance testing; NO-GO for final
browser acceptance sign-off until the pending checks pass.**
