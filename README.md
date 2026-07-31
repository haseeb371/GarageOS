# GarageOS

GarageOS is an original, locally hosted shop-management website for independent automotive repair businesses. It models common industry workflows without using Tekmetric code, branding, copy, layouts, private APIs, or proprietary assets.

## Run on Windows

Requirements: Node.js 20+, npm 10+, and PostgreSQL 15+ (local or hosted).

```powershell
cd GarageOS
copy .env.example .env.local
# Set DATABASE_URL in .env.local to your PostgreSQL connection string.
npm.cmd install
npm.cmd run dev -- -p 3000
```

Open **http://localhost:3000**. GarageOS creates its PostgreSQL tables automatically, then presents a one-time secure shop-owner setup. Changes made through the UI persist in PostgreSQL.

Production check and start:

```powershell
npm.cmd run build
npm.cmd run start
```

## Functional areas

- Responsive dashboard, global search and job-board navigation
- Customers, contact details, credits, notes, fleet tags and linked vehicles
- Vehicle VIN/plate/mileage/fleet records
- Daily appointment schedule and booking records
- Repair orders, advisors, technicians and five-stage workflow
- Estimate jobs with job type, labor, parts, fees, discounts, taxes and decisions
- Per-job approve/decline state and authorization history model
- Digital inspection templates, severity, notes, attachment metadata and history
- Inventory, tire/DOT records, stock levels, locations, vendors and purchase orders
- Invoices, A/R, deposits, payments, credits and simulated card captures
- Technician assignment, local job clocks and hours reporting
- Declined-work segments, campaign templates and sandbox sends
- Reviews, multi-location records, user roles, adapter status and audit log
- JSON backup/export

## Architecture

GarageOS uses Next.js App Router, React, TypeScript, PostgreSQL, Drizzle ORM, Zod validation, route handlers and a custom responsive design system. Records are stored as typed domain documents in an indexed PostgreSQL record table, allowing the breadth of the platform to evolve without destructive migrations. Every write also creates an audit entry.

`GET /api/bootstrap` initializes and reads the workspace. `POST/DELETE /api/records` validates and persists mutations. `GET /api/export` creates a portable JSON backup.

## Local access and external services

GarageOS includes password authentication, HTTP-only database-backed sessions, shop-scoped data access and server-enforced write permissions. Before public internet hosting, add rate limiting, CSRF/origin protection, encrypted secret management, secure attachment storage, managed backups and recovery tests.

Messaging, card processing, financing, vehicle history, labor guides, parts ordering and accounting are represented by local adapter/sandbox records. Real service requires a vendor contract, API credentials and provider-specific compliance:

- Use a PCI-compliant hosted payment flow; never store raw card data.
- Collect messaging consent and enforce opt-outs, quiet hours and sender registration.
- License vehicle, labor, OEM and history data rather than scraping it.
- Store production attachments in access-controlled object storage with malware scanning.

The local sandbox intentionally never sends messages, charges cards or contacts external systems.
