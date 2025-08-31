// src/pages/MapPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import customMarker from '../assets/location.png'
import { ZONES, POINTS } from '../data/zones'

export default function MapPage() {
  const navigate = useNavigate()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const searchMarkerRef = useRef<L.Marker | null>(null)

  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  // one icon reused everywhere
  const iconRef = useRef(
    L.icon({
      iconUrl: customMarker,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -32],
    })
  )

  useEffect(() => {
    if (!containerRef.current) return

    const map = L.map(containerRef.current, { center: [12.96, 77.62], zoom: 12 })
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    // Zones
    const zoneLayer = L.geoJSON(ZONES as any, {
      style: (f: any) => ({
        color: f?.properties?.stroke ?? '#2e7d32',
        weight: f?.properties?.['stroke-width'] ?? 1.2,
        opacity: f?.properties?.['stroke-opacity'] ?? 1,
        fillColor: f?.properties?.fill ?? '#2e7d32',
        fillOpacity: f?.properties?.['fill-opacity'] ?? 0.3,
      }),
      onEachFeature: (f: any, layer) => layer.bindPopup(f?.properties?.name ?? 'Zone'),
    }).addTo(map)

    // Points
    const pointLayer = L.geoJSON(POINTS as any, {
      pointToLayer: (_f, latlng) => L.marker(latlng, { icon: iconRef.current }),
      onEachFeature: (f: any, layer) => {
        const name = f?.properties?.name ?? 'Point'
        layer.bindPopup(name)
      },
    }).addTo(map)

    // Fit bounds
    const all = L.featureGroup([zoneLayer, pointLayer])
    map.fitBounds(all.getBounds(), { padding: [20, 20] })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // ---- helpers ----
  function parseCoords(input: string): { lat: number; lng: number } | null {
    const parts = input.trim().split(/[,\s]+/).filter(Boolean)
    if (parts.length < 2) return null
    let a = Number(parts[0])
    let b = Number(parts[1])
    if (!isFinite(a) || !isFinite(b)) return null
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a] // swap if lng first
    if (Math.abs(a) > 90 || Math.abs(b) > 180) return null
    return { lat: a, lng: b }
  }

  function handleSearch(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)

    const coords = parseCoords(query)
    if (!coords) {
      setError('Enter coordinates as "lat,lng" (e.g., 12.9716, 77.5946)')
      return
    }
    const map = mapRef.current
    if (!map) return

    if (!searchMarkerRef.current) {
      searchMarkerRef.current = L.marker([coords.lat, coords.lng], { icon: iconRef.current })
        .addTo(map)
        .bindPopup(`Search: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`)
    } else {
      searchMarkerRef.current.setLatLng([coords.lat, coords.lng])
      searchMarkerRef.current.setPopupContent(
        `Search: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`
      )
    }
    map.setView([coords.lat, coords.lng], Math.max(map.getZoom(), 14))
    searchMarkerRef.current.openPopup()
  }

  function clearSearch() {
    setQuery('')
    setError(null)
    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove()
      searchMarkerRef.current = null
    }
  }

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100vw', background: '#0b0f16' }}>
      {/* Map container */}
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />

      {/* Back button (top-left, offset from zoom controls) */}
      <button
        onClick={() => navigate(-1)}
        style={{
          position: 'absolute',
          top: 16,
          left: 60, // space for Leaflet zoom control
          background: '#2b2b2b',
          color: '#e5e7eb',
          border: '1px solid #404040',
          borderRadius: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          zIndex: 500,
        }}
      >
        ← Back
      </button>

      {/* Search box (top-right) */}
      <form
        onSubmit={handleSearch}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          background: 'rgba(18, 24, 38, 0.92)',
          border: '1px solid #1e293b',
          padding: '10px 12px',
          borderRadius: 12,
          boxShadow: '0 10px 30px rgba(0,0,0,.35)',
          zIndex: 500,
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="lat,lng  →  12.9716, 77.5946"
          style={{
            width: 260,
            color: '#e5e7eb',
            background: '#0b0f16',
            border: '1px solid #273449',
            borderRadius: 8,
            padding: '8px 10px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            background: '#1f3b78',
            color: 'white',
            border: '1px solid #27468e',
            borderRadius: 8,
            padding: '8px 12px',
            cursor: 'pointer',
          }}
        >
          Go
        </button>
        <button
          type="button"
          onClick={clearSearch}
          style={{
            background: '#2b2b2b',
            color: '#e5e7eb',
            border: '1px solid #404040',
            borderRadius: 8,
            padding: '8px 12px',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </form>

      {/* Error toast */}
      {error && (
        <div
          style={{
            position: 'absolute',
            top: 70,
            left: 60,
            background: '#3b1d1d',
            color: '#ffbdbd',
            border: '1px solid #6b2a2a',
            padding: '8px 12px',
            borderRadius: 8,
            zIndex: 500,
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
