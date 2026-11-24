import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { watchUpdates } from './lib/update'
import { swipeBack } from './lib/swipe'
import { blockStrayDrops } from './lib/drop'

watchUpdates()
swipeBack()
blockStrayDrops()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
