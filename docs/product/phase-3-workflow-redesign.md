# Venue Wrangler Enterprise — Phase 3: Workflow Redesign

## Workflow conventions

### Common rules

- Every action is performed in explicit organization, venue, event, and location context where applicable.
- A user sees only work within their scope. Server authorization evaluates both role and scope; client navigation is convenience, not enforcement.
- A **work item** carries one clear owner, status, urgency, next action, and activity history. Readiness checks, service exceptions, and inventory discrepancies can create or link work items rather than forming separate task systems.
- Notifications link to the affected permitted object and explain the triggering change. Activity history records the durable fact; notifications are not the record of truth.
- State changes are idempotent and auditable. A repeated request must not create duplicate check-ins, handoffs, stock movements, or orders.
- A workflow may require acknowledgement, approval, or confirmation. These are separate actions with distinct meanings and records.

### Offline policy key

| Policy | Meaning |
|---|---|
| Online-only | The user may view cached context, but the command is blocked until current server data is available. |
| Offline-readable | Cached authorized data may be viewed with a visible as-of time. No mutation is accepted locally. |
| Offline-writable | The command enters a durable outbox with an idempotency key, visible pending state, retry behavior, and a conflict-resolution path. |

### Shared recovery pattern

When a write cannot complete, the product retains user input, shows whether the action is pending or failed, and provides a specific recovery path: retry, edit, cancel before sending, request permission, or assign a new owner. A user never has to retype information because synchronization failed.

## 1. Configure an organization and venue

| Item | Definition |
|---|---|
| Primary users | Organization administrator; venue administrator for delegated venue setup |
| Context | New organization or newly onboarded venue; desktop first |
| Trigger | Organization is provisioned, a venue is added, or an administrator must prepare a venue for its first event |
| Required information | Organization name; venue name and time zone; operational areas; service locations; storage locations; departments/teams; default event template; administrators |
| Offline policy | Online-only for changes; offline-readable for already-authorized venue reference data |
| Minimum meaningful steps | 1. Create or select organization. 2. Add venue identity and time zone. 3. Define only the areas and locations needed for the first event. 4. Assign venue administrators. 5. Validate readiness and publish the venue for operational use. |
| Completion criteria | Venue has an administrator, time zone, at least one operational area, and all required configuration checks pass. It is eligible to host an event. |

**Decision points and simplifications**

- Start with a short operational setup; deeper structural detail is added only when a later workflow requires it.
- Clone a trusted venue template only after the administrator reviews local differences. Template inheritance never silently overwrites local policy.
- A venue can remain **draft** while configuration is incomplete. It is not selectable for a new event until required checks pass.

**Failure and recovery**

- Duplicate venue name: offer the existing authorized venue or require a distinguishing name; do not merge data automatically.
- Missing required setup: show the specific missing prerequisite and route to that section.
- Lost administrator access: organization administrators can restore a venue administrator; venue administrators cannot grant themselves broader access.

**Notifications**

- Notify assigned venue administrators when a venue is ready for review or activated.
- Notify the organization administrator when an activation check fails or a required administrator is missing.

**Permission and audit boundary**

- Organization administrators create organizations, assign organization-level roles, and activate venues.
- Venue administrators configure only their authorized venue and cannot alter organization-level identity, retention, or cross-venue policy.
- Audit: organization/venue created, template applied, location or service area changed, role granted/revoked, readiness validation, venue activated/deactivated.

**State machine**

`Draft → Configuring → Ready for review → Active`

`Configuring or Ready for review → Draft` when a prerequisite is removed; `Active → Suspended` only by an authorized administrator, preserving history.

**Current implementation boundary:** organization tenants are provisioned from verified issuer mapping; tenant admins can edit the organization display name without changing that identity. The setup API creates draft venues with an IANA time zone, allows locations to be added before activation, exposes tenant-admin readiness checks for time zone and at least one location, and gates event creation on an active venue with valid setup. Staff profiles are created by SCIM or first successful SSO login; a manual roster entry requires an exact issuer/subject and does not invite a user. The current admin screen still grants setup only to organization tenant administrators; delegated venue administrators, templates, service areas/departments, and readiness notifications are not implemented yet. Event create and edit now send a venue wall-clock time, which the API converts with the venue IANA time zone before storing UTC.

## 2. Prepare an upcoming event

| Item | Definition |
|---|---|
| Primary users | Event operations manager; supervisor; venue administrator |
| Context | A future event at an active venue |
| Trigger | New event arrives, recurring event is generated, or a copied event needs review |
| Required information | Event name, scheduled start/end, venue areas, event template, milestones, readiness checks, owners, operational notes, staffing target, service needs |
| Offline policy | Offline-readable; offline-writable for draft notes and low-risk readiness evidence, subject to later authorization and conflict validation |
| Minimum meaningful steps | 1. Create from a trusted template or start minimal. 2. Confirm dates, areas, and operational scope. 3. Review generated readiness work and assign owners. 4. Resolve or accept gaps. 5. Mark plan ready for event-day execution. |
| Completion criteria | Required readiness checks have owners and due times, known blockers are visible, and the event is eligible for staffing publication and live command activation. |

**Decision points and simplifications**

- Do not require complete run-of-show detail before staffing or readiness work can begin.
- Add dependencies only when work cannot start without another item; avoid making every checklist item a dependency graph.
- A material change after readiness is confirmed reopens only affected checks and alerts their owners.

**Failure and recovery**

- Template mismatch: retain copied data, identify differences, and let the manager accept, revise, or remove each item.
- Unassigned required work: show it as a planning blocker with suggested eligible teams.
- Conflicting event times/locations: retain the draft and require an authorized decision before activation.

**Notifications**

- Send an assignment notice when a readiness item first receives an owner or its due time materially changes.
- Escalate overdue required checks to the responsible supervisor, then event manager.

**Permission and audit boundary**

- Event managers edit plans in their venue scope; supervisors update assigned readiness items; venue administrators maintain templates.
- Only an event manager or permitted delegate may mark an event ready or reopen the plan after a material change.
- Audit: event created/copied, scope changed, readiness work created/assigned/reassigned, due date changed, blocker accepted, readiness status changed.

**State machine**

`Draft → Planning → Ready → Live → Closeout → Closed`

`Ready → Planning` when a material change requires revalidation. `Live → Closeout` begins after the operational end condition; a closed event cannot be edited without a documented correction workflow.

## 3. Build and publish the workforce schedule

### Implemented first pilot slice

The API-backed event staffing view supports scoped draft shifts with role, location, worker, instructions, required qualifications, and start/end times; publish/cancel; worker acknowledgement/decline; self-claim for an open published slot; and assigned-worker check-in/check-out. Schedule edits increment a revision, reset acknowledgement, append an audit record, and notify the assigned worker in the durable in-app inbox. Server-side checks block overlapping published assignments and serialize competing assignment changes per worker. Workers can manage their own unavailable intervals; assignment, publication, and claim check for interval conflicts under the same per-worker transaction lock as schedule writes. Scoped schedulers can review recorded unavailability for their assignable roster in a week-by-week calendar; the endpoint omits private notes and rejects out-of-venue access. Tenant admins can grant or revoke expiring roster qualifications; the API checks eligibility at assignment, publication, acknowledgement, claim, and check-in. Availability records and qualification changes are tenant-protected and audited. Tenant admins must configure a minimum inter-shift rest interval from 0 to 1440 minutes before assigning workers; the server checks it on assignment, publishing, editing, and claiming, and refuses a policy increase that conflicts with upcoming published shifts. The threshold is explicitly selected by the tenant and is not a legal recommendation. Managers can set role/location/time coverage demand, inspect scheduled and published counts, and generate the uncovered deficit as auditable draft open shifts for assignment and publication. Historical staffing plans for up to 20 earlier venue events provide median role/time/headcount suggestions with sample counts; managers must review and save each suggestion, and the baseline is not based on attendance or ticket sales. For unassigned draft shifts, managers can ask eligible workers to explicitly report available or unavailable; requests and responses are audited and tied to the current shift revision. Recommendations distinguish confirmed availability from no recorded conflict, and worker responses do not assign or acknowledge a shift. Assigned workers can start/end meal and rest breaks while checked in; start/end times are server-stamped, only one break may be active per shift, check-out is blocked until it ends, and both transitions append shift audit events. When offline, workers can queue check-in and check-out in encrypted device storage; sync submits unverified device timestamps for a scoped supervisor to accept or reject with a reason before the shift attendance state changes. Tenant admins can attach private PDF/image evidence to a qualification; uploads are hash-verified, exposed through short-lived signed links, and reviewed as verified or rejected with an audited rationale. Pending and rejected evidence cannot satisfy staffing requirements; administrator-attested qualifications without uploaded documents remain eligible. Eligible-worker recommendations rank assignment candidates against signed roster scope, current qualifications, recorded unavailability, published shift/rest conflicts, tenant rest policy, and event workload; a manager confirms each assignment and the write path repeats its checks. Fully automatic assignment/publishing remains out of scope. Location-specific evidence and customer-specific labor/POS/ticketing adapters remain outside this implemented slice; the tenant-scoped vendor staffing request workflow is implemented.

| Item | Definition |
|---|---|
| Primary users | Workforce scheduler; supervisor; vendor manager |
| Context | An event or schedule period, scoped to venue, team, and service area |
| Trigger | Event plan requires coverage or an existing schedule needs adjustment |
| Required information | Demand or staffing target, shift templates, eligible people, availability, qualification/compliance status, location, start/end, break policy, vendor staffing commitments |
| Offline policy | Offline-readable; online-only for publication and final eligibility validation; offline-writable for a scheduler’s draft changes where policy allows |
| Minimum meaningful steps | 1. Generate draft shifts from demand/templates. 2. Resolve uncovered or ineligible slots. 3. Review labor and compliance exceptions. 4. Publish selected shifts. 5. Monitor acknowledgements and day-of attendance. |
| Completion criteria | Published shifts have an accountable person or an explicitly visible open/vendor-filled slot; affected workers can see the current schedule. |

**Decision points and simplifications**

- Scheduling is capacity-first: resolve coverage before optimizing visual arrangement or optional preferences.
- Use one staffing request lifecycle for internal open slots and vendor-covered slots; distinguish source and commitment rather than maintain duplicate rosters.
- Publishing supports a selected set of changed shifts, but the user sees exactly who will be notified.

**Failure and recovery**

- Assignment conflict or expired qualification: block publication of that shift, preserve the draft, and offer eligible alternatives.
- Worker has not acknowledged: remind according to policy; do not silently assume acceptance.
- Published change conflicts with a worker’s response: preserve both facts, flag an exception, and require a scheduler decision.

**Notifications**

- Notify workers of published or materially changed shifts; notify supervisors of unfilled, declined, or unacknowledged critical shifts.
- Notify vendor managers when a request is created, committed, partially fulfilled, or late.

**Permission and audit boundary**

- Schedulers create and publish schedules in scope; supervisors fill designated shifts; vendor managers respond to assigned vendor requests.
- Only permitted scheduling roles override qualification, rest, or compliance warnings, with an explicit reason.
- Audit: demand changed, shift created/edited, assignment proposed/confirmed, publication, acknowledgement, decline, override, vendor commitment.

**State machine**

`Draft → Coverage review → Published → In progress → Completed`

An individual shift follows `Open → Proposed → Assigned → Acknowledged → Checked in → Checked out`, with `Declined`, `Cancelled`, and `No show` as explicit exception states.

## 4. View and acknowledge a shift

| Item | Definition |
|---|---|
| Primary users | Frontline worker; supervisor as delegate |
| Context | The worker’s assigned event shift on a phone |
| Trigger | Shift publication, material change, reminder, or worker opening Today |
| Required information | Time, role, location, supervisor, check-in method, instructions, required credentials or preparation, current change status |
| Offline policy | Offline-readable; offline-writable acknowledgement when the displayed version is cached and the server can validate it later |
| Minimum meaningful steps | 1. Open shift. 2. Review time, location, and instructions. 3. Acknowledge or report a conflict. |
| Completion criteria | The current shift version is acknowledged or a conflict has an accountable reviewer. |

**Decision points and simplifications**

- Acknowledgement means “I have seen and understood this current version.” It is not an approval of all future changes.
- A worker can report availability conflict directly from the shift; they should not hunt for a separate request module.
- Material changes reset acknowledgement only when they affect time, location, role, or required instruction.

**Failure and recovery**

- Shift replaced while offline: retain the acknowledgement as pending, then ask the worker to review the current version after sync.
- Permission/access loss: show the last known shift as unavailable with support contact, not an empty screen.

**Notifications**

- Shift publication and material changes notify the worker; unresolved conflict notifies the scheduler and supervisor.

**Permission and audit boundary**

- Workers see only their assignments and may acknowledge or report a conflict. Supervisors may acknowledge only when policy permits delegated acknowledgement, which is visibly attributed.
- Audit: shift viewed where required by policy, acknowledgement version, conflict submitted, delegate action.

**State machine**

`Unseen → Viewed → Acknowledged`; `Viewed or Acknowledged → Conflict reported`; a material change moves the current version to `Acknowledgement required`.

## 5. Check in and check out

| Item | Definition |
|---|---|
| Primary users | Frontline worker; supervisor for exceptions |
| Context | An acknowledged shift at its eligible time and location |
| Trigger | Worker arrives or leaves; a supervisor records an exception |
| Required information | Shift identity, time, authorized check-in method, location/evidence when policy requires it, break records, exception reason if applicable |
| Offline policy | Offline-writable when authorized by cached shift and device policy; online validation required for methods that depend on current geofence, badge, or biometric integration |
| Minimum meaningful steps | 1. Open current shift. 2. Check in or out. 3. Confirm recorded time and any exception. |
| Completion criteria | Attendance record has an authoritative or pending timestamp, method, actor, and exception status; required breaks are recorded. |

**Decision points and simplifications**

- The normal path is one clear action; late, early, wrong-location, and missed-break cases appear only when detected.
- A supervisor correction never overwrites original attendance evidence; it adds a correction with reason and attribution.
- Check-out may be blocked or require confirmation if required work, equipment return, or break compliance is unresolved by policy.

**Failure and recovery**

- Device offline: create a durable pending attendance command with local timestamp and evidence; clearly distinguish it from server-confirmed attendance.
- Duplicate check-in/out: return the existing record and explain that no second time entry was created.
- Location mismatch: permit a reasoned exception route if policy allows; otherwise direct the worker to the supervisor.

**Notifications**

- Notify supervisor of no-show, late, exception, or failed pending attendance synchronization; send workers a confirmation when an offline record becomes authoritative.

**Permission and audit boundary**

- Workers record only their own attendance. Supervisors correct in-scope records with reason. Schedulers may review but not alter attendance unless explicitly authorized.
- Audit: check-in/out attempted/recorded, evidence reference, correction, break start/end, exception decision.

**State machine**

`Scheduled → Eligible → Checked in → On break → Checked in → Checked out`

Exceptions: `No show`, `Late`, `Pending sync`, `Correction requested`, `Corrected`. `Checked out` becomes final after the review window, with amendments retained as separate audit events.

## 6. Monitor event readiness

| Item | Definition |
|---|---|
| Primary users | Supervisor; event operations manager; venue administrator before event day |
| Context | An upcoming or live event, filtered to area/team when appropriate |
| Trigger | Opening Event Command, approaching milestone, readiness item due, material event change, or issue escalation |
| Required information | Current event stage, readiness checks, owners, due times, blockers, dependencies, attendance and service signals, stale-data status |
| Offline policy | Offline-readable; offline-writable for evidence and low-risk check completion if each action can be reconciled; state-changing overrides are online-only |
| Minimum meaningful steps | 1. Open readiness summary. 2. Filter to a blocked/at-risk area. 3. Open the responsible work item. 4. Complete, reassign, escalate, or record a blocker. |
| Completion criteria | Required checks are complete or an accepted exception has a named owner, rationale, and follow-up. The readiness state accurately reflects unresolved risk. |

**Decision points and simplifications**

- Readiness health is an explanation, not a mystery score: users can see which work is late, blocked, or unowned.
- A readiness item can be complete with an accepted exception only when the authority is explicit and the risk is visible.
- Event Command is not a second checklist system; it aggregates the same work items planned earlier.

**Failure and recovery**

- Stale data: show the as-of time, avoid definitive “ready” language, and offer refresh or offline evidence capture.
- Conflicting completion: retain both claims, mark review required, and assign it to the correct supervisor.

**Notifications**

- Alert owner before due time; escalate required blockers based on event proximity and severity.
- Notify the event manager when readiness status changes to at risk or ready with accepted exceptions.

**Permission and audit boundary**

- Assigned users update their readiness work; supervisors reassign/escalate; event managers accept material exceptions.
- Audit: status/evidence change, owner change, due-time change, exception accepted/rejected, readiness status recalculated.

**State machine**

`Not started → In progress → Complete`

Exception paths: `Blocked`, `At risk`, `Awaiting review`, `Exception accepted`, `Reopened`. Event readiness derives from required item states and cannot be manually set without an audited override.

## 7. Report, assign, escalate, and resolve an issue

| Item | Definition |
|---|---|
| Primary users | Any operational user to report; supervisors and event managers to coordinate |
| Context | Current event and location, or a venue issue outside an event |
| Trigger | User notices a safety, service, equipment, staffing, inventory, or guest-impacting problem |
| Required information | Category, location, concise description, severity/impact, optional photo or attachment, reporter, event context |
| Offline policy | Offline-writable for reports and evidence; resolution requiring current authority or external coordination may be online-only |
| Minimum meaningful steps | 1. Report issue from anywhere. 2. Confirm category, location, and impact. 3. Submit. 4. Assigned owner updates, resolves, or escalates. |
| Completion criteria | An issue is resolved with a recorded outcome, or is explicitly handed to a follow-up owner with a due date. |

**Decision points and simplifications**

- Reporting asks for the smallest set of information needed to route correctly; classification can be refined later by the owner.
- Severity represents operational impact and response expectation, not a vague priority label.
- Escalation changes accountability and notification path while retaining the original report and history.

**Failure and recovery**

- Offline report remains visible as pending until sent; attachments are queued separately and show their own status.
- No eligible owner: route to the supervisor queue and mark unassigned, never silently close.
- Duplicate report: suggest related open issues but allow submission when the reporter confirms it is distinct.

**Notifications**

- Immediate notice to assigned owner; escalation notices follow severity and no-response thresholds.
- Reporter receives meaningful state changes, owner assignment, and resolution summary.

**Permission and audit boundary**

- All scoped users report issues. Only authorized supervisors/managers assign, change severity, accept risk, or resolve designated categories.
- Audit: report, classification, ownership, severity, status, escalation, attachments, resolution evidence, reopen reason.

**State machine**

`Reported → Triaged → Assigned → In progress → Resolved → Verified → Closed`

`Reported or Assigned → Escalated`; `Resolved → Reopened`; an unresolved issue at event closeout becomes `Follow-up required` with a named owner.

## 8. Create and execute a hospitality order

| Item | Definition |
|---|---|
| Primary users | Hospitality coordinator; supervisor; kitchen/concessions operator |
| Context | Event, destination/service area, requested fulfillment time |
| Trigger | New guest, suite, sponsor, meeting, or internal service request |
| Required information | Requester, destination, fulfillment window, items/service requirements, quantity, constraints, contact/handoff method, charge or approval reference where applicable |
| Offline policy | Offline-writable for draft capture; online-only for submission when availability, pricing, or approval must be current; offline-readable for active order details |
| Minimum meaningful steps | 1. Select destination and fulfillment time. 2. Add items or service requirements. 3. Validate constraints and submit. 4. Kitchen/service team prepares and hands off. 5. Confirm fulfillment. |
| Completion criteria | The order is delivered, picked up, or explicitly cancelled with a recorded handoff or outcome. |

**Decision points and simplifications**

- A single order lifecycle serves hospitality and concessions; menus, routing, and required fields adapt by service type.
- Avoid duplicate entry from a BEO: import or link the relevant requirements, then manage execution in the order.
- Only require approval before work begins where a policy, cost threshold, or change risk requires it.

**Failure and recovery**

- Item unavailable: propose allowed substitutes or split fulfillment; do not silently change an order.
- Late change: recalculate affected timing, require confirmation if preparation already began, and notify owners.
- Failed handoff confirmation: retain the prepared state and request recipient/supervisor verification.

**Notifications**

- Notify preparation owner at submission/approval; warn destination and coordinator for at-risk fulfillment; confirm requester at handoff where appropriate.

**Permission and audit boundary**

- Authorized requesters create orders in scope. Kitchen/service roles update preparation and handoff. Supervisors approve, cancel, or override policy-bound changes.
- Audit: draft/submission, approval, items/constraints changed, routing, preparation start, substitution consent, handoff, cancellation, exception.

**State machine**

`Draft → Submitted → Awaiting approval (optional) → Accepted → Preparing → Ready → In transit → Handed off → Fulfilled`

Exceptions: `On hold`, `At risk`, `Partially fulfilled`, `Cancelled`, `Rejected`. A change after `Preparing` creates a revision record.

**Implemented vertical slice (2026-09-25)**

The API and Flutter event Hospitality queue supports scoped order submission with item name, quantity, unit, item note, destination location, service time, and delivery/dietary instructions. Requesters can retain an encrypted offline draft and submit it later. Kitchen operators with `hospitality:fulfill` accept, start preparation, mark ready, record cumulative per-line fulfillment batches with substitution/partial-delivery reasons, reject with a reason, or cancel with a reason. Requesters confirm pickup by recording the receiver name, an in-person acknowledgement, and a receiver signature; the API stores an immutable, tenant-scoped receipt and rejects pickup until all lines are fulfilled. An optional receiver photo is encrypted on device, uploaded to private Cloud Storage, verified by size, MIME signature, and SHA-256 on the API, and linked to the receipt as immutable tenant-scoped evidence. Scoped users can view it through a five-minute signed URL. Before the pickup dialog closes, the app saves the signed receipt, photo metadata, and stable idempotency key in the user's encrypted local queue. When offline or when submission fails, the server order remains unchanged and the receipt and encrypted photo stay pending for automatic or manual retry; only a successful API response clears the queued evidence. The signature and photo are operational evidence, not a certified electronic signature. Writes are idempotent and append to tenant-scoped immutable audit. Assigned operators and requesters receive durable notifications with an order reference. Remaining work includes customer-specific menu/BEO import and vendor POS/inventory synchronization.

## 9. Fulfill kitchen distribution and pickup

| Item | Definition |
|---|---|
| Primary users | Kitchen/concessions operator; runner; supervisor |
| Context | Active service order or distribution batch, source kitchen, destination, event timing |
| Trigger | An accepted order reaches preparation or a planned distribution window opens |
| Required information | Order/batch contents, destination, preparation requirements, pack/quality confirmation, pickup person or route, timing, shortage/substitution state |
| Offline policy | Offline-writable for pack, pickup, and delivery confirmation when order version is cached; online-only for material substitutions or cancellation after dispatch |
| Minimum meaningful steps | 1. Claim or receive work. 2. Prepare and confirm pack. 3. Mark ready. 4. Confirm pickup or dispatch. 5. Confirm destination handoff. |
| Completion criteria | Each item is fulfilled or explicitly shorted/substituted, and responsibility transfer is recorded through handoff. |

**Decision points and simplifications**

- Kitchen, runner, and destination see the same order in role-specific modes rather than generating copied tickets.
- Handoff is a state transition with a named person, time, and optional proof; it is not a free-text note.
- A shortage creates a linked exception and can notify stock/replenishment without forcing the operator into the Stock workspace.

**Failure and recovery**

- Lost connection after pickup: show a pending handoff so the order cannot be unintentionally reassigned.
- Destination unavailable: hold in a visible exception state and alert the coordinator; retain safe-handling instructions.
- Quantity mismatch: require an explicit shortage, remake, or supervisor-authorized substitution decision.

**Notifications**

- Notify runner/destination when ready; notify coordinator and requester when at risk, shorted, or handed off.

**Permission and audit boundary**

- Kitchen staff update preparation; authorized runners record pickup/delivery; supervisors resolve shortages and quality exceptions.
- Audit: work claimed, pack confirmed, ready time, pickup/delivery actor and time, quantity exception, substitution, remake.

**State machine**

`Queued → Claimed → Preparing → Pack confirmed → Ready → Picked up → Delivered`

Exceptions: `Blocked`, `Shorted`, `Remake requested`, `Held`, `Cancelled`. Delivery becomes `Handoff disputed` if recipient challenges it.

## 10. Count, transfer, and reconcile inventory

| Item | Definition |
|---|---|
| Primary users | Inventory manager; kitchen/concessions operator for scoped actions |
| Context | Authorized stock location, item set, event where relevant |
| Trigger | Scheduled count, replenishment need, service shortage, transfer request, discrepancy, or closeout |
| Required information | Location, item/scan identifier, unit, recorded quantity, counted/moved quantity, source/destination, reason code, evidence for material adjustments |
| Offline policy | Offline-writable for counts and approved transfers using cached location/item scope; reconciliation, adjustment approval, and negative-stock overrides are online-only |
| Minimum meaningful steps | 1. Start assigned count or transfer. 2. Scan/select items and enter quantity. 3. Confirm difference or movement. 4. Submit. 5. Reconcile exceptions. |
| Completion criteria | Every movement has a source/destination or reason, accountable actor, time, and authoritative or visibly pending synchronization result; discrepancies have a disposition. |

**Decision points and simplifications**

- “Adjustment” is never a generic edit: users choose a reason and provide evidence when policy requires it.
- Transfers use one bilateral movement record. Receiving confirms the same transfer; the product does not create unrelated removal and addition entries.
- Par-level replenishment creates a proposed work item, not an automatic unexplained adjustment.

**Failure and recovery**

- Scan ambiguity: show permitted item choices and retain entered quantity.
- Stale expected quantity: accept the count as an observation, then flag reconciliation if current stock moved meanwhile.
- Offline conflict: preserve submitted observation/movement, compare against authoritative history, and require a manager decision only for material conflict.

**Notifications**

- Notify receiving location for transfers, inventory manager for material variance or failed sync, and service operators when a shortage/replenishment is resolved.

**Permission and audit boundary**

- Scoped operators count and propose transfers. Inventory managers reconcile and approve adjustments. High-value/negative adjustments need explicit dual authority where policy requires it.
- Audit: count session, scan/manual entry, transfer initiated/received, adjustment reason/evidence, reconciliation decision, variance disposition.

**State machine**

Count: `Assigned → In progress → Submitted → Reconciliation required (optional) → Reconciled`.

Transfer: `Draft → Requested → Dispatched → Received → Reconciled`, with `Disputed`, `Cancelled`, and `Pending sync` exceptions.

## 11. Request and monitor vendor staffing

| Item | Definition |
|---|---|
| Primary users | Vendor manager; workforce scheduler; event operations manager |
| Context | Event, venue/team/service area, required role/quantity/time, approved vendor scope |
| Trigger | Internal coverage is insufficient, contract plan calls for vendor labor, or a planned vendor commitment changes |
| Required information | Staffing need, role/qualification, quantity, shift time/location, vendor, response deadline, rate/approval reference if required, event instructions |
| Offline policy | Offline-readable; offline-writable for draft request capture; online-only for vendor dispatch, commitment, and policy approval |
| Minimum meaningful steps | 1. Identify uncovered demand. 2. Create request from the gap. 3. Select approved vendor and response deadline. 4. Send after required approval. 5. Monitor commitment, named assignments, arrival, and fulfillment. |
| Completion criteria | Staffing demand is filled by eligible confirmed people, explicitly accepted risk, or a visible unresolved gap with an accountable escalation owner. |

**Decision points and simplifications**

- The request starts from a staffing gap when possible, avoiding re-entry of time, location, and required role.
- Vendor commitment and named-person assignment are different states. A committed quantity is not proof of individual eligibility or attendance.
- A vendor cannot access broader venue information than the request and instructions require.

**Failure and recovery**

- Vendor declines or misses deadline: return the gap to Staffing, suggest alternate approved vendors, and escalate by event proximity.
- Named person fails validation: request replacement without exposing unnecessary personal or operational data.
- Vendor integration unavailable: preserve the internal request and use an auditable manual response path.

**Notifications**

- Notify vendor manager at send, response deadline, partial commitment, and fulfillment risk; notify scheduler/supervisor as coverage changes.

**Permission and audit boundary**

- Schedulers initiate requests; vendor managers communicate and manage commitments; event managers approve exception or spend-bound requests; vendors see only their assigned request scope.
- Audit: gap source, request created/sent, approval, vendor response, commitment, named assignment, validation outcome, cancellation, fulfillment outcome.

**State machine**

`Draft → Approval required (optional) → Sent → Acknowledged → Partially committed/Committed → Assigned → Fulfilled`

Exceptions: `Declined`, `Expired`, `At risk`, `Cancelled`, `Replacement required`.

## 12. Close out an event and review results

| Item | Definition |
|---|---|
| Primary users | Event operations manager; supervisor; inventory manager; executive/regional operator |
| Context | Event after its operational end; desktop/tablet review with mobile capture for last-mile work |
| Trigger | Event end milestone, manager initiates closeout, or closeout deadline begins |
| Required information | Open work and issues, attendance exceptions, service fulfillment exceptions, stock reconciliation status, required evidence, summary notes, follow-up owners, outcome measures |
| Offline policy | Offline-readable; offline-writable for closeout notes/evidence capture; final closeout is online-only because it validates all required current state |
| Minimum meaningful steps | 1. Review automatically assembled exceptions. 2. Resolve, defer with owner/due date, or document accepted exception. 3. Confirm required attendance/service/stock closeout. 4. Record outcome summary. 5. Finalize closeout. |
| Completion criteria | Required closeout checks pass, unresolved work has an explicit owner and due date, event results are available for authorized review, and the event is locked against ordinary operational changes. |

**Decision points and simplifications**

- Closeout collects operational evidence already captured during the event; it does not require staff to duplicate status reports.
- An event can close with follow-up work only when policy permits and each item has a named owner, deadline, and reason.
- Do not force a narrative report when structured exceptions and outcomes already explain the event. Summary notes are concise and optional unless policy requires them.

**Failure and recovery**

- Required reconciliation incomplete: route directly to the responsible item; do not allow a misleading final state.
- Disputed issue or handoff: keep the event in closeout, preserve all evidence, and assign adjudication.
- Finalization fails: retain the checklist and entered summary; show the blocking current-state mismatch.

**Notifications**

- Notify follow-up owners on assignment and before due date; notify event manager of incomplete closeout; publish authorized outcome summary to regional/executive users after finalization.

**Permission and audit boundary**

- Supervisors complete scoped closeout tasks; inventory managers reconcile stock; event managers finalize; executives review but do not amend operational records.
- Audit: closeout opened, check completed, exception accepted, follow-up created, summary submitted, finalization, post-close correction.

**State machine**

`Live → Closeout started → Reconciliation → Ready to finalize → Closed`

Exceptions: `Follow-up required`, `Disputed`, `Finalization failed`. A closed event supports reasoned, audited post-close correction addenda that append history and never erase or mutate original records. The current implementation records the addendum; affected operational records remain locked.

## Cross-workflow authority boundaries

| Decision | Minimum authority |
|---|---|
| Submit evidence for assigned work | Scoped assignee |
| Reassign ordinary work | Scoped supervisor |
| Accept a material readiness exception | Event manager or designated delegate |
| Publish/withdraw shifts | Workforce scheduler or authorized supervisor |
| Override qualification/compliance warning | Explicitly authorized scheduling role with reason |
| Correct attendance | Scoped supervisor with reason |
| Change issue severity or accept operational risk | Scoped supervisor/event manager according to severity |
| Approve high-value order or stock adjustment | Policy-designated approver |
| Finalize event closeout | Event operations manager or delegated authority |
| Change organization access policy | Organization administrator |

## Cross-workflow notifications

Notification rules should be based on state change and accountable action, not all activity:

1. Notify the owner on assignment, reassignment, new blocker, or impending deadline.
2. Notify the reporter/requester on meaningful progress, resolution, rejection, or material change.
3. Escalate only when a severity, response threshold, or deadline requires it.
4. Bundle low-urgency updates; never bundle a safety-critical or event-imminent exception.
5. Suppress duplicate notices when the user is actively viewing or has already acted on the same current state.

## Phase 3 acceptance criteria

Phase 3 is ready for approval when the product owner confirms that:

1. Each of the twelve critical workflows has a defined primary user, context, trigger, required information, minimum meaningful steps, and completion criteria.
2. Each workflow has explicit recovery paths for failed, stale, conflicting, or unavailable data.
3. Offline behavior is classified and explains how pending work, idempotency, conflict, and user recovery work.
4. Approval, acknowledgement, confirmation, ownership, and audit events are defined as distinct concepts.
5. Every meaningful state transition has a named actor and authorization boundary.
6. Event preparation, staffing, Event Command, service, stock, and closeout use shared work concepts instead of parallel task systems.
7. A critical issue, staffing gap, service shortage, or inventory discrepancy can be traced from creation through accountable resolution or follow-up.
8. The proposed state machines are accepted as the product vocabulary to validate in Phase 4 wireframes.

## Phase 4 handoff

Once approved, Phase 4 will turn these flows into low-fidelity responsive wireframes and interaction definitions, including loading, empty, offline, stale, error, permission-denied, and completion states across phone, tablet, and desktop.
