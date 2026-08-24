import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerServiceWorker } from './lib/updater'
import { watchViewport } from './lib/viewport'
import './styles/tokens.css'
import './styles/app.css'

registerServiceWorker()
// キーボードが出ている間も、ポップアップを見えている範囲に収める
watchViewport()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
