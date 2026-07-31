# GarageOS architecture

## Runtime

- Next.js App Router and React render the responsive browser application.
- TypeScript provides the domain and API contracts.
- Route handlers own reads, validated writes and exports.
- Drizzle ORM accesses the configured PostgreSQL database.
- Zod rejects malformed record mutation payloads.
- The UI calls the same HTTP boundary that a future mobile client can use.

## Persistence

`records` stores an indexed `kind`, `shop_id` and JSON domain document, with creation/update timestamps. PostgreSQL transactions keep mutations and audit entries atomic while domain structures settle. `audit_log` is append-only from normal application operations. A mature hosted edition should promote stable fields into normalized tables with foreign keys and row-level organization boundaries.

## Security boundary

GarageOS uses credential-based authentication with scrypt password hashes, opaque HTTP-only session cookies, shop-scoped reads and server-enforced write permissions. No third-party secrets or raw card data are stored in domain records. An internet deployment should additionally add rate limiting, CSRF/origin defenses, encrypted secret management, managed backups, recovery drills and formal audit-retention controls.

## Integration boundary

Messaging, payments and accounting have sandbox/CSV adapter records so workflows are testable without accidental external effects. Production adapters should implement provider-specific interfaces behind server-only modules and idempotent job queues. Binary attachments should move from metadata-only records to authenticated uploads in object storage, with size/type validation, malware scanning, thumbnails and retention policies.
