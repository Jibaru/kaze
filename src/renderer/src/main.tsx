import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted rather than fetched from fonts.googleapis.com: a desktop app
// should not need the network to render text, and it keeps the renderer's CSP
// closed to remote origins.
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '@fontsource/roboto-mono/400.css'
import '@fontsource/roboto-mono/500.css'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
