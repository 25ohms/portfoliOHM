import './utils/performanceLogger'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@fontsource/michroma/latin-400.css'
import '@fontsource/space-mono/latin-400.css'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
