export const demo: Record<string, Array<Record<string,unknown> & {id:string}>> = {
 customers:[
  {id:'C-1001',name:'Amelia Carter',phone:'(555) 014-8210',email:'amelia@example.com',credit:75,tags:['Retail'],notes:'Prefers text updates'},
  {id:'C-1002',name:'Marcus Lee',phone:'(555) 019-4408',email:'marcus@example.com',credit:0,tags:['Retail'],notes:''},
  {id:'C-1003',name:'Northline Couriers',phone:'(555) 017-1022',email:'fleet@northline.example',credit:250,tags:['Fleet'],notes:'PO required'}
 ],
 vehicles:[
  {id:'V-201',customerId:'C-1001',year:2020,make:'Honda',model:'CR-V',vin:'5J6RW2H8XLA008421',plate:'8JQ2',mileage:64120,fleet:false},
  {id:'V-202',customerId:'C-1002',year:2018,make:'Ford',model:'F-150',vin:'1FTEW1EP8JFA28410',plate:'4LK9',mileage:92330,fleet:false},
  {id:'V-203',customerId:'C-1003',year:2019,make:'Ram',model:'ProMaster',vin:'3C6TRVAG7KE512432',plate:'2PT4',mileage:118210,fleet:true}
 ],
 appointments:[
  {id:'A-2081',customerId:'C-1001',vehicleId:'V-201',date:'2026-07-31',time:'08:00',service:'Brake inspection',status:'Confirmed',source:'Online booking'},
  {id:'A-2082',customerId:'C-1002',vehicleId:'V-202',date:'2026-07-31',time:'09:30',service:'Oil service + noise',status:'Arrived',source:'Phone'}
 ],
 orders:[
  {id:'RO-4812',customerId:'C-1002',vehicleId:'V-202',status:'In progress',advisor:'Nora',technician:'Eli',taxRate:8.25,discount:25,fees:18,jobs:[
   {id:'J1',type:'Smart job',name:'Front brake pads & rotors',laborHours:2.2,laborRate:145,partsCost:250,partsPrice:428,decision:'Approved',severity:'Needs attention'},
   {id:'J2',type:'Canned job',name:'Cabin air filter',laborHours:.3,laborRate:145,partsCost:14,partsPrice:42,decision:'Declined',severity:'Monitor'}],authorizations:[{at:'2026-07-31T09:18:00Z',method:'Digital',name:'Marcus Lee'}]},
  {id:'RO-4813',customerId:'C-1001',vehicleId:'V-201',status:'Estimate',advisor:'Nora',technician:'Sam',taxRate:8.25,discount:0,fees:0,jobs:[
   {id:'J3',type:'Custom',name:'Brake fluid exchange',laborHours:1,laborRate:145,partsCost:18,partsPrice:38,decision:'Pending',severity:'Monitor'}],authorizations:[]}
 ],
 inspections:[{id:'DVI-51',orderId:'RO-4812',template:'Comprehensive safety',technician:'Eli',date:'2026-07-31',items:[
  {area:'Front brakes',result:'Needs attention',note:'Pads at 2 mm; rotor heat spots visible.',attachments:['front-brake.jpg']},
  {area:'Rear brakes',result:'Monitor',note:'Pads at 5 mm.',attachments:[]},
  {area:'Tires',result:'Good',note:'6/32 evenly worn.',attachments:[]}]}],
 inventory:[
  {id:'I1',sku:'BRK-8821',name:'Ceramic brake pad set',vendorId:'VEN-1',onHand:3,reorderAt:2,cost:62,price:128,core:false,location:'A-12'},
  {id:'I2',sku:'FLT-1044',name:'Cabin air filter',vendorId:'VEN-2',onHand:1,reorderAt:4,cost:14,price:42,core:false,location:'B-03'},
  {id:'I3',sku:'TIRE-22565',name:'225/65R17 Touring tire',vendorId:'VEN-2',onHand:4,reorderAt:4,cost:102,price:169,core:false,dot:'2426',location:'Tire rack'}
 ],
 vendors:[{id:'VEN-1',name:'Metro Parts',phone:'555-0110',terms:'Net 30'},{id:'VEN-2',name:'Roadline Supply',phone:'555-0160',terms:'COD'}],
 purchaseOrders:[{id:'PO-901',vendorId:'VEN-2',status:'Ordered',total:410,items:4,expected:'2026-08-01'}],
 invoices:[{id:'INV-3291',orderId:'RO-4809',customerId:'C-1003',total:612.48,balance:0,status:'Paid',due:'2026-07-30'},{id:'INV-3292',orderId:'RO-4812',customerId:'C-1002',total:945.22,balance:625.22,status:'Partial',due:'2026-08-15'}],
 payments:[{id:'P-710',invoiceId:'INV-3291',amount:612.48,method:'Sandbox card',status:'Captured',date:'2026-07-30'},{id:'P-711',invoiceId:'INV-3292',amount:320,method:'Deposit',status:'Captured',date:'2026-07-28'}],
 timeEntries:[{id:'T-1',technician:'Eli',orderId:'RO-4812',started:'2026-07-31T08:20:00Z',ended:'2026-07-31T10:35:00Z',type:'Job clock'},{id:'T-2',technician:'Sam',orderId:'RO-4813',started:'2026-07-31T09:00:00Z',ended:null,type:'Job clock'}],
 campaigns:[{id:'M-1',name:'Declined brake follow-up',channel:'SMS sandbox',segment:'Declined work',status:'Active',sent:24,booked:4,revenue:1840,template:'Your previously recommended service is ready when you are.'}],
 reviews:[{id:'RV-1',customer:'Amelia Carter',rating:5,status:'Published locally',text:'Clear inspection and friendly updates.'}],
 users:[{id:'U-1',name:'Maya Patel',role:'Owner',pin:'1234'},{id:'U-2',name:'Nora Diaz',role:'Advisor',pin:'2468'},{id:'U-3',name:'Eli Brooks',role:'Technician',pin:'1357'}],
 shops:[{id:'shop-main',name:'Juniper Auto Works',address:'1840 Market Street',phone:'(555) 010-2020'},{id:'shop-north',name:'Juniper Auto North',address:'44 North Avenue',phone:'(555) 010-2021'}],
 integrations:[{id:'INT-SMS',name:'Messaging',mode:'Sandbox',status:'Ready'},{id:'INT-PAY',name:'Payments',mode:'Sandbox',status:'Ready'},{id:'INT-ACC',name:'Accounting export',mode:'CSV',status:'Ready'}]
}
