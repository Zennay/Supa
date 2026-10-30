import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requireAppRoot } from './lib/appRoot'
import './styles.css'
import './features/home/hifi.css'
import { loadCatalog } from './services/productCatalog'

loadCatalog()

createRoot(requireAppRoot(document.getElementById('root'))).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
