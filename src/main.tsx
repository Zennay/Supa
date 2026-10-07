import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requireAppRoot } from './lib/appRoot'
import './styles.css'

createRoot(requireAppRoot(document)).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
