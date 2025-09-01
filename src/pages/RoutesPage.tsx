// src/pages/RoutesPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
  type DragStart,
} from '@hello-pangea/dnd'

import customMarker from '../assets/location.png'
import { ZONES, POINTS } from '../data/zones'

/** ───────── CONFIG ───────── */
const SHEET_API_URL =
  'https://script.google.com/macros/s/AKfycbwatw81htOsjgcYrHGZxLPVw6wiWDkYFn509mlAEvG6ROnYqEpuKug0JSWO6NaRRfxsQw/exec'

// Prefer env: const ORS_KEY = import.meta.env.VITE_ORS_KEY as string
const ORS_KEY =
  'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjI4MWM5NThhY2NlZDBkOTBkNmQ0YmUxNmFiOTNhZDU0ZTlhZDA1ODRmNDU2YTBhM2ViYTRjNDZhIiwiaCI6Im11cm11cjY0In0='

const FALLBACK_LAUNDRY_LATLNG: [number, number] = [12.935, 77.614]

type Task = {
  id: number
  name: string
  timeSlot: string
  lat: number
  lng: number
  type: string
  assignedDriver?: string
}

type Driver = {
  id: string
  name: string
  status: string
  color: string
}

const drvKey = (id: string) => `drv:${id}`

export default function RoutesPage() {
  const navigate = useNavigate()

  // Two drivers (sample)
  const [drivers] = useState<Driver[]>([
    { id: 'rakesh', name: 'Rakesh',     status: 'Available', color: '#8b5e3c' }, // brown
    { id: 'jagannath', name: 'Jagannath', status: 'On Route',  color: '#3b82f6' }, // blue
  ])

  // driverId -> ordered task id strings
  const [assign, setAssign] = useState<Record<string, string[]>>({
    rakesh: [],
    jagannath: [],
  })

  // Map refs/state
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const taskLayerRef = useRef<L.LayerGroup | null>(null)
  const routeLayerRef = useRef<L.GeoJSON | null>(null)
  const searchMarkerRef = useRef<L.Marker | null>(null)

  const iconRef = useRef(
    L.icon({
      iconUrl: customMarker,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -32],
    })
  )

  // Tasks + filter
  const [tasks, setTasks] = useState<Task[]>([])
  const [timeFilter, setTimeFilter] = useState('All')
  const timeOptions = useMemo(() => {
    const s = new Set<string>()
    tasks.forEach((t) => t.timeSlot && s.add(t.timeSlot))
    return ['All', ...Array.from(s)]
  }, [tasks])

  const originRef = useRef<[number, number] | null>(null) // [lng,lat]

  const tasksById = useMemo(() => {
    const m: Record<string, Task> = {}
    for (const t of tasks) m[String(t.id)] = t
    return m
  }, [tasks])

  /** Leaflet init */
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    const map = L.map(mapContainerRef.current, { center: [12.96, 77.62], zoom: 12 })
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

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

    const pointLayer = L.geoJSON(POINTS as any, {
      pointToLayer: (_f, latlng) => L.marker(latlng, { icon: iconRef.current }),
      onEachFeature: (f: any, layer) => {
        const name = f?.properties?.name ?? 'Point'
        layer.bindPopup(name)
        layer.on('click', () => {
          if (Array.isArray(f?.geometry?.coordinates)) {
            const [lng, lat] = f.geometry.coordinates
            originRef.current = [lng, lat]
            L.popup()
              .setLatLng([lat, lng])
              .setContent(`<b>Origin set:</b> ${name}`)
              .openOn(mapRef.current!)
          }
        })
      },
    }).addTo(map)

    taskLayerRef.current = L.layerGroup().addTo(map)

    const all = L.featureGroup([zoneLayer, pointLayer])
    map.fitBounds(all.getBounds(), { padding: [20, 20] })

    originRef.current = getLaundryLngLat()

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  /** Load tasks and seed assignments from sheet */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(SHEET_API_URL, { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return

        const rows = Array.isArray(data?.rows) ? (data.rows as Task[]) : []
        setTasks(rows)

        // Build initial assignment from sheet's "Assigned Driver"
        const byDrv: Record<string, string[]> = drivers.reduce((acc, d) => {
          acc[d.id] = []
          return acc
        }, {} as Record<string, string[]>)

        for (const t of rows) {
          const drv = drivers.find(
            (d) => d.name.toLowerCase() === String(t.assignedDriver || '').toLowerCase()
          )
          if (drv) byDrv[drv.id].push(String(t.id))
        }
        setAssign(byDrv)
      } catch (e) {
        console.error('Failed to load tasks:', e)
        if (!cancelled) setTasks([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [drivers])

  /** Helpers */
  function getLaundryLngLat(): [number, number] {
    try {
      const f = (POINTS as any)?.features?.find(
        (x: any) => x?.properties?.name?.toLowerCase() === 'laundry'
      )
      if (f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
        return [f.geometry.coordinates[0], f.geometry.coordinates[1]] // [lng,lat]
      }
    } catch {}
    // fallback converts [lat,lng] to [lng,lat]
    return [FALLBACK_LAUNDRY_LATLNG[1], FALLBACK_LAUNDRY_LATLNG[0]]
  }

  function normalizeToGeoJSON(resp: any): { geojson: any; summary: any } {
    // ORS GeoJSON form
    if (resp && resp.type === 'FeatureCollection' && Array.isArray(resp.features)) {
      const props = resp.features?.[0]?.properties
      const summary = props?.summary ?? props?.segments?.reduce(
        (acc: any, s: any) => ({
          distance: (acc?.distance ?? 0) + (s?.distance ?? 0),
          duration: (acc?.duration ?? 0) + (s?.duration ?? 0),
        }),
        { distance: 0, duration: 0 }
      )
      return { geojson: resp, summary }
    }
    // ORS JSON form
    const route = resp?.routes?.[0]
    if (route?.geometry?.type && Array.isArray(route?.geometry?.coordinates)) {
      const feature = {
        type: 'Feature',
        properties: { summary: route.summary ?? null },
        geometry: route.geometry,
      }
      return { geojson: { type: 'FeatureCollection', features: [feature] }, summary: route.summary ?? null }
    }
    throw new Error('Unexpected ORS response format')
  }

  async function fetchSingleLeg(origin: [number, number], dest: [number, number]) {
    try {
      const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
        method: 'POST',
        headers: { Authorization: ORS_KEY, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
        body: JSON.stringify({ coordinates: [origin, dest], preference: 'fastest', units: 'm', instructions: false }),
      })
      if (!res.ok) throw new Error(`POST /geojson ${res.status}: ${await res.text()}`)
      return normalizeToGeoJSON(await res.json())
    } catch {
      const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
        method: 'POST',
        headers: { Authorization: ORS_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ coordinates: [origin, dest], preference: 'fastest', units: 'm', instructions: false }),
      })
      if (!res.ok) throw new Error(`POST /json ${res.status}: ${await res.text()}`)
      return normalizeToGeoJSON(await res.json())
    }
  }

  /** NEW: fetch a single multi-stop route for a driver (Laundry -> tasks... -> Laundry) */
  async function fetchMultiStopRoute(coordinates: [number, number][]) {
    if (coordinates.length < 2) throw new Error('Need at least start and end coordinates')
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: { Authorization: ORS_KEY, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
      body: JSON.stringify({
        coordinates,
        preference: 'fastest',
        units: 'm',
        instructions: false,
      }),
    })
    if (!res.ok) throw new Error(`Multi-stop route failed: ${res.status} ${await res.text()}`)
    return normalizeToGeoJSON(await res.json())
  }

  function drawRoute(geojson: any) {
    const map = mapRef.current
    if (!map) return
    if (routeLayerRef.current) {
      routeLayerRef.current.remove()
      routeLayerRef.current = null
    }
    routeLayerRef.current = L.geoJSON(geojson, { style: { color: '#6d28d9', weight: 5, opacity: 0.95 } }).addTo(map)
    try {
      const b = routeLayerRef.current.getBounds()
      if (b.isValid()) map.fitBounds(b, { padding: [24, 24] })
    } catch {}
  }

  /** Persist a single assignment to the sheet */
  async function saveAssignmentToSheet(taskId: number, driverName: string) {
    try {
      await fetch(SHEET_API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ id: taskId, assignedDriver: driverName }), // '' clears
        cache: 'no-store',
      })
    } catch (err) {
      console.error('Failed to save assignment:', err)
    }
  }

  /** ───────── ROUTE/ETA CLEARING ───────── */
  function clearEta() {
    const map = mapRef.current
    if (!map) return
    if (routeLayerRef.current) {
      routeLayerRef.current.remove()
      routeLayerRef.current = null
    }
    map.closePopup()
  }

  // Optional: quick clear with Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearEta()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** NEW: Build ordered coordinates for a given driver */
  function coordsForDriver(driverId: string): [number, number][] {
    const start = originRef.current ?? getLaundryLngLat() // [lng,lat]
    const orderedTaskIds = assign[driverId] || []
    const waypoints: [number, number][] = []

    for (const tid of orderedTaskIds) {
      const t = tasksById[tid]
      if (!t || !isFinite(t.lat) || !isFinite(t.lng)) continue
      waypoints.push([t.lng, t.lat]) // ORS expects [lng,lat]
    }

    return [start, ...waypoints, start]
  }

  /** NEW: Route button handler per driver */
  async function routeDriver(driverId: string) {
    const map = mapRef.current
    if (!map) return
    const coords = coordsForDriver(driverId)
    if (coords.length < 2) {
      L.popup()
        .setLatLng(map.getCenter())
        .setContent('No tasks assigned for this driver.')
        .openOn(map)
      return
    }
    const loadingPos = routeLayerRef.current?.getBounds().getCenter() ?? map.getCenter()
    const loading = L.popup().setLatLng(loadingPos).setContent('Building multi-stop route…').openOn(map)
    try {
      const { geojson, summary } = await fetchMultiStopRoute(coords)
      drawRoute(geojson)
      const distKm = summary?.distance != null ? Math.round((summary.distance / 1000) * 10) / 10 : null
      const durMin = summary?.duration != null ? Math.round(summary.duration / 60) : null
      loading.setContent(
        distKm != null && durMin != null
          ? `<b>Total Route</b><br/>Distance: ${distKm} km<br/>Duration: ${durMin} min`
          : 'Route ready'
      )
    } catch (e: any) {
      loading.setContent(`Could not build multi-stop route.<br/>${String(e?.message || e)}`)
    }
  }

  /** Markers colored by assignment + single-stop ETA on click */
  useEffect(() => {
    const taskLayer = taskLayerRef.current
    if (!taskLayer) return
    taskLayer.clearLayers()

    // taskId -> driverId (if assigned)
    const assignedTo: Record<string, string | null> = {}
    for (const d of drivers) for (const idStr of assign[d.id] || []) assignedTo[idStr] = d.id

    const norm = (s: string) => (s || '').trim().toLowerCase()
    const want = norm(timeFilter)

    tasks.forEach((t) => {
      if (!isFinite(t.lat) || !isFinite(t.lng)) return
      if (want !== 'all' && norm(t.timeSlot) !== want) return

      const isPick = ['pick', 'pickup'].includes(norm(t.type))
      const baseColor = isPick ? '#22c55e' : '#ef4444'
      const assignedDriverId = assignedTo[String(t.id)]
      const driverColor = assignedDriverId ? drivers.find((d) => d.id === assignedDriverId)?.color : undefined
      const color = driverColor ?? baseColor

      const marker = L.circleMarker([t.lat, t.lng], {
        radius: 8,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      }).addTo(taskLayer)

      marker.bindPopup(
        `<div style="min-width:200px">
          <strong>${t.name || 'Task'}</strong><br/>
          <span>${t.timeSlot || '-'}</span><br/>
          <span>Type: <b>${(t.type || '').toUpperCase()}</b></span><br/>
          ${
            assignedDriverId
              ? `<span>Assigned: <b>${drivers.find((d) => d.id === assignedDriverId)?.name}</b></span><br/>`
              : ''
          }
          <small>${t.lat.toFixed(6)}, ${t.lng.toFixed(6)}</small>
        </div>`
      )

      // Keep single-click ETA for convenience
      marker.on('click', async () => {
        const map = mapRef.current
        if (!map) return
        const origin = originRef.current ?? getLaundryLngLat()
        const loading = L.popup().setLatLng([t.lat, t.lng]).setContent('Fetching route…').openOn(map)
        try {
          const { geojson, summary } = await fetchSingleLeg(origin, [t.lng, t.lat])
          drawRoute(geojson)
          const distKm = summary?.distance != null ? Math.round((summary.distance / 1000) * 10) / 10 : null
          const durMin = summary?.duration != null ? Math.round(summary.duration / 60) : null
          loading.setContent(
            distKm != null && durMin != null
              ? `<b>ETA</b><br/>Distance: ${distKm} km<br/>Duration: ${durMin} min`
              : 'No summary'
          )
        } catch (e: any) {
          loading.setContent(`Could not get route/ETA.<br/>${String(e?.message || e)}`)
        }
      })
    })
  }, [tasks, timeFilter, assign, drivers])

  /** Manual “Show on Map” */
  const [mapQuery, setMapQuery] = useState('')
  function parseCoords(input: string): { lat: number; lng: number } | null {
    const parts = input.trim().split(/[,\s]+/).filter(Boolean)
    if (parts.length < 2) return null
    let a = Number(parts[0]), b = Number(parts[1])
    if (!isFinite(a) || !isFinite(b)) return null
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a]
    if (Math.abs(a) > 90 || Math.abs(b) > 180) return null
    return { lat: a, lng: b }
  }
  function showOnEmbeddedMap() {
    const q = mapQuery.trim()
    if (!q || !mapRef.current) return
    const coords = parseCoords(q)
    if (!coords) return
    const map = mapRef.current
    if (!searchMarkerRef.current) {
      searchMarkerRef.current = L.marker([coords.lat, coords.lng], { icon: iconRef.current })
        .addTo(map)
        .bindPopup(`Search: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`)
    } else {
      searchMarkerRef.current.setLatLng([coords.lat, coords.lng])
      searchMarkerRef.current.setPopupContent(`Search: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`)
    }
    map.setView([coords.lat, coords.lng], Math.max(map.getZoom(), 14))
    searchMarkerRef.current.openPopup()
  }

  /** ───────── DND (use LEFT drivers as droppables) ───────── */
  function onDragStart(_start: DragStart) {
    mapRef.current?.dragging.disable()
    mapRef.current?.doubleClickZoom.disable()
    mapRef.current?.scrollWheelZoom.disable()
    mapRef.current?.boxZoom.disable()
    mapRef.current?.keyboard.disable()
  }

  function onDragEnd(result: DropResult) {
    mapRef.current?.dragging.enable()
    mapRef.current?.doubleClickZoom.enable()
    mapRef.current?.scrollWheelZoom.enable()
    mapRef.current?.boxZoom.enable()
    mapRef.current?.keyboard.enable()

    const { source, destination, draggableId } = result
    if (!destination) return

    const src = source.droppableId
    const dst = destination.droppableId
    const srcIsDrv = src.startsWith('drv:')
    const dstIsDrv = dst.startsWith('drv:')

    // Tasks → driver
    if (src === 'tasks' && dstIsDrv) {
      const driverId = dst.replace('drv:', '')
      const driverName = drivers.find((d) => d.id === driverId)?.name ?? ''
      setAssign((prev) => {
        const next: Record<string, string[]> = {}
        // remove from all drivers first (a task belongs to only one driver)
        for (const d of drivers) next[d.id] = (prev[d.id] || []).filter((x) => x !== draggableId)
        next[driverId].splice(destination.index, 0, draggableId)
        return next
      })
      saveAssignmentToSheet(Number(draggableId), driverName)
      clearEta()
      return
    }

    // driver → Tasks (unassign)
    if (srcIsDrv && dst === 'tasks') {
      const fromId = src.replace('drv:', '')
      setAssign((prev) => ({
        ...prev,
        [fromId]: (prev[fromId] || []).filter((_id, i) => i !== source.index),
      }))
      saveAssignmentToSheet(Number(draggableId), '')
      clearEta()
      return
    }

    // reorder within same driver
    if (srcIsDrv && dstIsDrv && src === dst) {
      const dId = src.replace('drv:', '')
      setAssign((prev) => {
        const arr = [...(prev[dId] || [])]
        const [m] = arr.splice(source.index, 1)
        arr.splice(destination.index, 0, m)
        return { ...prev, [dId]: arr }
      })
      clearEta()
      return
    }

    // move between drivers
    if (srcIsDrv && dstIsDrv && src !== dst) {
      const fromId = src.replace('drv:', '')
      const toId = dst.replace('drv:', '')
      setAssign((prev) => {
        const from = [...(prev[fromId] || [])]
        const [m] = from.splice(source.index, 1)
        const to = [...(prev[toId] || [])]
        to.splice(destination.index, 0, m)
        return { ...prev, [fromId]: from, [toId]: to }
      })
      const toName = drivers.find((d) => d.id === toId)?.name ?? ''
      saveAssignmentToSheet(Number(draggableId), toName)
      clearEta()
    }
  }

  // visible unassigned (filtered)
  const visibleUnassigned = useMemo(() => {
    const want = (timeFilter || '').trim().toLowerCase()
    const inFilter = tasks.filter(
      (t) => want === 'all' || (t.timeSlot || '').trim().toLowerCase() === want
    )
    const assignedSet = new Set(Object.values(assign).flat())
    return inFilter.filter((t) => !assignedSet.has(String(t.id)))
  }, [tasks, timeFilter, assign])

  // clear driver button (also clears in sheet)
  async function clearDriver(dId: string) {
    const toClear = assign[dId] || []
    setAssign((prev) => ({ ...prev, [dId]: [] }))
    await Promise.all(toClear.map((tid) => saveAssignmentToSheet(Number(tid), '')))
    clearEta()
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: '#0b0f16', color: '#e5e7eb' }}>
      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* LEFT: Drivers (droppable) */}
        <div
          style={{
            width: 280,
            background: '#121826',
            borderRight: '1px solid #1e293b',
            display: 'flex',
            flexDirection: 'column',
            padding: 16,
          }}
        >
          <button
            onClick={() => navigate(-1)}
            style={{
              background: '#2b2b2b',
              color: '#e5e7eb',
              border: '1px solid #404040',   // ← fixed here
              borderRadius: 8,
              padding: '8px 12px',
              cursor: 'pointer',
              marginBottom: 16,
            }}
          >
            ← Back
          </button>

          <h3 style={{ marginBottom: 12 }}>Drivers</h3>

          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, display: 'grid', gap: 10 }}>
            {drivers.map((d) => (
              <div
                key={d.id}
                style={{
                  background: '#1e293b',
                  borderRadius: 8,
                  border: `1px solid ${d.color}`,
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{d.name}</strong>
                    <div style={{ fontSize: 13, color: d.color }}>{d.status}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Assigned: {(assign[d.id] || []).length}</div>
                  </div>

                  <div style={{ display: 'grid', gap: 6 }}>
                    <button
                      onClick={() => clearDriver(d.id)}
                      style={{
                        background: '#2b2b2b',
                        color: '#e5e7eb',
                        border: '1px solid #404040',
                        borderRadius: 6,
                        padding: '6px 10px',
                        cursor: 'pointer',
                      }}
                      title="Clear this driver's tasks"
                    >
                      Clear
                    </button>

                    {/* NEW: Route button */}
                    <button
                      onClick={() => routeDriver(d.id)}
                      style={{
                        background: d.color,
                        color: '#0b0f16',
                        border: `1px solid ${d.color}`,
                        borderRadius: 6,
                        padding: '6px 10px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                      title="Draw multi-stop route (Laundry → tasks → Laundry)"
                    >
                      Route
                    </button>
                  </div>
                </div>

                <Droppable droppableId={drvKey(d.id)} type="TASK">
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      style={{ padding: 10, display: 'grid', gap: 6, minHeight: 48 }}
                    >
                      {(assign[d.id] || []).map((tid, i) => {
                        const t = tasksById[tid]
                        if (!t) return null
                        return (
                          <Draggable key={tid} draggableId={tid} index={i}>
                            {(prov, snap) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                {...prov.dragHandleProps}
                                style={{
                                  ...prov.draggableProps.style,
                                  background: snap.isDragging ? '#243244' : '#0f1522',
                                  borderRadius: 6,
                                  padding: '8px 12px',
                                  fontSize: 13,
                                  cursor: 'grab',
                                }}
                                title={`${t.timeSlot || ''} ${t.type ? '• ' + t.type : ''}`}
                              >
                                {i + 1}. {t.name}
                              </div>
                            )}
                          </Draggable>
                        )
                      })}
                      {provided.placeholder}
                      {(assign[d.id] || []).length === 0 && (
                        <div style={{ fontSize: 12, color: '#9aa4b2' }}>Drag tasks here</div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Main (map + controls + Tasks list) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              padding: 16,
              borderBottom: '1px solid #1e293b',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <h2 style={{ marginRight: 'auto' }}>Route Planning</h2>

            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
              style={{
                background: '#0b0f16',
                color: '#e5e7eb',
                border: '1px solid #273449',
                borderRadius: 8,
                padding: '8px 10px',
              }}
            >
              {timeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>

            <input
              value={mapQuery}
              onChange={(e) => setMapQuery(e.target.value)}
              placeholder="lat,lng → 12.9716,77.5946"
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
              onClick={showOnEmbeddedMap}
              style={{
                background: '#1f3b78',
                color: 'white',
                border: '1px solid #27468e',
                borderRadius: 8,
                padding: '8px 12px',
                cursor: 'pointer',
              }}
            >
              Show on Map
            </button>

            <button
              onClick={clearEta}
              style={{
                background: '#2b2b2b',
                color: '#e5e7eb',
                border: '1px solid #404040',
                borderRadius: 8,
                padding: '8px 12px',
                cursor: 'pointer',
              }}
              title="Remove the current route and ETA popup"
            >
              Clear ETA
            </button>
          </div>

          <div style={{ flex: 1, margin: 16, border: '1px solid #1e293b', position: 'relative' }}>
            <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />

            {/* Legend */}
            <div
              style={{
                position: 'absolute',
                left: 12,
                bottom: 12,
                zIndex: 500,
                background: 'rgba(18,24,38,.92)',
                border: '1px solid #1e293b',
                borderRadius: 8,
                padding: '6px 8px',
                fontSize: 12,
              }}
            >
              <div>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#22c55e', borderRadius: 3, marginRight: 6 }} />
                Pick
              </div>
              <div>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#ef4444', borderRadius: 3, marginRight: 6 }} />
                Drop
              </div>
              {drivers.map((d) => (
                <div key={d.id}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      background: d.color,
                      borderRadius: 3,
                      marginRight: 6,
                    }}
                  />
                  {d.name}
                </div>
              ))}
            </div>

            {/* Tasks (unassigned only) */}
            <div
              style={{
                position: 'absolute',
                top: 20,
                right: 20,
                zIndex: 2000,
                width: 300,
              }}
            >
              <div
                style={{
                  background: '#121826',
                  border: '1px solid #1e293b',
                  borderRadius: 8,
                  padding: 10,
                  maxHeight: '70vh',
                  overflowY: 'auto',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: '0 0 8px' }}>Tasks</h4>
                  <small style={{ opacity: 0.7 }}>{visibleUnassigned.length}</small>
                </div>

                <Droppable droppableId="tasks" type="TASK">
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} style={{ display: 'grid', gap: 6 }}>
                      {visibleUnassigned.map((t, i) => (
                        <Draggable key={String(t.id)} draggableId={String(t.id)} index={i}>
                          {(prov, snap) => (
                            <div
                              ref={prov.innerRef}
                              {...prov.draggableProps}
                              {...prov.dragHandleProps}
                              style={{
                                ...prov.draggableProps.style,
                                background: snap.isDragging ? '#243244' : '#1e293b',
                                borderRadius: 6,
                                padding: '8px 12px',
                                fontSize: 13,
                                cursor: 'grab',
                              }}
                              title={`${t.timeSlot || ''} ${t.type ? '• ' + t.type : ''}`}
                            >
                              {t.name}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {visibleUnassigned.length === 0 && (
                        <div style={{ fontSize: 12, color: '#9aa4b2' }}>No tasks for this filter</div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            </div>
          </div>
        </div>
      </DragDropContext>
    </div>
  )
}
