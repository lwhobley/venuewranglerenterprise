# Tenant Isolation

Venue Wrangler enforces tenant isolation in the NestJS API and keeps the production data path server-mediated. Every public table also has Supabase Row Level Security enabled with no client policies, while table, sequence, and function privileges are revoked from `anon` and `authenticated`. This makes the Supabase Data API fail closed; the Cloud Run API connects with its database role and remains the only application data path.

The API-level controls are:

- `AuthGuard` protects routes by default and requires a revocable session row.
- `VenueScopeInterceptor` resolves the caller's active profile and venue once per request.
- Controllers must use `request.venueScope.venueId` or a manager profile lookup as the source of truth, never a client-supplied `venueId`.
- Public webhook routes must authenticate with a per-connection secret and rate limit by IP and venue.

Before enabling any direct Supabase client access, add narrowly scoped SQL policies and tests that prove users can only read and mutate rows for their active venue. Do not grant broad table access or disable the fail-closed RLS backstop.

## Database-layer backstop (enforced by default)

As defense-in-depth for the manual `where: { venueId }` controls above, a Prisma
Client extension scopes venue-owned models to the request's tenant
automatically. It is inert without a bound tenant context (auth flows,
webhooks, system/background tasks). Production rejects startup when
`TENANT_ISOLATION_ENFORCED=false`; local and staging environments may use that
value temporarily for diagnosis.

| File | Responsibility |
|------|----------------|
| `prisma/tenant-context.ts` | `AsyncLocalStorage` holding the request's `venueId` (`enterTenant`, `runWithTenant`, `getTenantVenueId`). |
| `prisma/tenant-scope.ts` | Pure logic: the venue-scoped model set + `scopeArgs()` (AND venueId into `where`, force it onto creates). Exhaustively unit-tested. |
| `prisma/tenant-isolation.extension.ts` | The Prisma extension; no-op without a tenant context or for unscoped models/operations. |
| `prisma/tenant-scope.spec.ts` | DB-free unit tests incl. security invariants (hostile venueId can't widen scope). |
| `prisma/tenant-isolation.integration.spec.ts` | End-to-end isolation proof against real Postgres (skips without a test DB). |

### Design notes

- **AND, never replace.** A caller-supplied `venueId` is AND-ed with the tenant
  predicate, so a hostile `where: { venueId: other }` matches nothing instead of
  escaping scope.
- **Creates force venueId.** A `create`/`createMany` can never write into another tenant.
- **Unique-keyed ops are scoped too.** `findUnique`/`findUniqueOrThrow`/`update`/
  `delete`/`upsert` keep their unique selector at the top level and gain the tenant
  column as an extended unique filter (`mergeUniqueScopeWhere`), so a client-supplied
  id from another tenant matches nothing. Covered by `tenant-scope.spec.ts`. An
  earlier version of this document described these as pass-through; that is no
  longer true.
- **Inert by default.** No tenant context ⇒ no-op. Auth flows, webhooks, and
  system/background tasks (which legitimately cross venues) are unaffected.

### Residual-gap audit (2026-09-16)

The extension cannot help where it does not apply, so every remaining path was
audited by hand:

1. **Routes with no tenant context** (`@Public()`): enterprise SSO start/callback/
   exchange, billing webhooks, invite preview, BEO hub ingest, chat image and
   checklist photo links, leads/POS/reservation ingest, realtime stream, workforce
   invite check and venue search. Each authenticates with a per-venue secret, a
   signed media token bound to the record and its venue, a single-use stream ticket,
   or is disabled. No client-supplied id reaches a tenant model unchecked.
2. **Background work**: the async-write worker binds tenant context with
   `runWithTenant`; the kitchen distro and reservation schedulers only act on rows
   they loaded themselves and apply the row's own tenant settings in the transaction.
3. **Models outside the scoped sets**: 20 unique-keyed calls on 9 models without a
   `venueId`/`facilityId` column or on the wildcard list (`OrganizationMembership`,
   `ScopeAssignment`, `EnterpriseSsoProvider`, `EnterpriseSsoGroupRoleMapping`,
   `EnterpriseSsoIdentity`, `EnterpriseSsoLoginRequest`, `EnterpriseSsoLoginTicket`,
   `FloorTable`, `VmsOrderFulfillment`). Each is keyed by organization + user,
   provider + subject, or a hashed one-time secret, or is preceded by an ownership
   check on the owning organization, venue floor plan, or facility.

One defect was found and fixed: the SAML request cache looked requests up by
`samlRequestId` alone, so a request started with one SSO provider validated for
another. `getAsync` and `removeAsync` now require the cache's `providerId`
(`enterprise-sso.service.spec.ts`).

Re-run this audit when adding a model without a tenant column, a wildcard model,
or a `@Public()` route. It is a manual review, not a CI check, so new call sites
are not caught automatically.

### Enablement (fail-closed by default)

Both pieces are active by default. The literal string `"false"` disables them
only when `NODE_ENV` is not `production`; production fails startup instead.

1. **`prisma.service.ts`** — unless disabled, the service applies the
   extension via `this.$extends(tenantIsolationExtension())` and wraps itself in
   a `Proxy` that delegates Prisma calls to the extended client while keeping
   Nest lifecycle hooks on the wrapper. This preserves the `PrismaService`
   injection token across the codebase. `$transaction`'s `tx` callback is also
   extension-aware, so transactional writes are scoped.
2. **`auth.guard.ts`** — unless disabled, when the token carries a `venueId`,
   `enterTenant(venueId)` binds the AsyncLocalStorage tenant context for the
   rest of the request. Tokens without a venueId (auth flows, system tasks)
   stay unscoped, which is correct.

Production incident response: roll back to the last known-good Cloud Run
revision. Do not disable the isolation layer in a production revision.
