# Venue Wrangler Enterprise — Phase 2: Information Architecture

## Decision summary

Venue Wrangler is organized around **operational context and user intent**:

1. **Today** is the personal starting point for planned and live work.
2. **Event Command** is the shared, real-time coordination surface for an event.
3. Planning, staffing, service, and stock are focused workspaces reached only by roles who perform that work.
4. Venue structure, people, access, and integrations are administration work, grouped under **Settings** rather than exposed during event execution.

The product does not use a universal navigation menu. Access policy determines what a user may do; role, active venue, active event, device size, and current assignment determine what is surfaced first.

## Context that persists across every surface

Every screen retains enough context to answer: “where am I operating?”

| Context | Behavior |
|---|---|
| Organization | Fixed for ordinary users; switchable only for authorized multi-organization users. |
| Venue | Selected automatically when a user has one venue. A compact switcher appears for users with multiple allowed venues. |
| Event | Defaults to the current live event, then the next assigned event. A clear event picker is available whenever a view is event-scoped. |
| Role lens | Derived from the user’s active responsibility and scope. A person with multiple roles may switch lens; this changes recommendations and navigation emphasis, never grants. |
| Sync state | A visible but quiet indicator reports current, stale, pending, or failed synchronization. It expands to a recovery queue when action is needed. |

The context bar must never conceal whether an action affects a venue, event, or location. Destructive or high-consequence actions name that scope in their confirmation.

## Top-level destinations

| Destination | User goal | Primary users | Why it exists |
|---|---|---|---|
| Today | Know what to do now and complete personal work | All operational roles | Reduces searching across shifts, tasks, alerts, and assignments. It prioritizes the individual’s next action. |
| Event Command | Understand and direct the live event | Supervisors, event managers, regional operators | Provides a shared operational picture: readiness, milestones, blockers, incidents, ownership, and change. |
| Plan | Prepare an upcoming event | Event managers, supervisors, venue admins | Combines event setup, run-of-show, readiness checks, notes, and accountable work into one preparation workspace. |
| Staffing | Ensure the event has the right people | Workforce schedulers, supervisors, vendor managers | Unifies schedule coverage, availability, acknowledgement, attendance, and vendor staffing needs around the event. |
| Service | Execute hospitality and concessions work | Kitchen/concessions operators, supervisors, event managers | Follows an order from request through preparation, distribution, pickup, and confirmed handoff. |
| Stock | Maintain operational inventory | Inventory managers, kitchen/concessions operators | Gives counts, replenishment, transfers, adjustments, and reconciliation one operational home. |
| Insights | Review outcomes and direct follow-up | Executives, regional operators, venue admins | Supports cross-event comparison, exception review, operational closeout, and export. |
| Settings | Configure the operating environment and governance | Venue and organization administrators | Groups infrequent, high-control setup: venue structure, people, access, templates, integrations, and audit history. |

**Orders, issues, tasks, activity, vendors, and notifications are not top-level destinations.** They are work objects shown in the workspace where a user needs them. Global search and the command palette can retrieve any permitted object without encouraging module hopping.

## Role-specific navigation

### Frontline worker

**Primary question:** What do I need to do, where, and by when?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Today | Today |
| 2 | My shift | My shift |
| 3 | Report issue | Report issue |
| 4 | More: Event details, messages, profile | Event details, report issue, profile |

The frontline worker never receives a planning or operational command surface by default. “My shift” keeps location, instructions, check-in/out, breaks, assignments, and acknowledgment in one flow. Reporting an issue is always reachable in one action.

### Supervisor

**Primary question:** Is my team and area ready, and where do I need to intervene?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Today | Today |
| 2 | Team | Event Command: My area |
| 3 | Event | Team |
| 4 | More: Staffing, Service or Stock when scoped | Staffing |
| 5 |  | Service or Stock when scoped |

The supervisor’s Today emphasizes unacknowledged shifts, attendance exceptions, overdue readiness work, urgent issues, and tasks within their service area. Event Command opens filtered to that area and team rather than a whole-venue overview.

### Event operations manager

**Primary question:** Is the event ready and under control, and who owns every exception?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Command | Event Command |
| 2 | Today | Plan |
| 3 | Plan | Staffing |
| 4 | More: Staffing, Service, Insights | Service |
| 5 |  | Insights |

Event Command is the default landing point during a live event. Before event day, Today redirects attention to the next preparation deadline and opens Plan as the working surface.

### Workforce scheduler

**Primary question:** Where is coverage insufficient, who can fill it, and has the plan reached workers?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Today | Staffing |
| 2 | Staffing | Today |
| 3 | More: Team, Event | Team |
| 4 |  | Event Command: staffing lens |

Staffing holds the staffing timeline, coverage health, people availability, vendor request status, publishing state, acknowledgements, and day-of attendance. The scheduler does not need a separate “vendors” destination.

### Kitchen or concessions operator

**Primary question:** What must be prepared or handed off next, and do I have enough product to do it?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Today | Service |
| 2 | Service | Today |
| 3 | Stock | Stock |
| 4 | More: Event details, report issue | Event Command: service lens |

Service defaults to the active kitchen or outlet queue. Stock shows only relevant locations and urgent replenishment needs. Both preserve event and location context throughout the flow.

### Inventory manager

**Primary question:** What stock action is required now, and can I trust the recorded quantity?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Today | Stock |
| 2 | Stock | Today |
| 3 | More: Event, Insights | Event Command: stock lens |
| 4 |  | Insights |

The Stock workspace defaults to open counts, pending transfers, replenishment requests, and discrepancies. “Count,” “transfer,” and “adjust” are task-level actions rather than separate product destinations.

### Vendor manager

**Primary question:** Which requested staffing or service commitments are unfilled, late, or at risk?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Today | Staffing |
| 2 | Requests | Today |
| 3 | More: Event, Team | Event Command: vendor lens |
| 4 |  | Insights |

“Requests” is a filtered view of Staffing, not a separate vendor module. The desktop workspace adds commitment comparison, assignment details, bulk follow-up, and fulfillment reporting.

### Venue administrator

**Primary question:** Is the venue prepared with the right structure, people, policies, and reusable plans?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Today | Today |
| 2 | Event | Plan |
| 3 | More: Settings, Insights | Staffing |
| 4 |  | Insights |
| 5 |  | Settings |

Venue administrators see a compact mobile experience for event-day awareness and exception handling. Desktop is the deliberate configuration and governance environment.

### Organization administrator

**Primary question:** Are venues consistently configured, secured, and governed across the organization?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Today | Insights |
| 2 | Insights | Settings |
| 3 | More: Settings, Event | Today |
| 4 |  | Event Command: organization lens |

Organization administration is desktop-first. Mobile supports awareness, explicit approvals, and critical escalation only; it does not attempt to expose all configuration controls.

### Executive or regional operator

**Primary question:** Which events or venues need leadership attention, and what follow-up will improve outcomes?

| Order | Mobile navigation | Tablet/desktop navigation |
|---:|---|---|
| 1 | Today | Insights |
| 2 | Events | Event Command: portfolio lens |
| 3 | More: Insights | Today |
| 4 |  | Events |

This role sees evidence and exceptions, not administrative implementation detail. They can drill from portfolio signal to an event’s ownership, current state, and closeout actions.

## Responsive compositions

### Mobile: execution-first

Mobile navigation uses three to five task destinations, chosen per role. It uses bottom navigation for persistent primary tasks and a context-aware primary action for the one action a user is most likely to complete next.

- One primary task per screen; secondary detail is pushed into a bottom sheet or a subsequent screen.
- Large touch targets and short forms support use while moving.
- Event context appears as a compact, tappable header.
- Scanning, camera capture, location confirmation, and notification deep links enter task flows directly.
- A persistent issue-report action appears wherever the user can report an operational problem.
- Offline, pending, and failed work is shown in the same place a user completes work; it is never hidden behind settings.

### Tablet: coordination-first

Tablet supports on-floor command work. Persistent navigation is compact; screens use adaptive two-pane layouts.

- Left pane: queue, timeline, map, or work list.
- Right pane: selected work item, detail, evidence, ownership, and next actions.
- Event Command can combine readiness summary, area health, and issue list without forcing a screen change.
- Service and Stock can pair a fulfillment or count queue with the selected order or location.
- Touch interaction remains first class; keyboard shortcuts are additive for mounted or desktop-style setups.

### Desktop and web: planning-and-oversight-first

Desktop uses a persistent rail, contextual workspace header, and resizable panels.

- Data-rich workflows use saved views, column management, filters, bulk actions, and export where these reduce repetitive work.
- Event Command supports a multi-panel layout: status and milestones, active exceptions, selected detail, and activity stream.
- Staffing combines schedule timeline, coverage health, eligible people, and publication state.
- Plan combines event milestones, readiness work, dependencies, and ownership.
- Command palette, keyboard navigation, and fast object retrieval are available to authorized users.
- Dense and comfortable display modes are user preferences; neither changes the information architecture.

## Capability placement by user goal

| User goal | Primary surface | Supporting surfaces | Rationale |
|---|---|---|---|
| Complete assigned work | Today, My shift | Event details, Service, Stock | Keeps personal next actions together even when the underlying work differs. |
| Prepare an event | Plan | Staffing, Settings | Event planning connects readiness, milestones, owners, and dependencies before live operations begin. |
| Ensure coverage | Staffing | Today, Event Command | Staffing decisions belong with schedule and capacity; day-of exceptions appear in operational context. |
| Coordinate a live event | Event Command | Today, Plan, Staffing, Service, Stock | Gives shared state and ownership without collapsing specialized workspaces into a dashboard. |
| Fulfill hospitality/concessions work | Service | Stock, Event Command | Order execution needs a focused queue; shortages and escalation link back to stock and command. |
| Maintain inventory accuracy | Stock | Service, Insights | Inventory actions need location and audit context; service surfaces the consequence of shortages. |
| Configure venues and governance | Settings | Plan | Keeps structural configuration separate from execution, while templates can be applied during planning. |
| Learn from an event | Insights | Event Command, closeout | Links outcome measures to unresolved work, ownership, and follow-up. |

## Object model in the experience

Users should encounter a small set of consistent work objects:

| Object | Appears in | Required visible attributes |
|---|---|---|
| Work item | Today, Plan, Event Command | State, urgency, owner, due or timing, event/area context, next action |
| Shift | Today, Staffing | Person or slot, role, time, location, acknowledgement, attendance state |
| Issue | Event Command, Today | Severity, state, owner, location, time reported, escalation, next action |
| Order | Service, Event Command | Fulfillment state, timing, destination, owner, shortages or blockers, handoff status |
| Stock action | Stock, Service | Action type, quantity, source/destination, reason, actor, sync and reconciliation state |
| Event | Today, Plan, Event Command, Insights | Lifecycle state, milestone, readiness, active exceptions, scope |

The same status, owner, urgency, context, and activity components appear across these objects. A user does not need to learn different semantics for a task, issue, order, or transfer.

## Entry points and deep links

- Notifications open directly to the permitted work item and show the change that triggered the alert.
- QR code, barcode, and camera actions begin from the workflow that benefits from them: check-in, count, transfer, evidence capture, or order handoff.
- Search and the command palette return objects, actions, and saved views allowed by the user’s current scope.
- Links preserve organization, venue, event, and source context. If access or context has changed, the user receives an explanation and a safe nearby destination.

## Phase 2 acceptance criteria

Phase 2 is ready for approval when the product owner confirms that:

1. Each role has a distinct default destination and no role receives a universal dashboard by default.
2. Each top-level destination maps to a durable user goal and has a stated reason to exist.
3. The mobile, tablet, and desktop structures materially change composition for execution, coordination, and planning.
4. No candidate capability is promoted to navigation merely because it maps to a database entity.
5. The context model makes organization, venue, event, role lens, and sync state understandable at the point of action.
6. Cross-cutting objects have consistent states, ownership, urgency, location, and history semantics.
7. A user can reach their top three frequent actions within two interactions from their default destination.
8. The navigation can accommodate explicit permission denial, stale data, pending sync, and changed assignments without orphaning the user.

## Phase 3 handoff

Once approved, Phase 3 will turn the twelve requested critical workflows into detailed flow definitions: actor and context, trigger, minimum meaningful steps, decision points, recovery and offline behavior, notifications, permission boundaries, audit events, completion criteria, and state machines.
