import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CompanyProvider } from './context/CompanyContext'
import { TLFilterProvider } from './context/TLFilterContext'
import { AccessControlProvider } from './context/AccessControlContext'
import App from './App.tsx'
import './index.css'


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <TLFilterProvider>
          <CompanyProvider>
            <AccessControlProvider>
              <App />
            </AccessControlProvider>
          </CompanyProvider>
        </TLFilterProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
