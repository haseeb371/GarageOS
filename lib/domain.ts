export type RecordData = Record<string, unknown> & { id:string }
export const kinds = ['customers','vehicles','appointments','orders','cannedJobs','pricingRules','warranties','laborGuideEntries','maintenanceSchedules','vehicleSpecifications','inspections','inventory','inventoryTransactions','vendors','purchaseOrders','supplierQuotes','partsOrders','tires','tireServices','invoices','payments','timeEntries','assignments','campaigns','serviceReminders','reviews','capacityResources','availabilityRules','workflowAutomations','automationJobs','providerCredentials','bookingChannels','integrationConnections','syncRuns','supportTickets','compliancePolicies','incidents','users','shops','integrations'] as const
export type Kind = typeof kinds[number]
export const roles = {
  Owner: ['*'],
  Manager: ['read','write','reports','settings'],
  Advisor: ['read','write','customers','orders','appointments','invoices'],
  Technician: ['read','orders','inspections','clock'],
  Bookkeeper: ['read','invoices','payments','reports']
}
