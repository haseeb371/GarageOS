'use client'
import { FormEvent,useState } from 'react'
import { Eye,EyeOff,ShieldCheck } from 'lucide-react'

type Step = 'form' | 'verify-email' | 'verify-2fa'

export default function LoginForm({configured,registration=false}:{configured:boolean;registration?:boolean}){
 const [values,setValues]=useState({shopName:'',name:'',email:'',password:''})
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [showPassword,setShowPassword]=useState(false)
 const [step,setStep]=useState<Step>('form')
 const [code,setCode]=useState('')
 const [pendingEmail,setPendingEmail]=useState('')
 const change=(key:keyof typeof values)=>(event:React.ChangeEvent<HTMLInputElement>)=>setValues(v=>({...v,[key]:event.target.value}))

 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setError('')
  try{
   const response=await fetch(registration?'/api/auth/register':configured?'/api/auth/login':'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)})
   const text=await response.text()
   let result:any={};try{result=JSON.parse(text)}catch{}
   if(!response.ok){setError(result.error||`Unable to continue (${response.status}).`);return}
   if(result.requiresVerification){setPendingEmail(values.email);setStep('verify-email');return}
   if(result.requiresTwoFactor){setPendingEmail(result.email||values.email);setStep('verify-2fa');return}
   window.location.assign('/')
  }catch{setError('AutoGaragify could not reach the server. Restart it and try again.')}
  finally{setBusy(false)}
 }

 async function verifyEmailCode(e:FormEvent){
  e.preventDefault();if(busy)return;setBusy(true);setError('')
  try{
   const response=await fetch('/api/auth/verify-email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:pendingEmail,code})})
   const result=await response.json()
   if(!response.ok){setError(result.error||'Verification failed.');return}
   window.location.assign('/')
  }catch{setError('Could not verify. Try again.')}finally{setBusy(false)}
 }

 async function verify2faCode(e:FormEvent){
  e.preventDefault();if(busy)return;setBusy(true);setError('')
  try{
   const response=await fetch('/api/auth/verify-2fa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:pendingEmail,code})})
   const result=await response.json()
   if(!response.ok){setError(result.error||'Verification failed.');return}
   window.location.assign('/')
  }catch{setError('Could not verify. Try again.')}finally{setBusy(false)}
 }

 async function resendCode(){
  setBusy(true);setError('')
  try{
   const endpoint=step==='verify-email'?'/api/auth/verify-email':'/api/auth/verify-2fa'
   const response=await fetch(endpoint,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({email:pendingEmail})})
   const result=await response.json()
   if(!response.ok)throw new Error(result.error||'Could not resend.')
   setError('');setCode('')
  }catch(e){setError(e instanceof Error?e.message:'Could not resend.')}
  finally{setBusy(false)}
 }

 const creating=registration||!configured

 if(step==='verify-email'||step==='verify-2fa'){
  return <main className="auth-page"><div className="auth-shell"><section className="auth-intro"><div className="auth-logo"><div className="brandmark"><ShieldCheck size={28}/></div><b>AutoGaragify</b></div><div><span className="auth-kicker">{step==='verify-email'?'EMAIL VERIFICATION':'TWO-FACTOR AUTH'}</span><h2>{step==='verify-email'?'Check your email':'Enter your sign-in code'}</h2><p>{step==='verify-email'?'We sent a 6-digit code to':'A sign-in code was sent to'} <b>{pendingEmail}</b>. Enter it below to continue.</p></div></section><section className="auth-card"><div className="auth-card-logo"><div className="brandmark"><ShieldCheck size={28}/></div><b>AutoGaragify</b></div><span className="auth-kicker">{step==='verify-email'?'ENTER CODE':'2FA CODE'}</span><h1>{step==='verify-email'?'Verify your email':'Two-factor sign-in'}</h1><p>Enter the 6-digit code from your email.</p>
  <form onSubmit={step==='verify-email'?verifyEmailCode:verify2faCode} noValidate><label>Verification code<input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} required minLength={6} maxLength={6} placeholder="123456" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" style={{textAlign:'center',fontSize:24,letterSpacing:6}}/></label>{error&&<div className="auth-error" role="alert">{error}</div>}<button type="submit" className="btn" disabled={busy||code.length<6}>{busy?'Verifying…':'Verify & continue'}</button></form>
  <div className="auth-switch" style={{marginTop:16}}><button onClick={resendCode} disabled={busy} style={{border:0,background:'transparent',color:'#176448',fontWeight:700,cursor:'pointer',fontSize:14}}>{busy?'Sending…':'Resend code'}</button></div>
  <div style={{marginTop:12}}><a href="/login" style={{fontSize:13,color:'#68736d'}}>← Back to sign in</a></div>
  </section></div></main>
 }

 return <main className="auth-page"><div className="auth-shell"><section className="auth-intro"><div className="auth-logo"><div className="brandmark">G</div><b>AutoGaragify</b></div><div><span className="auth-kicker">Built for modern repair shops</span><h2>Run every job, customer and dollar from one workspace.</h2><p>Keep your front desk, technicians and finances connected without the clutter of disconnected tools.</p></div><ul><li>Repair orders and digital inspections</li><li>Customers, vehicles and appointments</li><li>Inventory, invoicing and reporting</li></ul><small>Secure workspace · Each shop keeps isolated data</small></section><section className="auth-card"><div className="auth-card-logo"><div className="brandmark">G</div><b>AutoGaragify</b></div><span className="auth-kicker">{creating?'NEW SHOP ACCOUNT':'SECURE ACCESS'}</span><h1>{creating?'Create your account':'Welcome back'}</h1><p>{creating?'Create an owner account and your repair-shop workspace.':'Sign in to continue managing your shop.'}</p>
  <form method="post" action={registration?'/api/auth/register':configured?'/api/auth/login':'/api/auth/setup'} onSubmit={submit} noValidate>{creating&&<><label>Shop name<input name="shopName" value={values.shopName} onChange={change('shopName')} required minLength={2}/></label><label>Your name<input name="name" value={values.name} onChange={change('name')} required minLength={2}/></label></>}<label>Email<input name="email" value={values.email} onChange={change('email')} type="email" required autoComplete="email"/></label><label>Password<div className="password-field"><input name="password" value={values.password} onChange={change('password')} type={showPassword?'text':'password'} minLength={creating?8:1} required autoComplete={creating?'new-password':'current-password'}/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Hide password':'Show password'} title={showPassword?'Hide password':'Show password'}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></label>{creating&&<small style={{color:'#68736d',fontSize:12,display:'block',marginBottom:8}}>A 6-digit verification code will be sent to your email to confirm your account.</small>}{error&&<div className="auth-error" role="alert">{error}</div>}<button type="submit" className="btn" disabled={busy}>{busy?'Please wait…':creating?'Create account':'Sign in'}</button></form>
  <div className="auth-switch">{creating?<a href="/login?mode=login">Already have an account? Sign in</a>:<><span>New to AutoGaragify?</span><a className="btn secondary" href="/login?mode=create">Create account</a></>}</div></section></div></main>
}
