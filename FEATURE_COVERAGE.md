# AutoGragify capability coverage

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
| Customers, vehicles and fleets | CRUD, notes, credit, tags, vehicle identity/mileage, linked history model | Licensed VIN/plate/history lookup |
| Appointments and booking | Daily schedule, create/edit, status/source, customer/vehicle links, public shop booking page | Hosted deployment; live provider reminders |
| Repair orders | CRUD, board stages, assignments, status moves, pricing and totals | Supplier/labor-guide feeds |
| Estimates and jobs | Job types, labor/parts, fee/discount/tax, margin-ready data, per-job decision | Financing prequalification |
| Authorization and declined work | Decision records, authorization model, recovery dashboard/segment | Production e-sign consent policy |
| Inspections | Template instance, checklist severity, findings, attachment metadata, duplication/history | Binary upload pipeline and malware scan |
| Technician workflow | Assignment, job clocks, running/completed time, hour report | Dedicated mobile companion/offline sync |
| Inventory and tires | CRUD, stock/reorder, cost/price/margin, bins, cores, tire DOT fields | Supplier availability/order APIs |
| Vendors and purchasing | Vendor and PO records, order status/data model | EDI/direct ordering and receiving hardware |
| Billing and payments | Invoices, A/R, deposits, credits, local ledger, sandbox capture | PCI payment/terminal provider |
| Marketing and reputation | Service reminders, declined-work segments, templates, campaigns, local send simulation, reviews and shop responses | SMS/email/review provider accounts |
| Reporting and export | Financial/operational/people charts, CSV reporting, JSON backup and validated merge restore | Accounting sync and advanced custom BI |
| Multi-shop | Editable location directory, location-specific public booking URLs and shop-scoped persistence | Hosted tenant routing and consolidated auth |
| Users, roles and audit | Local user/role records, active context, write/delete audit events | Production authentication and enforced RBAC |
| Integrations | Editable adapter registry and sandbox/CSV modes | Credentials/contracts for every live provider |

## Local completion status

All workflows that can operate without third-party credentials, licensed data, external messaging/payment services, or dedicated hardware are implemented. The remaining boundaries in the right column are integration projects rather than missing local application features.

## Honest limitations

External messaging, payment capture, financing, accounting sync, supplier ordering, OEM/labor data, vehicle history, public reviews and payment terminals cannot be genuinely completed without third-party contracts, credentials and often certification. The local software keeps these actions in sandbox mode. Production hosting also needs server-enforced authentication, hardened file uploads, encrypted backups, monitoring and privacy/compliance review.
