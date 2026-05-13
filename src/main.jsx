import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/ui/Toast'
import './index.css'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <HelmetProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </HelmetProvider>
    </ErrorBoundary>
  </StrictMode>,
)
