export type RecordData = Record<string, unknown> & { id:string }
export const kinds = ['customers','vehicles','appointments','orders','inspections','inventory','vendors','purchaseOrders','invoices','payments','timeEntries','campaigns','reviews','users','shops','integrations'] as const
export type Kind = typeof kinds[number]
export const roles = {
  Owner: ['*'],
  Manager: ['read','write','reports','settings'],
  Advisor: ['read','write','customers','orders','appointments','invoices'],
  Technician: ['read','orders','inspections','clock'],
  Bookkeeper: ['read','invoices','payments','reports']
}
