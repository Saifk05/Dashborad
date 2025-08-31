import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ors': {
        target: 'https://api.openrouteservice.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ors/, ''),
      },
    },
  },
})
