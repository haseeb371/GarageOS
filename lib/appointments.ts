type Row = Record<string, unknown> & { id: string }

export function orderFromAppointment(appointment: Row, advisor = 'Unassigned') {
  const service = String(appointment.service || '').trim()
  return {
    id: `RO-${Date.now().toString().slice(-4)}`,
    customerId: String(appointment.customerId || ''),
    vehicleId: String(appointment.vehicleId || ''),
    locationId: appointment.locationId || '',
    status: 'Estimate',
    advisor,
    technician: 'Unassigned',
    taxRate: 8.25,
    discount: 0,
    fees: 0,
    jobs: service
      ? [
          {
            id: `J-${Date.now()}`,
            type: 'Appointment',
            name: service,
            description: `Scheduled from appointment ${appointment.id}`,
            laborHours: 0,
            laborRate: 0,
            partsCost: 0,
            partsPrice: 0,
            decision: 'Pending',
            severity: 'Monitor'
          }
        ]
      : [],
    authorizations: [],
    appointmentId: appointment.id,
    createdAt: new Date().toISOString()
  }
}

export function appointmentHasOrder(appointmentId: string, orders: Row[] = []) {
  return orders.some(order => order.appointmentId === appointmentId)
}
