// src/pages/DriversPage.tsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";

import customMarker from "../assets/location.png";
import { ZONES, POINTS } from "../data/zones";

/** Google Sheets (Apps Script) endpoint that returns { rows: [...] } */
const SHEET_API_URL =
  "https://script.google.com/macros/s/AKfycbwatw81htOsjgcYrHGZxLPVw6wiWDkYFn509mlAEvG6ROnYqEpuKug0JSWO6NaRRfxsQw/exec";

// ---------------------- Types ----------------------

type Driver = {
  id: string;
  name: string;
  phone?: string;
  vehicle?: string;
  taskIds: string[]; // ordered task IDs assigned to this driver
};

type Task = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  timeSlot?: string;
  type?: string; // Pick / Drop
  assignedDriver?: string;
};

// ------------------ small array helpers ------------------
const insertAt = <T,>(arr: T[], index: number, item: T) => {
  const a = arr.slice();
  a.splice(index, 0, item);
  return a;
};
const removeAt = <T,>(arr: T[], index: number) => {
  const a = arr.slice();
  a.splice(index, 1);
  return a;
};
const reorder = <T,>(arr: T[], start: number, end: number) => {
  const a = arr.slice();
  const [m] = a.splice(start, 1);
  a.splice(end, 0, m);
  return a;
};

export default function DriversPage() {
  const navigate = useNavigate();

  // ---------------------- drivers ----------------------
  const [drivers, setDrivers] = useState<Driver[]>([
    { id: "d1", name: "Pradhan", phone: "9xxxxxxxxx", vehicle: "Bike", taskIds: [] },
    { id: "d2", name: "Rakesh", phone: "9xxxxxxxxx", vehicle: "Scooter", taskIds: [] },
  ]);

  // ----------------------- tasks -----------------------
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [unassigned, setUnassigned] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ------------------------ map ------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const taskLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Record<string, L.CircleMarker>>({});

  const facilityIcon = useRef(
    L.icon({
      iconUrl: customMarker,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -28],
    })
  );

  // -------------------- init map once --------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { center: [12.96, 77.62], zoom: 12 });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    const zoneLayer = L.geoJSON(ZONES as any, {
      style: (f: any) => ({
        color: f?.properties?.stroke ?? "#2e7d32",
        weight: f?.properties?.["stroke-width"] ?? 1.2,
        opacity: f?.properties?.["stroke-opacity"] ?? 1,
        fillColor: f?.properties?.fill ?? "#2e7d32",
        fillOpacity: f?.properties?.["fill-opacity"] ?? 0.3,
      }),
      onEachFeature: (f: any, layer) => layer.bindPopup(f?.properties?.name ?? "Zone"),
    }).addTo(map);

    const facilityLayer = L.geoJSON(POINTS as any, {
      pointToLayer: (_f, latlng) => L.marker(latlng, { icon: facilityIcon.current }),
      onEachFeature: (f: any, layer) => {
        const name = f?.properties?.name ?? "Point";
        layer.bindPopup(name);
      },
    }).addTo(map);

    taskLayerRef.current = L.layerGroup().addTo(map);

    const all = L.featureGroup([zoneLayer, facilityLayer]);
    map.fitBounds(all.getBounds(), { padding: [20, 20] });
  }, []);

  // --------------- fetch tasks from sheet ---------------
  useEffect(() => {
    let cancelled = false;
    const toNum = (v: any) => {
      const n = typeof v === "string" ? Number(v.trim()) : Number(v);
      return Number.isFinite(n) ? n : NaN;
    };
    const normalize = (raw: any): Task[] => {
      const rows = Array.isArray(raw?.rows) ? raw.rows : Array.isArray(raw) ? raw : [];
      return rows
        .map((r: any, i: number) => {
          const id = String(r.id ?? r.ID ?? `t${i + 1}`);
          const name = String(r.name ?? r.customer ?? r.title ?? `Task ${i + 1}`);
          const timeSlot = r.timeSlot ?? r.slot ?? r.timeslot ?? undefined;
          const type = r.type ?? r.service ?? r.jobType ?? undefined;
          let lat = r.lat ?? r.latitude ?? r.Lat ?? r.Latitude;
          let lng = r.lng ?? r.lon ?? r.longitude ?? r.Lng ?? r.Longitude;
          if ((lat == null || lng == null) && typeof r.latlng === "string") {
            const [a, b] = r.latlng.split(/[ ,]+/);
            lat = a;
            lng = b;
          }
          const latN = toNum(lat), lngN = toNum(lng);
          if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return null;
          return {
            id,
            name,
            lat: latN,
            lng: lngN,
            timeSlot: timeSlot ? String(timeSlot) : undefined,
            type: type ? String(type) : undefined,
            assignedDriver: r.assignedDriver ?? r.driver ?? undefined,
          } as Task;
        })
        .filter(Boolean) as Task[];
    };

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const res = await fetch(SHEET_API_URL, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        const tasks = normalize(data);
        setAllTasks(tasks);
        setUnassigned(tasks.filter((t) => !t.assignedDriver));
      } catch (e: any) {
        if (!cancelled) {
          setAllTasks([]);
          setUnassigned([]);
          setLoadError(String(e?.message || e));
        }
      } finally {
        !cancelled && setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // -------- render/refresh markers whenever allTasks changes --------
  useEffect(() => {
    const taskLayer = taskLayerRef.current;
    if (!taskLayer) return;
    taskLayer.clearLayers();
    markersRef.current = {};

    allTasks.forEach((t) => {
      const isPick = (t.type || "").toLowerCase().includes("pick");
      const baseColor = isPick ? "#22c55e" : "#ef4444";
      const assigned = Boolean(t.assignedDriver);
      const color = assigned ? "#6d28d9" : baseColor;

      const m = L.circleMarker([t.lat, t.lng], {
        radius: 8,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      }).addTo(taskLayer);

      const html = () => `
        <div style="min-width:200px">
          <strong>${t.name}</strong><br/>
          ${t.timeSlot ? `${t.timeSlot}<br/>` : ""}
          ${t.type ? `Type: <b>${t.type.toUpperCase()}</b><br/>` : ""}
          ${t.assignedDriver ? `Assigned: <b>${t.assignedDriver}</b><br/>` : ""}
          <small>${t.lat.toFixed(6)}, ${t.lng.toFixed(6)}</small>
        </div>`;
      m.bindPopup(html());
      markersRef.current[t.id] = m;
    });
  }, [allTasks]);

  // ------------------ DND: onDragEnd handler ------------------
  function onDragEnd(result: DropResult) {
    const { source, destination } = result;
    const draggableId = result.draggableId;
    if (!destination) return;
    const src = source.droppableId;
    const dst = destination.droppableId;
    const sIdx = source.index;
    const dIdx = destination.index;

    // 1) Reorder inside the SAME list
    if (src === dst) {
      if (src === "unassigned") {
        setUnassigned((prev) => reorder(prev, sIdx, dIdx));
      } else {
        setDrivers((prev) =>
          prev.map((d) =>
            d.id === src ? { ...d, taskIds: reorder(d.taskIds, sIdx, dIdx) } : d
          )
        );
      }
      return;
    }

    // 2) Move Unassigned -> Driver
    if (src === "unassigned" && dst !== "unassigned") {
      const task = unassigned[sIdx];
      if (!task) return;
      setUnassigned((prev) => removeAt(prev, sIdx));
      setDrivers((prev) =>
        prev.map((d) => (d.id === dst ? { ...d, taskIds: insertAt(d.taskIds, dIdx, task.id) } : d))
      );
      // reflect assignment in allTasks and marker
      const driverName = drivers.find((d) => d.id === dst)?.name;
      setAllTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, assignedDriver: driverName } : t)));
      const m = markersRef.current[task.id];
      if (m && driverName) {
        m.setStyle({ color: "#6d28d9", fillColor: "#6d28d9", fillOpacity: 1 });
        m.bindPopup(
          `<div style="min-width:200px">
             <strong>${task.name}</strong><br/>
             ${task.timeSlot ? `${task.timeSlot}<br/>` : ""}
             ${task.type ? `Type: <b>${(task.type || "").toUpperCase()}</b><br/>` : ""}
             Assigned: <b>${driverName}</b><br/>
             <small>${task.lat.toFixed(6)}, ${task.lng.toFixed(6)}</small>
           </div>`
        );
      }
      return;
    }

    // 3) Move Driver -> Unassigned (unassign)
    if (src !== "unassigned" && dst === "unassigned") {
      const taskId = drivers.find((d) => d.id === src)?.taskIds[sIdx];
      if (!taskId) return;
      setDrivers((prev) => prev.map((d) => (d.id === src ? { ...d, taskIds: removeAt(d.taskIds, sIdx) } : d)));
      const task = allTasks.find((t) => t.id === taskId);
      if (task) setUnassigned((prev) => insertAt(prev, dIdx, task));
      setAllTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, assignedDriver: undefined } : t)));

      const m = markersRef.current[taskId];
      if (m) {
        const isPick = (task?.type || "").toLowerCase().includes("pick");
        const base = isPick ? "#22c55e" : "#ef4444";
        m.setStyle({ color: base, fillColor: base, fillOpacity: 0.9 });
      }
      return;
    }

    // 4) Move Driver -> Driver
    if (src !== "unassigned" && dst !== "unassigned") {
      const taskId = drivers.find((d) => d.id === src)?.taskIds[sIdx];
      if (!taskId) return;
      setDrivers((prev) => {
        const next = prev.map((d) => {
          if (d.id === src) return { ...d, taskIds: removeAt(d.taskIds, sIdx) };
          if (d.id === dst) return { ...d, taskIds: insertAt(d.taskIds, dIdx, taskId) };
          return d;
        });
        return next;
      });
      const driverName = drivers.find((d) => d.id === dst)?.name;
      setAllTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, assignedDriver: driverName } : t)));
      const task = allTasks.find((t) => t.id === taskId);
      const m = markersRef.current[taskId];
      if (m && task && driverName) {
        m.setStyle({ color: "#6d28d9", fillColor: "#6d28d9", fillOpacity: 1 });
        m.bindPopup(
          `<div style="min-width:200px">
             <strong>${task.name}</strong><br/>
             ${task.timeSlot ? `${task.timeSlot}<br/>` : ""}
             ${task.type ? `Type: <b>${(task.type || "").toUpperCase()}</b><br/>` : ""}
             Assigned: <b>${driverName}</b><br/>
             <small>${task.lat.toFixed(6)}, ${task.lng.toFixed(6)}</small>
           </div>`
        );
      }
      return;
    }
  }

  const taskNameById = (id: string) => allTasks.find((t) => t.id === id)?.name || id;

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          background: "#0b0f16",
          color: "#e5e7eb",
        }}
      >
        {/* LEFT: Drivers */}
        <div style={{ padding: "16px", borderRight: "1px solid #1e293b" }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: "#2b2b2b",
              color: "#e5e7eb",
              border: "1px solid #404040",
              borderRadius: 8,
              padding: "8px 12px",
              cursor: "pointer",
              marginBottom: 16,
            }}
          >
            ← Back
          </button>

          <h2 style={{ marginBottom: 16 }}>Drivers</h2>

          {drivers.map((d) => (
            <Droppable key={d.id} droppableId={d.id} type="TASK">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{
                    background: "#121826",
                    border: "1px solid #1e293b",
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 16,
                  }}
                >
                  <strong>{d.name}</strong>
                  <div style={{ fontSize: 12, color: "#9aa4b2" }}>
                    {d.vehicle || "No vehicle"}
                  </div>

                  {/* Assigned tasks (draggable + ordered) */}
                  <div style={{ marginTop: 8 }}>
                    {d.taskIds.length === 0 ? (
                      <span style={{ fontSize: 12, color: "#666" }}>
                        No tasks assigned
                      </span>
                    ) : (
                      d.taskIds.map((tid, idx) => (
                        <Draggable key={tid} draggableId={tid} index={idx}>
                          {(prov, snapshot) => (
                            <div
                              ref={prov.innerRef}
                              {...prov.draggableProps}
                              {...prov.dragHandleProps}
                              style={{
                                ...prov.draggableProps.style,
                                background: snapshot.isDragging ? "#243244" : "#1e293b",
                                borderRadius: 6,
                                padding: "6px 10px",
                                marginTop: 6,
                                fontSize: 13,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                              title="Drag to reorder or move to another driver / Unassigned"
                            >
                              <span
                                style={{
                                  minWidth: 18,
                                  height: 18,
                                  borderRadius: 9,
                                  border: "1px solid #334155",
                                  textAlign: "center",
                                  lineHeight: "18px",
                                  fontSize: 12,
                                  opacity: 0.9,
                                }}
                              >
                                {idx + 1}
                              </span>
                              {taskNameById(tid)}
                            </div>
                          )}
                        </Draggable>
                      ))
                    )}
                  </div>

                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>

        {/* RIGHT: Map + Unassigned overlay */}
        <div style={{ position: "relative" }}>
          {/* Map at lower z-index */}
          <div ref={containerRef} style={{ width: "100%", height: "100vh", zIndex: 0 }} />

          {/* Unassigned box above Leaflet controls */}
          <div
            style={{
              position: "absolute",
              top: 20,
              right: 20,
              zIndex: 2000, // keep above Leaflet panes/controls
              background: "#121826",
              padding: 12,
              borderRadius: 8,
              maxHeight: "80vh",
              overflowY: "auto",
              width: 260,
              border: "1px solid #1e293b",
              pointerEvents: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h4 style={{ margin: "0 0 8px" }}>Unassigned Tasks</h4>
              {loading && <span style={{ fontSize: 12, opacity: 0.8 }}>loading…</span>}
            </div>
            {loadError && (
              <div style={{ color: "#ffbdbd", fontSize: 12, marginBottom: 6 }}>{loadError}</div>
            )}

            <Droppable droppableId="unassigned" type="TASK">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} style={{ display: "grid", gap: 6 }}>
                  {unassigned.map((t, i) => (
                    <Draggable key={t.id} draggableId={t.id} index={i}>
                      {(prov, snapshot) => (
                        <div
                          ref={prov.innerRef}
                          {...prov.draggableProps}
                          {...prov.dragHandleProps}
                          style={{
                            ...prov.draggableProps.style,
                            background: snapshot.isDragging ? "#243244" : "#1e293b",
                            borderRadius: 6,
                            padding: "8px 12px",
                            fontSize: 13,
                            cursor: "grab",
                          }}
                          title={t.timeSlot ? `${t.timeSlot} • ${t.type || ""}` : t.type || ""}
                        >
                          {t.name}
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {!loading && unassigned.length === 0 && (
                    <div style={{ fontSize: 12, color: "#9aa4b2", paddingTop: 4 }}>
                      No unassigned tasks
                    </div>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        </div>
      </div>
    </DragDropContext>
  );
}
