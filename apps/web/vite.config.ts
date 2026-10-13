import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Read the repo-root .env. ADMIN_TOKEN stays on the dev server and is never bundled.
  const env = loadEnv(mode, '../..', '')
  const api = env.PUBLIC_URL || 'http://localhost:8787'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': { target: api, headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } },
      },
    },
  }
})
