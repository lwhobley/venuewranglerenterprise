# Venue Wrangler Enterprise — Phase 5: Visual System

## Design direction

The visual system is **arena fieldbook**: calm, tactile operational surfaces with deep pine for durable context, bright paper for focus, brass for emerging attention, and coral for event-day risk. It avoids a generic dashboard through strong event context, compact operational language, and visible accountability.

## Semantic color tokens

| Token | Value | Use |
|---|---:|---|
| `surface.canvas` | `#F6F4EF` | App background |
| `surface.primary` | `#FFFDF9` | Cards, detail panels, forms |
| `text.primary` | `#16261F` | Main text and persistent rail |
| `action.primary` | `#1D5A43` | Primary completion action, confirmed state |
| `status.ready` | `#1D5A43` | Complete, current, confirmed |
| `status.attention` | `#C88A2B` | Due soon, review required, at risk |
| `status.blocked` | `#C74B37` | Blocked, overdue, service impact |
| `status.information` | `#245F9D` | In progress, queued, pending review |
| `status.neutral` | `#59645D` | Supporting metadata and inactive state |
| `accent.mint` | `#B9E7CC` | Dark-surface emphasis and selected navigation |

Color is always paired with a text label and semantic icon. Dark mode preserves semantic relationships rather than inverting every literal value.

## Typography and spacing

| Role | Specification |
|---|---|
| Event context label | 12 px, 800 weight, 1.4 px tracking, uppercase |
| Page title | 30–34 px, 900 weight |
| Section title | 20–22 px, 800 weight |
| Work item title | 16–18 px, 800 weight |
| Body | 14–16 px, regular |
| Operational metadata | 12–14 px, medium, high contrast neutral |
| Base spacing unit | 4 px; component rhythm uses 8, 12, 16, 20, 24, 32 px |

The compact density mode reduces panel padding and row height while retaining 44 px touch targets. Comfortable is the default for tablet and touch desktop.

## Component rules

| Component | Required state/content |
|---|---|
| Work item | Status, due context, owner, location/event, next action |
| Status pill | Semantic icon, text state, optional urgency; never color alone |
| Context header | Organization/venue, event, role lens, sync state when non-current |
| Primary action | A single next permitted action; changes after completion |
| Detail panel | Object identity, current state, owner, activity, and relevant actions |
| Sync feedback | Current, stale, pending, failed, and conflict state with recovery path |
| Table/list | Saved-view title, filter context, selection count, empty/loading state |

## Prototype scope

The prototype in `prototype/venue_wrangler_prototype` implements representative local interactions for role switching, navigation, shift acknowledgement, check-in feedback, Event Command issue detail, planning readiness, schedule publication feedback, service pack confirmation, and stock count submission.

It intentionally uses local state only. Server authorization, durable offline storage, real-time updates, APIs, and audit persistence remain Phase 6 implementation work.
