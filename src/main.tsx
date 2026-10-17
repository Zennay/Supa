import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requireAppRoot } from './lib/appRoot'
import { syncBeforeRender } from './lib/syncBoot'
import './styles.css'
import './features/home/hifi.css'

const root = requireAppRoot(document.getElementById('root'))

// Restore this device's saved planning from the API first (bounded wait), so
// the app's first localStorage read already sees it. Without an API it simply
// renders the local copy.
void syncBeforeRender().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
