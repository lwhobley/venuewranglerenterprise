# Security dependency exceptions

## Audit snapshot — 2026-09-16

Dependencies synchronized with `npm install --ignore-scripts` (lockfile already
current), then `npm audit fix --ignore-scripts` (non-breaking only), which cleared
`qs` and `@expo/metro`. All 1,425 unit tests and both typechecks pass on the result.

| Scope | Critical | High | Moderate | Total |
| --- | --- | --- | --- | --- |
| `npm audit --omit=dev` | 0 | 9 | 3 | 12 |
| `npm audit` (incl. dev) | 0 | 12 | 3 | 15 |

Remaining production findings:

- **Build toolchain only** — `metro`, `metro-config`, `metro-transform-worker`,
  `image-size`, `@xmldom/xmldom`, `js-yaml`, `@expo/xcpretty`. The registry marks
  these fixable, but `npm audit fix` could not move them within the Expo SDK's
  pinned ranges; they run at bundle time, not in the API or on devices. See the
  `image-size` section below.
- **`multer` via `@nestjs/platform-express`** — patched only in Nest 12 (major
  upgrade). No route accepts multipart uploads; see the multer section below.
- **`decode-uri-component`, `query-string` via `expo-router`** — fix requires
  `expo-router` 5.1.11 (major). Metro already resolves the decoder to a bounded
  wrapper (`scripts/safe-uri-decode.cjs`).

The Prisma `deepmerge-ts` advisory below no longer appears in the audit.

## Metro `image-size` denial of service advisories

As of 2026-08-12, `npm audit --omit=dev --audit-level=high` reports GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq through Expo/Metro's transitive `image-size` dependency. The registry offers no non-breaking patched dependency chain; the suggested forced fix downgrades React Native from 0.86 to 0.72 and is not compatible with this Expo SDK.

Exposure is limited to developer/build-time processing of repository assets. Production clients do not invoke Metro or parse user uploads with `image-size`. Until Expo/Metro ships a patched chain, do not add untrusted ICNS, JXL, HEIF, or HEIC files to the repository or build context. Re-run the audit on every dependency update and remove this exception as soon as a compatible patched release is available.

## Prisma `deepmerge-ts` stack exhaustion advisory

As of 2026-08-18, `npm audit --omit=dev --audit-level=high` also reports GHSA-ggr8-5vv4-36mx (stack exhaustion when merging recursive object graphs) through `prisma@6.19.x`'s transitive `@prisma/config` -> `deepmerge-ts@7.1.5` dependency. The suggested fix (`prisma@6.12.0`) is a downgrade from the version this repo currently depends on, not a forward patch, and is not something we want to take.

Exposure is limited to `prisma generate`/`prisma migrate`/config-loading at build and migration time — `deepmerge-ts` merges the Prisma config object graph, not any request-time or user-controlled data, and the API server does not import `@prisma/config` at runtime. Re-run the audit on every Prisma upgrade and remove this exception once a `prisma` release depends on a patched `deepmerge-ts` (>=8.0.0).

## Nest `multer` (no patched release)

`@nestjs/platform-express` pulls `multer`. No route in this API uses `FileInterceptor` or multipart upload; document and image bodies are JSON base64. Until Nest ships a patched `multer`, the API production audit may still report it. Re-evaluate on every Nest upgrade.
