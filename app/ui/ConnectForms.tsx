'use client'
import {useEffect,useState} from 'react'
import {AlertCircle,Check,KeyRound,Phone,Send,Webhook} from 'lucide-react'

type CredStatus = {
  email: { configured: boolean; from: string; source: string; hasApiKey: boolean }
  sms: { configured: boolean; from: string; source: string; hasToken: boolean }
  accounting: { configured: boolean; provider: string; webhookUrl: string; source: string }
  updatedAt: string
}
type CredForms = {
  email: { apiKeySet: boolean; from: string }
  sms: { accountSid: string; authTokenSet: boolean; from: string }
  accounting: {
    provider: string
    webhookUrl: string
    webhookSecretSet: boolean
    webhook: { ok: boolean; host: string; path: string; isZapierCatchHook: boolean; error: string }
  }
}
type CredResponse = {
  ok: boolean
  status?: CredStatus
  forms?: CredForms
  setup?: { email?: string[]; sms?: string[]; accounting?: string[] }
  error?: string
  message?: string
  saved?: boolean
}

function pill(ok: boolean, label: string) {
  return <span className={`pill ${ok ? 'done' : 'todo'}`}>{ok ? label : `${label} needed`}</span>
}

function Feedback({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null
  return (
    <p
      style={{
        marginTop: 10,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        color: result.ok ? 'var(--green)' : 'var(--red)',
        fontWeight: 650
      }}
    >
      {result.ok ? <Check size={15} /> : <AlertCircle size={15} />}
      {result.message}
    </p>
  )
}

function useCredentials() {
  const [forms, setForms] = useState<CredForms | null>(null)
  const [status, setStatus] = useState<CredStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const reload = async () => {
    try {
      const r = await fetch('/api/integrations/credentials', { cache: 'no-store' })
      const body: CredResponse = await r.json()
      if (r.ok && body.forms) {
        setForms(body.forms)
        setStatus(body.status || null)
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    reload()
  }, [])
  return { forms, status, loading, reload }
}

async function postCredentials(
  payload: Record<string, unknown>,
  test: 'none' | 'email' | 'sms' | 'accounting',
  testTo: string
): Promise<{ ok: boolean; message: string }> {
  const body: Record<string, unknown> = { ...payload, test }
  if (testTo) body.testTo = testTo
  try {
    const r = await fetch('/api/integrations/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const json: CredResponse = await r.json()
    if (!r.ok) return { ok: false, message: json.error || `Request failed (HTTP ${r.status}).` }
    return { ok: true, message: json.message || 'Connection settings saved.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Network error while saving credentials.' }
  }
}

export function EmailConnectForm() {
  const { forms, status, loading, reload } = useCredentials()
  const [apiKey, setApiKey] = useState('')
  const [from, setFrom] = useState('')
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (forms) {
      setFrom(forms.email.from || '')
      setApiKey('')
      setTestTo('')
    }
  }, [forms])

  const maskedHint = forms?.email.apiKeySet ? 'Saved · leave blank to keep current key' : 'Paste your Resend API key'
  const submit = async (test: 'none' | 'email') => {
    setBusy(true)
    setResult(null)
    const payload: Record<string, unknown> = {}
    if (apiKey.trim()) payload.email = { apiKey: apiKey.trim(), from: from.trim() }
    else if (from.trim()) payload.email = { from: from.trim() }
    if (test === 'email' && !testTo.trim()) {
      setResult({ ok: false, message: 'Enter a recipient email to verify the connection.' })
      setBusy(false)
      return
    }
    const res = await postCredentials(payload, test, testTo.trim())
    setResult(res)
    if (res.ok) {
      setApiKey('')
      reload()
    }
    setBusy(false)
  }

  if (loading && !forms) return <p className="muted" style={{ marginTop: 10 }}>Loading email settings…</p>

  return (
    <div style={{ marginTop: 12, width: '100%', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <KeyRound size={15} />
        <b>Connect Resend</b>
        {status && pill(status.email.configured && !status.email.configured ? false : status.email.configured, 'Email')}
      </div>
      <div className="form" style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <label>
          <span>Resend API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={maskedHint}
            autoComplete="off"
          />
        </label>
        <label>
          <span>From address</span>
          <input
            value={from}
            onChange={e => setFrom(e.target.value)}
            placeholder="AutoGaragify <onboarding@resend.dev>"
          />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>Verify recipient (test send — your Resend login email in test mode)</span>
          <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@yourdomain.com" />
        </label>
      </div>
      <div className="record-actions" style={{ marginTop: 10 }}>
        <button disabled={busy} onClick={() => submit('none')}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button disabled={busy} onClick={() => submit('email')}>
          <Send size={14} /> {busy ? 'Verifying…' : 'Save & verify'}
        </button>
      </div>
      <Feedback result={result} />
    </div>
  )
}

export function SmsConnectForm() {
  const { forms, status, loading, reload } = useCredentials()
  const [accountSid, setAccountSid] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [from, setFrom] = useState('')
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (forms) {
      setAccountSid(forms.sms.accountSid || '')
      setFrom(forms.sms.from || '')
      setAuthToken('')
      setTestTo('')
    }
  }, [forms])

  const tokenHint = forms?.sms.authTokenSet ? 'Saved · leave blank to keep current token' : 'Paste your Twilio Auth Token'
  const submit = async (test: 'none' | 'sms') => {
    setBusy(true)
    setResult(null)
    const sms: Record<string, string> = {}
    if (accountSid.trim()) sms.accountSid = accountSid.trim()
    if (from.trim()) sms.from = from.trim()
    if (authToken.trim()) sms.authToken = authToken.trim()
    const payload: Record<string, unknown> = Object.keys(sms).length ? { sms } : {}
    if (test === 'sms' && !testTo.trim()) {
      setResult({ ok: false, message: 'Enter a recipient phone (E.164) to verify the connection.' })
      setBusy(false)
      return
    }
    const res = await postCredentials(payload, test, testTo.trim())
    setResult(res)
    if (res.ok) {
      setAuthToken('')
      reload()
    }
    setBusy(false)
  }

  if (loading && !forms) return <p className="muted" style={{ marginTop: 10 }}>Loading SMS settings…</p>

  return (
    <div style={{ marginTop: 12, width: '100%', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Phone size={15} />
        <b>Connect Twilio</b>
        {status && pill(status.sms.configured, 'SMS')}
      </div>
      <div className="form" style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <label>
          <span>Account SID</span>
          <input value={accountSid} onChange={e => setAccountSid(e.target.value)} placeholder="AC…" />
        </label>
        <label>
          <span>Auth token</span>
          <input
            type="password"
            value={authToken}
            onChange={e => setAuthToken(e.target.value)}
            placeholder={tokenHint}
            autoComplete="off"
          />
        </label>
        <label>
          <span>From number (E.164)</span>
          <input value={from} onChange={e => setFrom(e.target.value)} placeholder="+15551234567" />
        </label>
        <label>
          <span>Verify number (test send — must be a Verified Caller ID on trial)</span>
          <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="+15559876543" />
        </label>
      </div>
      <div className="record-actions" style={{ marginTop: 10 }}>
        <button disabled={busy} onClick={() => submit('none')}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button disabled={busy} onClick={() => submit('sms')}>
          <Send size={14} /> {busy ? 'Verifying…' : 'Save & verify'}
        </button>
      </div>
      <Feedback result={result} />
    </div>
  )
}

export function AccountingConnectForm() {
  const { forms, status, loading, reload } = useCredentials()
  const [provider, setProvider] = useState('webhook')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (forms) {
      setProvider(forms.accounting.provider || 'webhook')
      setWebhookUrl(forms.accounting.webhookUrl || '')
      setWebhookSecret('')
    }
  }, [forms])

  const secretHint = forms?.accounting.webhookSecretSet
    ? 'Saved · leave blank to keep current secret'
    : 'Optional bearer secret (if your hook checks one)'
  const webhook = forms?.accounting.webhook
  const submit = async (test: 'none' | 'accounting') => {
    setBusy(true)
    setResult(null)
    const accounting: Record<string, string> = {}
    if (provider.trim()) accounting.provider = provider.trim()
    if (webhookUrl.trim()) accounting.webhookUrl = webhookUrl.trim()
    if (webhookSecret.trim()) accounting.webhookSecret = webhookSecret.trim()
    const payload: Record<string, unknown> = Object.keys(accounting).length ? { accounting } : {}
    const res = await postCredentials(payload, test, '')
    setResult(res)
    if (res.ok) {
      setWebhookSecret('')
      reload()
    }
    setBusy(false)
  }

  if (loading && !forms) return <p className="muted" style={{ marginTop: 12 }}>Loading accounting settings…</p>

  return (
    <section className="card completion-panel" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <div>
          <small>CONNECT ACCOUNTING</small>
          <h2>
            <Webhook size={16} /> Zapier / webhook credentials
          </h2>
          <p className="muted">
            Paste your Zapier Catch Hook URL (or any POST-JSON webhook) and Save. Use Save & verify to ping it with a test journal line.
          </p>
        </div>
        {status && pill(status.accounting.configured, 'Accounting')}
      </div>
      <div className="form" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'auto 1fr' }}>
        <label>
          <span>Provider</span>
          <select value={provider} onChange={e => setProvider(e.target.value)}>
            <option value="webhook">Zapier / webhook</option>
            <option value="sandbox">Sandbox (no external send)</option>
          </select>
        </label>
        <label>
          <span>Catch Hook URL</span>
          <input
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/hooks/catch/123456/abcdef/"
          />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>Webhook secret (optional)</span>
          <input
            type="password"
            value={webhookSecret}
            onChange={e => setWebhookSecret(e.target.value)}
            placeholder={secretHint}
            autoComplete="off"
          />
        </label>
      </div>
      {webhook && webhookUrl && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {webhook.ok
            ? webhook.isZapierCatchHook
              ? `Looks like a Zapier Catch Hook (${webhook.host}${webhook.path}).`
              : `Host: ${webhook.host}. ${webhook.error || 'Non-Zapier webhooks still work if they accept POST JSON.'}`
            : webhook.error}
        </p>
      )}
      <div className="record-actions" style={{ marginTop: 12 }}>
        <button disabled={busy} onClick={() => submit('none')}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button disabled={busy || !webhookUrl.trim()} onClick={() => submit('accounting')}>
          <Send size={14} /> {busy ? 'Pinging…' : 'Save & verify (ping)'}
        </button>
      </div>
      <Feedback result={result} />
    </section>
  )
}
