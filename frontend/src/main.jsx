import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { FleetProvider } from './state/FleetContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FleetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </FleetProvider>
  </StrictMode>,
)
