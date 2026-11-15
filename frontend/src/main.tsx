import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { MissionProvider } from './state/mission'
import { ToastProvider } from './state/toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MissionProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </MissionProvider>
  </StrictMode>,
)
