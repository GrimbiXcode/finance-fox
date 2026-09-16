import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { ThemeProvider } from 'next-themes'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from '@/lib/serviceWorker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </StrictMode>,
)

// Offline-Betrieb: nur im Produktions-Build und nur über HTTPS/localhost.
void registerServiceWorker()
