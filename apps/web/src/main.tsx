import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill'
import flagFont from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ApiError } from './api'
import './index.css'

// Windows has no flag emoji. There, a font with only the flags is loaded, from this server.
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFont)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Signed out stays signed out until the form is sent; retrying only delays it.
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status === 401) && failures < 3,
    },
  },
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
