// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import MapPage from './pages/MapPage'
import RoutesPage from './pages/RoutesPage'
import DriversPage from './pages/DriversPage'   // <-- add this
import './styles/dashboard.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/routes" element={<RoutesPage />} />
        <Route path="/drivers" element={<DriversPage />} /> {/* new */}
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
