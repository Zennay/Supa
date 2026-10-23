import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requireAppRoot } from './lib/appRoot'
import './styles.css'
import './features/home/hifi.css'

createRoot(requireAppRoot(document.getElementById('root'))).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
