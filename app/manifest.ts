import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AutoGaragify — Shop Management',
    short_name: 'AutoGaragify',
    description: 'Independent auto shop operations — repair orders, inspections, inventory, invoicing',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f1e8',
    theme_color: '#176448',
    orientation: 'any',
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [
      { name: 'Repair Orders', url: '/?section=orders', icons: [{ src: '/icon.svg', sizes: 'any' }] },
      { name: 'Inspections', url: '/?section=inspections', icons: [{ src: '/icon.svg', sizes: 'any' }] },
      { name: 'Inventory', url: '/?section=inventory', icons: [{ src: '/icon.svg', sizes: 'any' }] }
    ]
  }
}
