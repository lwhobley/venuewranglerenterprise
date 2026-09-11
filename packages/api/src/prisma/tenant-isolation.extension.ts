import { Prisma } from '@prisma/client';
import { getTenantContext } from './tenant-context';
import { scopeArgs, scopeFieldForModel, scopeIdForField, shouldScopeOperation } from './tenant-scope';
import { getBoundTenantTx, modelDelegateName } from './tenant-request-transaction';

/**
 * Prisma Client extension that enforces tenant isolation as a database-layer
 * backstop to the existing manual `where: { venueId }` filters.
 *
 * Behaviour, checked in this order:
 *   1. Scope args against the bound tenant (AND venueId/facilityId into where,
 *      force it onto creates/updates) whenever a tenant context is present.
 *   2. A request-scoped raw tenant transaction is bound (see
 *      tenant-request-transaction.ts, set by TenantRequestTransactionInterceptor)
 *      → redirect the already-scoped operation to that SAME transaction instead
 *      of running it on a fresh connection. The raw tx is unextended, so this
 *      cannot recurse. PostgreSQL `app.*` GUCs are SET LOCAL on that tx for a
 *      future NOBYPASSRLS `stadium_api` role; they are defence in depth, not a
 *      substitute for scoping args here. Production has not cut over to that
 *      role, so skipping scopeArgs on this path was a live isolation hole.
 *   3. No tenant context bound          → no-op (auth, webhooks, system, tests).
 *   4. Model has no venueId column      → no-op.
 *   5. Non-scopable operation           → no-op (see tenant-scope: unique-keyed ops).
 *
 * Apply with `prisma.$extends(tenantIsolationExtension())`. Because it is inert
 * without a tenant context, wiring it in is safe; it only takes effect once a
 * request binds the context (e.g. AuthGuard → enterTenant).
 */
export function tenantIsolationExtension() {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scopeField = scopeFieldForModel(model);
          const scopeId =
            scopeField && shouldScopeOperation(operation)
              ? scopeIdForField(getTenantContext(), scopeField)
              : undefined;
          const effectiveArgs: Record<string, any> = scopeId
            ? scopeArgs(operation, args as Record<string, any>, scopeId, scopeField!)
            : (args as Record<string, any>);

          const tx = getBoundTenantTx();
          if (tx) {
            const delegate = (tx as unknown as Record<string, Record<string, Function>>)[modelDelegateName(model)];
            const op = delegate?.[operation];
            if (typeof op === 'function') {
              return op(effectiveArgs);
            }
            // No matching delegate/operation on the raw tx (shouldn't happen
            // for a real model+operation pair, but never throw over a naming
            // mismatch) — fall through to the extended client below, which
            // still runs the already-scoped args, just outside the bound tx.
          }

          return query(effectiveArgs as typeof args);
        },
      },
    },
  });
}
