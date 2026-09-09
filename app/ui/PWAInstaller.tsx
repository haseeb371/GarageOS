'use client'
import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PWAInstaller() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setInstalled(true)
      return
    }

    const dismissed = localStorage.getItem('autogaragify-pwa-dismissed')
    if (dismissed) return

    const handler = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
      setTimeout(() => setShowPrompt(true), 3000)
    }

    const installedHandler = () => {
      setInstalled(true)
      setShowPrompt(false)
      setInstallEvent(null)
    }

    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', installedHandler)

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const install = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice.outcome === 'accepted') {
      setInstalled(true)
    }
    setShowPrompt(false)
    setInstallEvent(null)
  }

  const dismiss = () => {
    setShowPrompt(false)
    localStorage.setItem('autogaragify-pwa-dismissed', 'yes')
  }

  if (installed || !showPrompt || !installEvent) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: 20,
        right: 20,
        maxWidth: 440,
        margin: '0 auto',
        background: '#fffdf8',
        border: '1px solid #c7d9c8',
        borderRadius: 14,
        boxShadow: '0 12px 36px #203b2a18',
        padding: '18px 20px',
        zIndex: 1000,
        display: 'flex',
        gap: 14,
        alignItems: 'center'
      }}
    >
      <div style={{ width: 44, height: 44, borderRadius: 12, background: '#d8e767', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 800, color: '#17261f', flexShrink: 0 }}>A</div>
      <div style={{ flex: 1 }}>
        <b style={{ fontSize: 15 }}>Install AutoGaragify</b>
        <div style={{ fontSize: 13, color: '#68736d' }}>Add to your home screen for quick access — works like an app.</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={dismiss} style={{ border: '1px solid #dedbd1', borderRadius: 8, background: '#fff', padding: '8px 12px', color: '#68736d', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Later</button>
        <button onClick={install} style={{ border: 0, borderRadius: 8, background: '#176448', color: '#fff', padding: '8px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Install</button>
      </div>
    </div>
  )
}

export function PWANotifications({ requestOnMount = false }: { requestOnMount?: boolean }) {
  const [permission, setPermission] = useState<string>('default')

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    setPermission(Notification.permission)
    if (requestOnMount && Notification.permission === 'default') {
      Notification.requestPermission().then(setPermission)
    }
  }, [requestOnMount])

  const request = async () => {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') {
      new Notification('AutoGaragify notifications enabled', {
        body: 'You will be notified about new jobs, estimate approvals, and payment events.',
        icon: '/icon.svg'
      })
    }
  }

  if (permission === 'granted') return null

  return (
    <button onClick={request} className="btn secondary" style={{ fontSize: 13 }}>
      Enable notifications
    </button>
  )
}
