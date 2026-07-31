'use client'
import { FormEvent,useState } from 'react'
import { Eye,EyeOff } from 'lucide-react'

export default function LoginForm({configured,canCreate}:{configured:boolean;canCreate:boolean}){
 const [values,setValues]=useState({shopName:'',name:'',email:'',password:''})
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [showPassword,setShowPassword]=useState(false)
 const change=(key:keyof typeof values)=>(event:React.ChangeEvent<HTMLInputElement>)=>setValues(v=>({...v,[key]:event.target.value}))
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setError('')
  try{
   const response=await fetch(configured?'/api/auth/login':'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)})
   const text=await response.text()
   let result:{error?:string}={};try{result=JSON.parse(text)}catch{}
   if(!response.ok){setError(result.error||`Unable to continue (${response.status}).`);return}
   window.location.assign('/')
  }catch{setError('GarageOS could not reach the server. Restart it and try again.')}
  finally{setBusy(false)}
 }
 return <main className="auth-page"><div className="auth-shell"><section className="auth-intro"><div className="auth-logo"><div className="brandmark">G</div><b>GarageOS</b></div><div><span className="auth-kicker">Built for modern repair shops</span><h2>Run every job, customer and dollar from one workspace.</h2><p>Keep your front desk, technicians and finances connected without the clutter of disconnected tools.</p></div><ul><li>Repair orders and digital inspections</li><li>Customers, vehicles and appointments</li><li>Inventory, invoicing and reporting</li></ul><small>Secure local workspace · Your shop data stays isolated</small></section><section className="auth-card"><div className="auth-card-logo"><div className="brandmark">G</div><b>GarageOS</b></div><span className="auth-kicker">{configured?'Secure access':'First-time setup'}</span><h1>{configured?'Welcome back':'Create your workspace'}</h1><p>{configured?'Sign in to continue managing your shop.':'Set up the first owner account and your repair shop.'}</p>
 <form method="post" action={configured?'/api/auth/login':'/api/auth/setup'} onSubmit={submit} noValidate>{!configured&&<><label>Shop name<input name="shopName" value={values.shopName} onChange={change('shopName')} required minLength={2}/></label><label>Your name<input name="name" value={values.name} onChange={change('name')} required minLength={2}/></label></>}<label>Email<input name="email" value={values.email} onChange={change('email')} type="email" required autoComplete="email"/></label><label>Password<div className="password-field"><input name="password" value={values.password} onChange={change('password')} type={showPassword?'text':'password'} minLength={configured?1:8} required autoComplete={configured?'current-password':'new-password'}/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Hide password':'Show password'} title={showPassword?'Hide password':'Show password'}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></label>{error&&<div className="auth-error" role="alert">{error}</div>}<button type="submit" className="btn" disabled={busy}>{busy?'Please wait…':configured?'Sign in':'Create workspace'}</button></form>
 <div className="auth-switch">{configured&&canCreate?<a href="/login">Create the first workspace</a>:!configured?<a href="/login?mode=login">Already have an account? Sign in</a>:null}</div></section></div></main>
}
