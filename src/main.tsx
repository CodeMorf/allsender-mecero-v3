import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // La URL versionada evita que una copia CDN antigua del service worker
    // impida renovar el shell PWA después de una publicación web.
    navigator.serviceWorker.register('/sw.js?release=c1eadc5', { scope: '/' }).catch(() => {
      // La app conserva sus datos en IndexedDB aunque el shell no pueda instalarse.
    })
  })
}
