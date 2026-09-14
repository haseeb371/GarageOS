# AutoGaragify capability coverage

This matrix describes the current local website, not the competing product that informed the general business categories.

## Production expansion completed

- Global regional settings and a provider-independent integration registry.
- Tire inventory, DOT records, measurements and vehicle tire-service history.
- Labor, maintenance and vehicle-specification records with source attribution.
- Supplier quote comparison, ordering, delivery and receiving workflows.
- Capacity resources, booking rules, channels and concurrency controls.
- Workflow automations with approval and test-run controls.
- Accounting/CRM connections with synchronization history.
- Support tickets, compliance policies and incident management.
- A database health endpoint and baseline HTTP security headers.

External transactions remain disabled until a buyer supplies credentials and has an approved account with a regional provider. Sandbox and shop-authored data are always identified as such.

| Area | Working locally | External/hardware boundary |
|---|---|---|
| Dashboard and global search | KPIs, schedule, job board, recovery and low-stock panels | Live warehouse/BI connections |
| Customers, vehicles and fleets | CRUD, notes, credit, tags, vehicle identity/mileage, fleet accounts (PO, net terms, billing email), roster panel, monthly statement CSV | Licensed VIN/plate/history lookup |
| Appointments and booking | Daily schedule, create/edit, status/source, customer/vehicle links, public shop booking page | Hosted deployment; live provider reminders |
| Repair orders | CRUD, board stages, assignments, status moves, pricing and totals | Supplier/labor-guide feeds |
| Estimates and jobs | Job types, labor/parts, fee/discount/tax, margin-ready data, per-job decision, financing CTA on estimate link (sandbox or Wisetack/Affirm) | Live lender underwriting |
| Customer portal | Secure status + balance + Stripe pay + financing CTA (`/portal/{token}`); estimate approve/decline remains `/estimate/{token}` | Full account login / multi-visit history |
| Authorization and declined work | Decision records, authorization model, recovery dashboard/segment | Production e-sign consent policy |
| Inspections | Template instance, checklist severity, findings, attachment metadata, duplication/history | Binary upload pipeline and malware scan |
| Technician workflow | Assignment, job clocks, running/completed time, hour report, phone-first **/tech** bay (start/pause/complete + linked inspection checklist) | Offline companion / native app |
| Inventory and tires | CRUD, stock/reorder, cost/price/margin, bins, cores, tire DOT fields | — |
| Parts network | Sandbox PartsTech-style search/quote/order on Inventory + manual quotes; live key hook via `PARTSTECH_MODE` | Approved PartsTech partner API |
| Vendors and purchasing | Vendor and PO records, order status/data model | EDI/direct ordering and receiving hardware |
| Billing and payments | Invoices, A/R, deposits, credits, local ledger, Stripe Checkout, **Pay at counter** (Terminal simulate in test) | Live Stripe Terminal reader + location |
| Marketing and reputation | Service reminders, declined-work segments, templates, campaigns, local send simulation, reviews and shop responses | SMS/email/review provider accounts |
| Reporting and export | Financial/operational/people charts, advisor close-rate & ARO vs prior period + CSV, JSON backup and validated merge restore | Advanced custom BI |
| Accounting sync | Journal CSV + Sync to Zapier webhook (lines + invoice/payment entities) or QBO/Xero journals when env tokens set | OAuth refresh / Intuit & Xero apps |
| Multi-shop | Editable location directory, location-specific public booking URLs and shop-scoped persistence | Hosted tenant routing and consolidated auth |
| Users, roles and audit | Local user/role records, active context, write/delete audit events | Production authentication and enforced RBAC |
| Integrations | Editable adapter registry and sandbox/CSV modes | Credentials/contracts for every live provider |

## Local completion status

All workflows that can operate without third-party credentials, licensed data, external messaging/payment services, or dedicated hardware are implemented. The remaining boundaries in the right column are integration projects rather than missing local application features.

## Honest limitations

External messaging, payment capture, financing, accounting sync, supplier ordering, OEM/labor data, vehicle history, public reviews and payment terminals cannot be genuinely completed without third-party contracts, credentials and often certification. The local software keeps these actions in sandbox mode. Production hosting also needs server-enforced authentication, hardened file uploads, encrypted backups, monitoring and privacy/compliance review.
