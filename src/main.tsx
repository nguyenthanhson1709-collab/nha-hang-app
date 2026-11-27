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

// Ngân hàng (Enable Banking) trả về https://app.../?code=...&state=... -> chuyển sang trang #/bank-callback
{
  const q = new URLSearchParams(location.search)
  if (q.get('state') && (q.get('code') || q.get('error'))) history.replaceState(null, '', `${location.pathname}#/bank-callback?${q}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
