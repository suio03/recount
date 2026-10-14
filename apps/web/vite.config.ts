import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Read the repo-root .env for where the API runs. The dashboard signs in like in production.
  const env = loadEnv(mode, '../..', '')
  const api = env.PUBLIC_URL || 'http://localhost:8787'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': api,
      },
    },
  }
})
