'use client'
import {useEffect,useState} from 'react'
import {CalendarDays,Check,ShieldCheck} from 'lucide-react'

export default function BookingForm({shopId,shop}:{shopId:string;shop:{name:string;address?:string;phone?:string}}){
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('')
 const[date,setDate]=useState(new Date().toISOString().slice(0,10)),[time,setTime]=useState('09:00')
 const[slots,setSlots]=useState<string[]>([]),[slotsLoading,setSlotsLoading]=useState(false),[slotsMessage,setSlotsMessage]=useState('')

 useEffect(()=>{
  let cancelled=false
  const load=async()=>{
   if(!date){setSlots([]);return}
   setSlotsLoading(true);setSlotsMessage('')
   try{
    const response=await fetch(`/api/booking/availability?shopId=${encodeURIComponent(shopId)}&date=${encodeURIComponent(date)}`)
    const result=await response.json()
    if(cancelled)return
    if(!response.ok){setSlots([]);setSlotsMessage(result.error||'Could not load available times.');return}
    setSlots(result.slots||[])
    setSlotsMessage(result.message||'')
    if(result.slots?.length&&!result.slots.includes(time))setTime(result.slots[0])
   }catch{
    if(!cancelled){setSlots([]);setSlotsMessage('Could not load available times.')}
   }finally{if(!cancelled)setSlotsLoading(false)}
  }
  load()
  return()=>{cancelled=true}
 },[shopId,date,time])

 const submit=async(e:React.FormEvent<HTMLFormElement>)=>{
  e.preventDefault();setBusy(true);setError('')
  const values=Object.fromEntries(new FormData(e.currentTarget))
  const response=await fetch('/api/booking',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...values,shopId,date,time})})
  const result=await response.json()
  setBusy(false)
  if(!response.ok)return setError(result.error||'Booking could not be submitted.')
  setDone(result.appointmentId)
 }

 if(done)return <main className="booking-shell"><section className="booking-success"><Check/><h1>Appointment requested</h1><p>Your confirmation number is <b>{done}</b>. {shop.name} will contact you to confirm availability.</p></section></main>

 return <main className="booking-shell"><section className="booking-intro"><div className="brandmark">G</div><small>ONLINE BOOKING</small><h1>Request service at {shop.name}</h1><p>{shop.address} {shop.phone&&`· ${shop.phone}`}</p><div><CalendarDays/><span><b>Real-time availability</b><small>Only open appointment times configured by the shop are shown.</small></span></div><div><ShieldCheck/><span><b>Your information stays with the shop</b><small>No payment information is collected on this page.</small></span></div></section><form className="booking-form" onSubmit={submit}><h2>Contact details</h2><div className="booking-grid"><label>Full name<input name="name" required minLength={2}/></label><label>Phone<input name="phone" required type="tel"/></label><label className="wide">Email<input name="email" required type="email"/></label></div><h2>Vehicle</h2><div className="booking-grid three"><label>Year<input name="year" required type="number" min="1900" defaultValue={new Date().getFullYear()}/></label><label>Make<input name="make" required/></label><label>Model<input name="model" required/></label><label>Mileage<input name="mileage" required type="number" min="0" defaultValue="0"/></label></div><h2>Preferred appointment</h2><div className="booking-grid"><label>Date<input name="date" required type="date" min={new Date().toISOString().slice(0,10)} value={date} onChange={e=>setDate(e.target.value)}/></label><label>Time{slots.length?<select name="time" required value={time} onChange={e=>setTime(e.target.value)}>{slots.map(slot=><option key={slot} value={slot}>{slot}</option>)}</select>:<input name="time" required type="time" value={time} onChange={e=>setTime(e.target.value)} disabled={slotsLoading}/>}{slotsLoading&&<small>Loading open times…</small>}{!slotsLoading&&slotsMessage&&<small>{slotsMessage}</small>}</label><label className="wide">What does your vehicle need?<input name="service" list="public-service-suggestions" required minLength={3} placeholder="Choose a suggestion or describe the concern"/><datalist id="public-service-suggestions">{['Oil and filter service','Brake inspection','Diagnostic / warning light','Tire rotation','Tire repair','Wheel alignment','Battery and charging test','Air conditioning service','Scheduled maintenance','Pre-purchase inspection','Steering or suspension concern'].map(service=><option key={service} value={service}/>)}</datalist></label></div>{error&&<p className="booking-error">{error}</p>}<button className="btn" disabled={busy||slotsLoading||(!slots.length&&!slotsMessage.includes('closed'))}>{busy?'Submitting…':'Request appointment'}</button></form></main>
}
