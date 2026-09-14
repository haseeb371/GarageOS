/**
 * Push AI calling env to Vercel Production + set Telnyx Call Control webhook.
 * Loads .env.local. Does not enable DIALER_ENABLED.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'

function loadEnvFile(name: string) {
  const path = join(process.cwd(), name)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

async function telnyx(path: string, init?: RequestInit) {
  const key = process.env.TELNYX_API_KEY
  if (!key) throw new Error('TELNYX_API_KEY missing')
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers || {})
    }
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

function vercelEnvSet(key: string, value: string, envName: string) {
  // Remove existing (ignore failure), then add
  spawnSync('vercel', ['env', 'rm', key, envName, '-y'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: true
  })
  const add = spawnSync('vercel', ['env', 'add', key, envName], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: true,
    input: value + '\n'
  })
  const out = `${add.stdout || ''}${add.stderr || ''}`
  const ok = add.status === 0
  console.log(`[vercel] ${key} → ${envName}: ${ok ? 'ok' : 'FAIL'} ${out.slice(0, 200).replace(/\n/g, ' ')}`)
  return ok
}

async function configureTelnyxWebhook(webhookUrl: string) {
  const from = process.env.TELNYX_FROM_NUMBER || process.env.TELNYX_PHONE_NUMBER || ''
  const connectionId = process.env.TELNYX_CONNECTION_ID || ''

  // Update Call Control Application / connection webhook if possible
  if (connectionId) {
    const patch = await telnyx(`/call_control_applications/${encodeURIComponent(connectionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        webhook_event_url: webhookUrl,
        webhook_event_failover_url: webhookUrl,
        webhook_api_version: '2'
      })
    })
    console.log(
      `[telnyx] call_control_applications PATCH ${connectionId}: ${patch.status}`,
      JSON.stringify(patch.data).slice(0, 240)
    )
    if (!patch.ok) {
      // try connections endpoint alias
      const patch2 = await telnyx(`/connections/${encodeURIComponent(connectionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          webhook_event_url: webhookUrl,
          webhook_api_version: '2'
        })
      })
      console.log(
        `[telnyx] connections PATCH: ${patch2.status}`,
        JSON.stringify(patch2.data).slice(0, 240)
      )
    }
  }

  // Find phone number id and ensure connection + voice settings
  if (from) {
    const list = await telnyx(`/phone_numbers?filter[phone_number]=${encodeURIComponent(from)}`)
    console.log(`[telnyx] phone_numbers lookup: ${list.status}`)
    const rows =
      (list.data as { data?: Array<{ id?: string; connection_id?: string }> })?.data || []
    const phone = rows[0]
    if (phone?.id) {
      const body: Record<string, unknown> = {}
      if (connectionId) body.connection_id = connectionId
      const upd = await telnyx(`/phone_numbers/${phone.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      })
      console.log(`[telnyx] phone_numbers PATCH ${phone.id}: ${upd.status}`)
    } else {
      console.log('[telnyx] phone number not found for', from)
    }
  }
}

async function main() {
  loadEnvFile('.env')
  loadEnvFile('.env.local')

  const assistantId = process.env.TELNYX_ASSISTANT_ID?.trim()
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim()
  const appUrl = (process.env.APP_URL || 'https://autogaragify.com').replace(/\/$/, '')
  const webhookUrl = `${appUrl}/api/telnyx/webhook`

  if (!assistantId || !publicKey) {
    console.error('Need TELNYX_ASSISTANT_ID and TELNYX_PUBLIC_KEY in .env.local')
    process.exit(1)
  }

  console.log('Webhook URL:', webhookUrl)

  // Vercel Production (+ Preview so previews also work)
  for (const envName of ['production', 'preview']) {
    vercelEnvSet('TELNYX_PUBLIC_KEY', publicKey, envName)
    vercelEnvSet('TELNYX_ASSISTANT_ID', assistantId, envName)
    vercelEnvSet('APP_URL', appUrl, envName)
    if (process.env.TELNYX_FROM_NUMBER) {
      vercelEnvSet('TELNYX_FROM_NUMBER', process.env.TELNYX_FROM_NUMBER, envName)
    }
    if (process.env.CRON_SECRET) {
      vercelEnvSet('CRON_SECRET', process.env.CRON_SECRET, envName)
    }
    if (process.env.LEADS_IMPORT_SHOP_ID) {
      vercelEnvSet('LEADS_IMPORT_SHOP_ID', process.env.LEADS_IMPORT_SHOP_ID, envName)
    }
    if (process.env.TELNYX_CONNECTION_ID) {
      vercelEnvSet('TELNYX_CONNECTION_ID', process.env.TELNYX_CONNECTION_ID, envName)
    }
    // Keep dialer off on Vercel
    vercelEnvSet('DIALER_ENABLED', 'false', envName)
  }

  await configureTelnyxWebhook(webhookUrl)

  console.log('\nTriggering production redeploy...')
  const deploy = spawnSync('vercel', ['deploy', '--prod', '--yes'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: true
  })
  console.log((deploy.stdout || '').slice(-500))
  console.log((deploy.stderr || '').slice(-500))

  // Health check
  try {
    const health = await fetch(`${appUrl}/api/telnyx/health`)
    const body = await health.json()
    console.log('\nHealth:', health.status, JSON.stringify(body))
  } catch (e) {
    console.log('Health check failed (may need redeploy finish):', e instanceof Error ? e.message : e)
  }

  console.log('\nDone. SALES_TRANSFER_NUMBER still needs your human phone — I cannot invent that.')
  console.log('If Telnyx webhook PATCH failed, set webhook URL manually in Mission Control to:', webhookUrl)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
