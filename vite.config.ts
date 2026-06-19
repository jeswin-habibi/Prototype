import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed to GitHub Pages at https://jeswin-habibi.github.io/Prototype/
export default defineConfig({
  base: '/Prototype/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Re-Pack IQ',
        short_name: 'Re-Pack IQ',
        description: 'Smart parent-to-child repacking, costing & insights',
        theme_color: '#0f766e',
        background_color: '#0f766e',
        display: 'standalone',
        scope: '/Prototype/',
        start_url: '/Prototype/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
