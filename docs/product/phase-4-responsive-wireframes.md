# Venue Wrangler Enterprise — Phase 4: Responsive Wireframes and Interaction Design

## Scope and fidelity

These are low-fidelity behavior and hierarchy wireframes. They validate task order, context, status, ownership, recovery, and responsive composition before visual styling. Labels use representative event-day content so reviewers can judge operational comprehension without placeholder data.

**Shared specimen:** Harbor City Arena · Storm vs. Comets · Doors 6:30 PM · Event start 7:30 PM.

## Design decisions validated in this phase

1. **Today is personal; Event Command is shared.** Workers open their next task, while supervisors and managers coordinate the event from a distinct surface.
2. **A work item is the universal actionable unit.** Its status, urgency, owner, venue/event/location context, next action, and history remain legible in every layout.
3. **Urgency is specific.** “Due in 12 min,” “unassigned,” “blocked by refrigeration,” and “sync pending” are more useful than a generic red badge.
4. **Mobile completes; tablet coordinates; desktop plans and supervises.** The same workflow keeps its state and terminology but changes composition.
5. **Failure states preserve work.** Pending, stale, failed, no-access, and conflict states appear in the working surface, not only in a global settings page.

## Responsive frame rules

| Viewport | Navigation | Working composition | Primary interaction |
|---|---|---|---|
| Phone: 320–599 px | 3–5 role-specific bottom destinations | One task or queue at a time; detail pushes forward | Thumb action, scan/camera, short form, persistent issue report |
| Tablet: 600–1023 px | Compact rail or bottom navigation depending on orientation | List/map/timeline plus selected detail | Touch-first split view, quick reassignment, command queue |
| Desktop: 1024 px+ | Persistent rail and workspace header | Resizable multi-panel workspace | Keyboard navigation, saved views, bulk review, filtering, command palette |

Every layout has a visible context strip: `Harbor City Arena  ›  Storm vs. Comets  ›  Concessions` when event and location apply. A sync indicator appears in the strip only when stale, pending, or failed; it stays quiet when current.

## Wireframe 1: Frontline Today and shift acknowledgement (phone)

**Workflow coverage:** view and acknowledge shift; check in/out; report issue.

```text
┌──────────────────────────────────────┐
│ Harbor City Arena             Current │
│ Storm vs. Comets · Doors 6:30 PM      │
├──────────────────────────────────────┤
│ Good afternoon, Maya                  │
│ Your next action                       │
│ ┌──────────────────────────────────┐ │
│ │ ACKNOWLEDGE SHIFT        Due now │ │
│ │ Suite 14 service · 5:45–10:30 PM │ │
│ │ Meet: East service corridor      │ │
│ │ [Review shift]                   │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Today                                │
│ ○ Complete allergen station check    │
│   5:55 PM · Suite 14 · Assigned to me│
│ ○ Check in opens at 5:35 PM           │
│                                      │
│ Need help? [Report an issue]          │
├──────────────────────────────────────┤
│ Today       My shift      More        │
└──────────────────────────────────────┘
```

Selecting **Review shift** opens a focused sequence, with progress and a visible back path:

```text
┌──────────────────────────────────────┐
│ ‹ Today              Shift details    │
├──────────────────────────────────────┤
│ Suite 14 service                       │
│ Fri, Sep 25 · 5:45–10:30 PM           │
│ East service corridor · Report to Eli │
│                                      │
│ Before you arrive                     │
│ • Black uniform and service kit       │
│ • Review suite dietary notes           │
│                                      │
│ Shift changed 18 min ago               │
│ Location updated from North corridor   │
│                                      │
│ [Acknowledge this shift]              │
│ [I have a conflict]                   │
└──────────────────────────────────────┘
```

After acknowledgement, the primary action changes to **Check in** only when eligible. The check-in receipt shows `Recorded at 5:42 PM` or `Pending sync · recorded locally at 5:42 PM`; it never implies server confirmation while offline.

## Wireframe 2: Event Command (tablet)

**Workflow coverage:** monitor readiness; report/assign/escalate/resolve issue; attendance exception follow-up.

```text
┌────────┬───────────────────────────────┬───────────────────────────────┐
│ Today  │ Storm vs. Comets               │ ISSUE · Refrigeration fault   │
│ Command│ Doors in 42 min · At risk      │ Suite 14 pantry               │
│ Team   ├───────────────────────────────┤ Reported 6:02 PM by Maya      │
│ Staffing│ READINESS       LIVE WORK     │ Severity: Service impact      │
│ Service │ 7/9 required checks complete  │ Owner: Unassigned             │
│ Stock   │                               │ [Assign owner] [Escalate]     │
│        │ BLOCKED                         │                               │
│        │ ● Suite 14 refrigeration       │ Activity                      │
│        │   No owner · due 6:15 PM       │ 6:05 Priya: “Vendor called”   │
│        │                               │ [Add update] [Resolve]        │
│        │ ATTENTION                       │                               │
│        │ ○ 2 unacknowledged shifts      │                               │
│        │ ○ West Gate setup due in 12 min│                               │
└────────┴───────────────────────────────┴───────────────────────────────┘
```

The middle pane is a filterable operational queue. The selected item remains in context on the right, so a supervisor can assign ownership and add an update without losing the wider readiness picture.

**Tablet interaction rules**

- Tap an item to select; swipe only for non-destructive triage actions.
- Long press opens contextual actions only if a visible action button is unavailable.
- Map/floor-plan mode replaces the middle queue, while the detail pane remains stable.
- A high-severity issue opens as a full-screen interruption only when it requires immediate acknowledgment; ordinary issues stay in the queue.

## Wireframe 3: Event Plan and readiness (desktop)

**Workflow coverage:** prepare an upcoming event; monitor readiness; event closeout preparation.

```text
┌──────────────┬──────────────────────────────────────┬────────────────────────────┐
│ Logo         │ Storm vs. Comets       Sep 25, 7:30  │ Event health               │
│ Today        │ [Plan] [Command] [Activity]          │ 2 blockers · 7/9 complete  │
│ Event Command├──────────────────────────────────────┤────────────────────────────┤
│ Plan         │ Milestones             Readiness work │ Selected: Suite 14 setup  │
│ Staffing     │ 2:00 PM Plan lock      □ Suite 14... │ Due 6:15 PM · Blocked      │
│ Service      │ 5:30 PM Staff arrival  □ West Gate...│ Owner: Unassigned          │
│ Stock        │ 6:30 PM Doors          ✓ Concourse...│ Blocked by: refrigeration  │
│ Insights     │ 7:30 PM Event start    ✓ POS verify  │ [Assign] [Escalate]        │
│ Settings     │ 10:00 PM Closeout      ...           │                             │
│              │                                      │ Dependencies                │
│              │ [Add readiness work]                  │ • Vendor repair ETA         │
└──────────────┴──────────────────────────────────────┴────────────────────────────┘
```

**Plan actions**

- Add readiness work defaults to the active event, selected venue area, and next relevant milestone.
- A required item without an owner is visibly blocked; a manager may assign, change due time, or accept an exception with a reason.
- The Plan screen shows history only in the detail panel. It does not duplicate the Event Command activity stream as a competing feed.

## Wireframe 4: Staffing coverage and publication (desktop)

**Workflow coverage:** build/publish workforce schedule; vendor staffing; shift acknowledgement follow-up.

```text
┌──────────────┬─────────────────────────────────────┬─────────────────────────────┐
│ Navigation   │ Staffing · Storm vs. Comets          │ Coverage health             │
│              │ Sep 25     [Draft] [Publish 12]      │ 94% filled · 3 exceptions   │
│              ├─────────────────────────────────────┤                             │
│              │ Time    Suite 14       West Gate     │ UNFILLED                    │
│              │ 5:30    Maya ✓         Open ×        │ West Gate lead              │
│              │ 6:00    Priya ✓        Vendor slot   │ 5:30–10:00 · Due today      │
│              │ 6:30    ...             ...          │ [Find eligible people]      │
│              │                                     │ [Request vendor staffing]   │
│              ├─────────────────────────────────────┤                             │
│              │ Eligible people                      │ ACKNOWLEDGEMENT              │
│              │ [Search] [Qualification: all]        │ 2 workers need review       │
│              │ Jordan Lee · available · certified   │ [Send reminder]              │
└──────────────┴─────────────────────────────────────┴─────────────────────────────┘
```

Publication opens a review sheet, never an immediate send:

```text
Publish schedule changes
12 people will receive a shift or material-change notice.
2 open slots remain visible to supervisors.
[Back]                                           [Publish 12 changes]
```

The scheduler can make drafts offline when the schedule is cached, but the publish action is disabled with a clear “Reconnect to validate qualifications and send notices” explanation.

## Wireframe 5: Service fulfillment and handoff (tablet)

**Workflow coverage:** create/execute hospitality order; kitchen distribution and pickup; service shortage.

```text
┌────────┬───────────────────────────────┬───────────────────────────────┐
│ Today  │ Suite service queue            │ Order HC-1842                 │
│ Service│ [All] [Due next] [At risk]     │ Suite 14 · Due 6:45 PM        │
│ Stock  ├───────────────────────────────┤ 12 guests · Dietary notes     │
│        │ READY                           │                               │
│        │ HC-1842 · Suite 14 · 6:45      │ Items                         │
│        │ 12 guests · Runner needed      │ ✓ 12 beverage packs           │
│        │                               │ × 1 gluten-free tray          │
│        │ PREPARING                       │ [Report shortage]             │
│        │ HC-1847 · Sponsor Lounge       │                               │
│        │ 18 guests · due in 22 min      │ [Pack confirmed]              │
│        │                               │ [Ready for pickup]            │
│        │ AT RISK                         │                               │
│        │ HC-1839 · Shorted: ice         │                               │
└────────┴───────────────────────────────┴───────────────────────────────┘
```

When the runner selects **Ready for pickup**, the item moves to `Ready` only after pack confirmation. The runner’s pickup and destination handoff are separate actions. If connectivity is lost, the screen shows the exact action awaiting synchronization, preserving order ownership.

## Wireframe 6: Inventory count and transfer (phone and desktop)

**Workflow coverage:** count, transfer, replenish, reconcile inventory.

Phone count flow:

```text
┌──────────────────────────────────────┐
│ ‹ Stock             Count: East bar   │
├──────────────────────────────────────┤
│ 7 of 18 items                         │
│                                      │
│ Sparkling water · 24-pack             │
│ Expected: 18                          │
│                                      │
│            [ − ]  12  [ + ]           │
│                                      │
│ [Scan next]           [Save count]    │
│                                      │
│ Sync pending · 2 saved observations   │
└──────────────────────────────────────┘
```

Desktop reconciliation:

```text
┌──────────────┬──────────────────────────────────────┬───────────────────────────┐
│ Stock        │ East bar count · Submitted            │ Variance review            │
│ Counts       │ Item               Expected  Count     │ Sparkling water            │
│ Transfers    │ Sparkling water       18      12       │ Variance: -6               │
│ Replenishment│ Premium soda          24      24       │ [Confirm count]            │
│              │ Ice bags              10       8       │ [Request recount]          │
│              │                                      │ [Create replenishment]     │
└──────────────┴──────────────────────────────────────┴───────────────────────────┘
```

The count records an observation, never silently overwriting stock. A material variance becomes a reviewable reconciliation decision with evidence and actor attribution.

## Core screen state library

Every workspace uses the following patterns. Copy and action vary by workflow; the relationship between state and recovery does not.

| State | Wireframe behavior | Required action/recovery |
|---|---|---|
| Loading | Skeleton preserves the final layout and context header; no misleading empty result | Continue rendering cached authorized data with “Updating” when available |
| Empty | Explain why no work exists and the next meaningful path | Example: “No tasks due in your next shift. View shift details.” |
| Offline-readable | Context strip shows `Offline · updated 6:02 PM`; cached data remains visibly dated | Offer refresh when connection returns; block current-data actions with reason |
| Offline-writable pending | Work item/action has `Pending sync` beside its current state | Open the outbox detail; allow retry, edit before send, or cancel only when safe |
| Stale | Current status is softened; health summaries avoid definitive claims | Name the as-of time and affected scope; offer refresh |
| Failed action | Inline preserved form/data with plain failure explanation | Retry, edit, request support, or resolve permission/context mismatch |
| Conflict | Side-by-side “your submitted observation” and “current record” | Choose permitted reconciliation action; never discard local input automatically |
| Permission denied | Explain which scope is unavailable without exposing protected data | Return to nearest permitted event/venue or request access from named administrator |
| Completed | Show confirmation, recorded time, and next logical work | Provide an undo only for reversible, policy-approved operations |

## Interaction specifications

### Work item card

```text
┌──────────────────────────────────────┐
│ BLOCKED · Due in 12 min               │
│ Suite 14 refrigeration                 │
│ Owner: Unassigned · Suite 14 pantry   │
│ Blocked by vendor repair ETA           │
│ [Assign owner]                         │
└──────────────────────────────────────┘
```

- Status is text plus a semantic icon; color reinforces it and never carries meaning alone.
- The primary button is the next permitted action. Secondary actions remain in an overflow only when they are not time-critical.
- A card is tappable for detail but does not hide the primary action behind the detail screen.

### Ownership and reassignment

- Assignment first presents the currently accountable team, eligible people, workload, availability, and qualification state.
- Selecting an owner asks for a reason only if an owner is being replaced, a deadline has passed, or policy requires it.
- Reassignment generates an activity event and tells the outgoing owner why they no longer own the work.

### Escalation

- Escalation captures impact, desired response time, and target escalation path; it does not ask users to recreate the original issue.
- The initial owner remains visible. Escalation either changes owner or adds an accountable escalation owner; the screen states which occurred.

### Command palette and search

- Desktop command palette supports actions (“Report issue”, “Start count”), permitted object retrieval, and saved views.
- Search results are grouped by event, work item, person, order, and location. Results show only permitted context and do not reveal the existence of inaccessible records.

## Cross-device workflow walkthroughs

The following walkthroughs were reviewed against the responsive rules. “Revised” records a design correction made before visual styling.

| Workflow | Phone execution | Tablet coordination | Desktop planning/oversight | Revision from review |
|---|---|---|---|---|
| Configure organization/venue | Review activation requests only | Review venue structure when on site | Full setup, templates, people/access | Kept configuration desktop-first; mobile has no dense setup hierarchy |
| Prepare event | Update assigned readiness evidence | Review area readiness and assign work | Build plan, dependencies, milestones | Removed a separate readiness checklist destination; Plan and Command use the same items |
| Build/publish schedule | Review individual shift exceptions | Fill a local coverage gap | Timeline, eligibility, bulk publication | Added publication review so notifications are explicit |
| View/acknowledge shift | Read, acknowledge, conflict | Supervisor sees acknowledgement exceptions | Scheduler audits acknowledgement gaps | Reset acknowledgement only for material changes |
| Check in/out | One primary action, exception route | Supervisor corrects in context | Attendance review and exception queue | Split recorded/pending status to avoid false success offline |
| Monitor readiness | View personal assigned checks | Filtered area command view | Cross-area plan/command view | Replaced unexplained readiness score with visible causes |
| Report/resolve issue | Three-field fast report, camera | Triage, assign, update | Portfolio review and policy controls | Reporter can file first; classification improves later |
| Hospitality order | View/accept assigned handoff | Prepare and hand off queue | Create/change order, service oversight | Unified order lifecycle instead of copied tickets |
| Kitchen distribution/pickup | Confirm pickup/handoff | Queue and preparation detail | Service performance and exception review | Separated pack confirmation from pickup to retain custody history |
| Inventory movement | Scan/count/submit locally | Count and transfer queue | Reconcile, approve adjustments, analyze variance | Count is an observation; it does not overwrite stock silently |
| Vendor staffing | Receive scoped assignment or request status | Coordinate current commitment | Request, approval, comparison, fulfillment | Commitment is distinct from named worker validation |
| Event closeout | Capture final evidence/follow-up | Resolve area exceptions | Finalize and review outcomes | Auto-assembled closeout avoids duplicate event reports |

## Accessibility and responsive verification criteria

- Every primary action has a text label and an accessible name; icon-only controls have a visible tooltip on pointer devices and semantic label everywhere.
- Phone action targets are at least 44 × 44 logical pixels and remain reachable above the navigation bar.
- No status relies on color alone; text, icon, and state label persist in high-contrast and dark modes.
- Keyboard users can enter, navigate, and exit every desktop panel; focus moves predictably after status changes, assignment, or dialog dismissal.
- Screen readers announce state changes once, with the work item identity and consequence; live updates do not interrupt active data entry except for critical alerts.
- At 200% browser zoom and large device text, panels reflow without horizontal loss of primary actions or context.
- Reduced-motion mode replaces animated status transitions with an immediate state change and concise announcement.

## Phase 4 acceptance criteria

Phase 4 is ready for approval when the product owner confirms that:

1. Phone, tablet, and desktop layouts make materially different use of navigation, density, and panels.
2. Frontline workers can acknowledge a shift, check in/out, complete assigned work, and report an issue without navigating through an admin surface.
3. Supervisors can see readiness, ownership, blockers, and issue detail at the same time on tablet.
4. Desktop planning supports event preparation, staffing coverage, publication review, and closeout without forcing repeated context switching.
5. Service and stock flows preserve an accountable custody/history trail through preparation, handoff, count, and reconciliation.
6. Loading, empty, offline, pending, stale, failed, conflict, permission-denied, and completed states have a defined presentation and recovery action.
7. The cross-device walkthrough does not create duplicate task, issue, order, or inventory systems.
8. The interaction patterns meet the stated accessibility and responsive criteria before visual-system work begins.

## Phase 5 handoff

Once approved, Phase 5 will translate these wireframes into the original visual system: semantic tokens, typography, layout grid, component states, light/dark themes, and a realistic interactive prototype using representative operational data.
