import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, CircleMarker, Circle, ZoomControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import * as turf from "@turf/turf";
import { loadRealRoadData } from "../data/realData";
import { useAdmin } from "../context/AdminContext";
import { 
  getRemovedPotholes, addRemovedPothole, 
  getAddedSpeedBumps, addSpeedBump, removeSpeedBump, 
  getAddedPotholes, addPothole, removeAddedPothole 
} from "../utils/adminStorage";
import ReportPanel from "./ReportPanel";

// ─── Leaflet Icon Fix ──────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── Constants ─────────────────────────────────────────────────────────────────
const KAHRAMANMARAS_CENTER = [37.588, 36.82];
const DEFAULT_ZOOM = 14;
const EDGE_TOLERANCE_METERS = 50; 

// Color helpers
const getScoreColor = (score) => {
  if (score <= 3) return "#22c55e"; // green
  if (score <= 7) return "#eab308"; // yellow
  return "#ef4444";                 // red
};

const getScoreLabel = (score) => {
  if (score <= 3) return "İyi";
  if (score <= 7) return "Orta";
  return "Kötü";
};

// Custom Icons for manual markers
const createCustomIcon = (emoji, color) => {
  return L.divIcon({
    html: `<div style="background-color: ${color}; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${emoji}</div>`,
    className: 'custom-leaflet-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
};

const BUMP_ICON = createCustomIcon("🔶", "#3b82f6");
const POTHOLE_ICON = createCustomIcon("🕳️", "#7c3aed");

// ─── Sub-components ────────────────────────────────────────────────────────────

// 1. DefectMarkers (Çukur ve sensör kasisleri)
function DefectMarkers({ roadData, isAdmin }) {
  if (!roadData || roadData.length === 0) return null;

  return (
    <>
      {roadData.map((point) => {
        const removeLabel = point.eventType === "kasis" ? "Kasisi Kaldır"
          : point.eventType === "çukur" ? "Çukuru Kaldır"
          : "Noktayı Kaldır";

        if (point.eventType === "kasis") {
          return (
            <Marker key={point.id} position={[point.lat, point.lng]} icon={BUMP_ICON} zIndexOffset={100}>
              <Popup>
                <div style={{ fontFamily: "Inter,sans-serif", lineHeight: 1.6 }}>
                  <strong style={{ color: "#3b82f6", fontSize: "14px" }}>🔶 Kasis (Sensör)</strong><br/>
                  <span style={{ color: "#666" }}>Skor: <b>{point.vibration_score}/10</b></span><br/>
                  <span style={{ color: "#666" }}>Şiddet: <b>{point.siddet || '-'}</b></span>
                  {isAdmin && (
                    <><br/><button onClick={() => window.dispatchEvent(new CustomEvent('rqm-remove-pothole', {detail: point.id}))} style={{ marginTop: "6px", padding: "4px 10px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "11px" }}>🗑️ {removeLabel}</button></>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        }

        return (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lng]}
            radius={point.vibration_score >= 8 ? 8 : 6}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              fillColor: getScoreColor(point.vibration_score),
              fillOpacity: 0.9
            }}
          >
            <Popup>
              <div style={{ fontFamily: "Inter,sans-serif", lineHeight: 1.6 }}>
                <strong style={{ color: getScoreColor(point.vibration_score), fontSize: "14px" }}>
                  🕳️ Çukur Kümeleri
                </strong><br/>
                <span>Titreşim Skoru: <b>{point.vibration_score}/10</b></span><br/>
                <span style={{ color: "#666" }}>Hız: <b>{point.speed} m/s</b></span><br/>
                <span style={{ color: "#666" }}>Nokta Sayısı: <b>{point.n_points || 1}</b></span><br/>
                <span style={{ color: "#666" }}>Şiddet: <b>{point.siddet || '-'} ({point.severity_score || '-'})</b></span>
                {isAdmin && (
                  <><br/><button onClick={() => window.dispatchEvent(new CustomEvent('rqm-remove-pothole', {detail: point.id}))} style={{ marginTop: "6px", padding: "4px 10px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "11px" }}>🗑️ {removeLabel}</button></>
                )}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

// 2. Nominatim Autocomplete Input
function AutocompleteInput({ label, placeholder, onPlaceSelect, showLocationBtn, onUseMyLocation, locationLoading, inputRef: externalRef, onMapSelect, selectingMapMode }) {
  const internalRef = useRef(null);
  const inputRef = externalRef || internalRef;
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef(null);

  const handleSearch = (e) => {
    const val = e.target.value;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    if (val.length < 3) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&countrycodes=tr&limit=5`);
        const data = await res.json();
        setResults(data);
        setIsOpen(true);
      } catch (err) {
        console.error("Arama hatası", err);
      }
    }, 500);
  };

  const selectPlace = (place) => {
    inputRef.current.value = place.display_name;
    setIsOpen(false);
    onPlaceSelect({
      lat: parseFloat(place.lat),
      lng: parseFloat(place.lon),
      name: place.display_name
    });
  };

  return (
    <div className="autocomplete-field" style={{ position: "relative" }}>
      <label>{label}</label>
      <div className="input-wrapper" style={{ display: "flex", gap: "6px" }}>
        <input 
          ref={inputRef} 
          type="text" 
          placeholder={placeholder} 
          onChange={handleSearch}
          onFocus={() => {if(results.length > 0) setIsOpen(true);}}
          style={{ flex: 1, minWidth: 0 }} 
        />
        {onMapSelect && (
          <button
            type="button"
            className="btn-map-select"
            onClick={onMapSelect}
            title="Haritadan Seç"
            style={{
              padding: "0 10px",
              background: selectingMapMode ? "var(--primary)" : "transparent",
              color: selectingMapMode ? "white" : "var(--text-secondary)",
              border: `1px solid ${selectingMapMode ? "var(--primary)" : "var(--border-color)"}`,
              borderRadius: "8px",
              cursor: "pointer",
              transition: "0.2s"
            }}
          >
            📍
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <ul style={{ position: "absolute", top: "100%", left: 0, right: "40px", background: "white", zIndex: 1000, listStyle: "none", padding: 0, margin: 0, border: "1px solid #ccc", borderRadius: "4px", maxHeight: "200px", overflowY: "auto", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
          {results.map((r, i) => (
            <li key={i} onClick={() => selectPlace(r)} style={{ padding: "8px", borderBottom: "1px solid #eee", cursor: "pointer", fontSize: "12px", color: "#333" }}>
              {r.display_name}
            </li>
          ))}
        </ul>
      )}

      {showLocationBtn && (
        <button
          className="btn-use-location"
          onClick={onUseMyLocation}
          disabled={locationLoading}
          type="button"
          style={{ marginTop: "6px" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          {locationLoading ? "Konum alınıyor..." : "Konumumu kullan"}
        </button>
      )}
    </div>
  );
}

// 3. User Location Marker
function UserLocationMarker({ position }) {
  if (!position) return null;
  return (
    <>
      <CircleMarker center={[position.lat, position.lng]} radius={8} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#4285F4", fillOpacity: 1 }} zIndexOffset={999}>
        <Popup>Konumunuz</Popup>
      </CircleMarker>
      <Circle center={[position.lat, position.lng]} radius={80} pathOptions={{ color: "#4285F4", fillColor: "#4285F4", fillOpacity: 0.12, weight: 1 }} />
    </>
  );
}

// 4. Map Event Handler (clicks and pans)
function MapEventHandler({ onMapClick, center }) {
  const map = useMap();
  
  useEffect(() => {
    if (center) {
      map.flyTo([center.lat, center.lng], 16);
    }
  }, [center, map]);

  useEffect(() => {
    const handleClick = (e) => onMapClick(e.latlng);
    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [map, onMapClick]);

  return null;
}

// 5. Data Loader Wrapper
function RoadDataLoaderWrapper({ onDataReady }) {
  useEffect(() => {
    const unsubscribe = loadRealRoadData(onDataReady);
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [onDataReady]);
  return null;
}

// ─── Main MapComponent ─────────────────────────────────────────────────────────
export default function LeafletMapComponent() {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [routeRequested, setRouteRequested] = useState(false);
  const [routePath, setRoutePath] = useState(null);
  const [routeStats, setRouteStats] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [locatingUser, setLocatingUser] = useState(false);
  const [roadData, setRoadData] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeFilter, setActiveFilter] = useState(null);

  // ── Route selection states ──
  const [selectingOriginMode, setSelectingOriginMode] = useState(false);
  const [selectingDestMode, setSelectingDestMode] = useState(false);
  const originInputRef = useRef(null);
  const destInputRef = useRef(null);

  // ── Admin state ──
  const { isAdmin, logout } = useAdmin();
  const [removedIds, setRemovedIds] = useState(() => getRemovedPotholes());
  const [speedBumps, setSpeedBumps] = useState(() => getAddedSpeedBumps());
  const [addedPotholes, setAddedPotholes] = useState(() => getAddedPotholes());
  const [addBumpMode, setAddBumpMode] = useState(false);
  const [addPotholeMode, setAddPotholeMode] = useState(false);
  const [reportPointMode, setReportPointMode] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(true);

  const handleDataReady = useCallback((data) => {
    setRoadData(data);
    setDataLoading(false);
  }, []);

  const filteredRoadData = useMemo(() => {
    return roadData.filter((d) => !removedIds.includes(d.id));
  }, [roadData, removedIds]);

  const displayData = useMemo(() => {
    if (!activeFilter) return filteredRoadData;
    if (activeFilter === "kasis") return filteredRoadData.filter(d => d.eventType === "kasis");
    if (activeFilter === "şiddetli") return filteredRoadData.filter(d => d.eventType !== "kasis" && d.vibration_score > 6);
    if (activeFilter === "orta") return filteredRoadData.filter(d => d.eventType !== "kasis" && d.vibration_score > 3 && d.vibration_score <= 6);
    if (activeFilter === "hafif") return filteredRoadData.filter(d => d.eventType !== "kasis" && d.vibration_score <= 3);
    return filteredRoadData;
  }, [filteredRoadData, activeFilter]);

  // Admin Events
  useEffect(() => {
    const handleRemovePothole = (e) => { if (e.detail) { addRemovedPothole(e.detail); setRemovedIds(getRemovedPotholes()); } };
    const handleRemoveBump = (e) => { if (e.detail) { removeSpeedBump(e.detail); setSpeedBumps(getAddedSpeedBumps()); } };
    const handleRemoveAddedPothole = (e) => { if (e.detail) { removeAddedPothole(e.detail); setAddedPotholes(getAddedPotholes()); } };
    
    window.addEventListener("rqm-remove-pothole", handleRemovePothole);
    window.addEventListener("rqm-remove-bump", handleRemoveBump);
    window.addEventListener("rqm-remove-added-pothole", handleRemoveAddedPothole);
    
    return () => {
      window.removeEventListener("rqm-remove-pothole", handleRemovePothole);
      window.removeEventListener("rqm-remove-bump", handleRemoveBump);
      window.removeEventListener("rqm-remove-added-pothole", handleRemoveAddedPothole);
    };
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.error("Konum hatası:", err),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }, []);

  // OSRM Routing
  useEffect(() => {
    if (!routeRequested || !origin || !destination) return;

    const fetchRoute = async () => {
      try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`);
        const data = await res.json();
        
        if (data.routes && data.routes.length > 0) {
          // GeoJSON returns [lng, lat], Leaflet polyline needs [lat, lng]
          const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
          setRoutePath(coordinates);
        } else {
          console.error("Rota bulunamadı");
          setRoutePath(null);
        }
      } catch (err) {
        console.error("OSRM Rota hatası", err);
        setRoutePath(null);
      }
    };
    
    fetchRoute();
  }, [routeRequested, origin, destination]);

  // Route statistics calculation using turf.js
  useEffect(() => {
    if (!routePath || filteredRoadData.length === 0) {
      setRouteStats(null);
      return;
    }

    // Convert route to GeoJSON LineString (GeoJSON uses [lng, lat])
    const lineCoords = routePath.map(c => [c[1], c[0]]);
    const routeLineString = turf.lineString(lineCoords);

    const onRoute = filteredRoadData.filter((p) => {
      const pt = turf.point([p.lng, p.lat]);
      const distance = turf.pointToLineDistance(pt, routeLineString, { units: 'meters' });
      return distance <= EDGE_TOLERANCE_METERS;
    });

    const hafifCount = onRoute.filter(p => p.vibration_score <= 3).length;
    const ortaCount = onRoute.filter(p => p.vibration_score > 3 && p.vibration_score <= 6).length;
    const siddetliCount = onRoute.filter(p => p.vibration_score > 6).length;
    const total = onRoute.length;

    let quality, qualityColor;
    if (total === 0) { quality = "İyi"; qualityColor = "#22c55e"; }
    else if (total <= 2) { quality = "Orta"; qualityColor = "#eab308"; }
    else if (total <= 5) { quality = "Kötü"; qualityColor = "#f97316"; }
    else { quality = "Kritik"; qualityColor = "#ef4444"; }

    setRouteStats({ hafifCount, ortaCount, siddetliCount, total, quality, qualityColor });
  }, [routePath, filteredRoadData]);

  const handleMapClick = useCallback((latlng) => {
    const { lat, lng } = latlng;

    if (selectingOriginMode) {
      setOrigin({ lat, lng, name: "Haritadan Seçildi" });
      if (originInputRef.current) originInputRef.current.value = "📍 Haritadan Seçildi";
      setSelectingOriginMode(false);
      return;
    }

    if (selectingDestMode) {
      setDestination({ lat, lng, name: "Haritadan Seçildi" });
      if (destInputRef.current) destInputRef.current.value = "📍 Haritadan Seçildi";
      setSelectingDestMode(false);
      return;
    }

    if (addBumpMode) {
      addSpeedBump({ lat, lng, note: "" }); setSpeedBumps(getAddedSpeedBumps()); setAddBumpMode(false);
    } else if (addPotholeMode) {
      addPothole({ lat, lng, note: "" }); setAddedPotholes(getAddedPotholes()); setAddPotholeMode(false);
    } else if (reportPointMode) {
      window.dispatchEvent(new CustomEvent("rqm-report-point-selected", { detail: { lat, lng } }));
      setReportPointMode(false);
    }
  }, [addBumpMode, addPotholeMode, reportPointMode, selectingOriginMode, selectingDestMode]);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) return alert("Tarayıcınız konum desteklemiyor.");
    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: "Konumum" };
        setUserLocation(loc);
        setOrigin(loc);
        if (originInputRef.current) originInputRef.current.value = "📍 Mevcut Konumum";
        setLocatingUser(false);
      },
      (err) => { alert("Konum alınamadı."); setLocatingUser(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleClearRoute = () => {
    setRouteRequested(false); setRoutePath(null); setRouteStats(null);
    setOrigin(null); setDestination(null);
    if (originInputRef.current) originInputRef.current.value = "";
    if (destInputRef.current) destInputRef.current.value = "";
  };

  return (
    <div className={`map-container ${sidebarOpen ? "sidebar-open" : ""}`}>
      {/* Sidebar Toggle & Overlay */}
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(true)} title="Menüyü Aç">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div className={`sidebar-overlay ${!sidebarOpen ? "hidden" : ""}`} onClick={() => setSidebarOpen(false)} />

      {/* Sidebar */}
      <aside className={`sidebar ${!sidebarOpen ? "collapsed" : ""}`}>
        <button className="sidebar-close" onClick={() => setSidebarOpen(false)} title="Menüyü Kapat">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div className="sidebar-scroll">
          <div className="sidebar-header">
            <div className="logo">
              <div className="logo-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h2M19 12h2M12 3v2M12 19v2"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>
              </div>
              <div><h1>Yol Kalitesi</h1><p className="subtitle">Jiroskop Tabanlı Haritalama (OSM)</p></div>
            </div>
          </div>

          <div className="sidebar-content">
            {/* Route Planning */}
            <div className="route-section">
              <div className="section-title">Rota Planla</div>
              <div className="route-inputs">
                <div className="route-dots">
                  <div className="dot dot-origin"></div><div className="dot-line"></div><div className="dot dot-dest"></div>
                </div>
                <div className="route-fields">
                  <AutocompleteInput label="Başlangıç" placeholder="Nereden..." onPlaceSelect={setOrigin} showLocationBtn={true} onUseMyLocation={handleUseMyLocation} locationLoading={locatingUser} inputRef={originInputRef} onMapSelect={() => {setSelectingOriginMode(true); setSelectingDestMode(false); setSidebarOpen(false);}} selectingMapMode={selectingOriginMode} />
                  <AutocompleteInput label="Varış" placeholder="Nereye..." onPlaceSelect={setDestination} inputRef={destInputRef} onMapSelect={() => {setSelectingDestMode(true); setSelectingOriginMode(false); setSidebarOpen(false);}} selectingMapMode={selectingDestMode} />
                </div>
              </div>
              <div className="route-buttons">
                <button className="btn-primary" onClick={() => setRouteRequested(true)} disabled={!origin || !destination}>Rota Getir</button>
                <button className="btn-secondary" onClick={handleClearRoute}>Temizle</button>
              </div>
            </div>

            {/* Route quality summary */}
            {routeRequested && routePath && routeStats && (
              <div className="warnings-section">
                {routeStats.total > 0 ? (
                  <div className="warning-card">
                    <span className="warning-card-icon">⚠️</span>
                    <div style={{ width: "100%" }}>
                      <strong>Rotada {routeStats.total} Sorun</strong>
                      <div style={{ marginTop: "6px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {routeStats.hafifCount > 0 && <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: "99px", fontSize: "12px", fontWeight: 600 }}>🟢 {routeStats.hafifCount} hafif</span>}
                        {routeStats.ortaCount > 0 && <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: "99px", fontSize: "12px", fontWeight: 600 }}>🟠 {routeStats.ortaCount} orta</span>}
                        {routeStats.siddetliCount > 0 && <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: "99px", fontSize: "12px", fontWeight: 600 }}>🔴 {routeStats.siddetliCount} şiddetli</span>}
                      </div>
                      <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Kalite:</span>
                        <span style={{ background: routeStats.qualityColor, color: "#fff", padding: "2px 10px", borderRadius: "99px", fontSize: "12px", fontWeight: 700 }}>{routeStats.quality}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="success-card"><span className="success-card-icon">✅</span><div><strong>Güvenli Rota</strong></div></div>
                )}
              </div>
            )}

            {/* Legend & Stats */}
            <div className="stats-section">
              <div className="section-title">Veri Özeti</div>
              <div className="stats-grid">
                <div className="stat-card"><span className="stat-value">{dataLoading ? '-' : displayData.length}</span><span className="stat-label">Toplam</span></div>
                <div className={`stat-card stat-card-clickable${activeFilter === "şiddetli" ? " stat-card-active" : ""}`} onClick={() => setActiveFilter(prev => prev === "şiddetli" ? null : "şiddetli")}><span className="stat-value">{dataLoading ? '-' : filteredRoadData.filter(d => d.vibration_score > 6).length}</span><span className="stat-label">🔴 Şiddetli</span></div>
                <div className={`stat-card stat-card-clickable${activeFilter === "orta" ? " stat-card-active" : ""}`} onClick={() => setActiveFilter(prev => prev === "orta" ? null : "orta")}><span className="stat-value">{dataLoading ? '-' : filteredRoadData.filter(d => d.vibration_score > 3 && d.vibration_score <= 6).length}</span><span className="stat-label">🟠 Orta</span></div>
                <div className={`stat-card stat-card-clickable${activeFilter === "hafif" ? " stat-card-active" : ""}`} onClick={() => setActiveFilter(prev => prev === "hafif" ? null : "hafif")}><span className="stat-value">{dataLoading ? '-' : filteredRoadData.filter(d => d.vibration_score <= 3).length}</span><span className="stat-label">🟢 Hafif</span></div>
                <div className={`stat-card stat-card-clickable${activeFilter === "kasis" ? " stat-card-active" : ""}`} onClick={() => setActiveFilter(prev => prev === "kasis" ? null : "kasis")}><span className="stat-value">{dataLoading ? '-' : filteredRoadData.filter(d => d.eventType === "kasis").length}</span><span className="stat-label">🔵 Kasis</span></div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Map Content */}
      <div className={`map-wrapper ${addBumpMode || addPotholeMode || reportPointMode || selectingOriginMode || selectingDestMode ? "cursor-crosshair" : ""}`}>
        <MapContainer 
          center={KAHRAMANMARAS_CENTER} 
          zoom={DEFAULT_ZOOM} 
          style={{ height: '100%', width: '100%', zIndex: 0 }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <ZoomControl position="bottomright" />
          
          <RoadDataLoaderWrapper onDataReady={handleDataReady} />
          <MapEventHandler onMapClick={handleMapClick} center={userLocation} />
          
          <DefectMarkers roadData={displayData} isAdmin={isAdmin} />

          {/* Route path */}
          {routePath && <Polyline positions={routePath} pathOptions={{ color: '#6366f1', weight: 5, opacity: 0.85 }} />}
          
          {/* Origin/Dest Markers */}
          {origin && <Marker position={[origin.lat, origin.lng]}><Popup>Başlangıç</Popup></Marker>}
          {destination && <Marker position={[destination.lat, destination.lng]}><Popup>Varış</Popup></Marker>}

          {/* User Location */}
          <UserLocationMarker position={userLocation} />

          {/* Admin Markers */}
          {speedBumps.map(b => (
            <Marker key={b.id} position={[b.lat, b.lng]} icon={BUMP_ICON}>
              <Popup>
                🔶 Kasis <br/> {isAdmin && <button onClick={() => removeSpeedBump(b.id) || setSpeedBumps(getAddedSpeedBumps())}>Kaldır</button>}
              </Popup>
            </Marker>
          ))}
          {addedPotholes.map(p => (
            <Marker key={p.id} position={[p.lat, p.lng]} icon={POTHOLE_ICON}>
              <Popup>
                🕳️ Çukur <br/> {isAdmin && <button onClick={() => removeAddedPothole(p.id) || setAddedPotholes(getAddedPotholes())}>Kaldır</button>}
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Admin Panel */}
        {isAdmin && !adminPanelOpen && (
          <button className="btn-admin-action" style={{ position: 'absolute', top: '20px', right: '65px', zIndex: 1000, background: 'var(--surface)', padding: '10px 15px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} onClick={() => setAdminPanelOpen(true)}>
            🔐 Admin Paneli
          </button>
        )}

        {isAdmin && adminPanelOpen && (
          <div className="floating-admin-panel" style={{ zIndex: 1001 }}>
            <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>🔐 Admin Paneli</div>
              <button onClick={() => setAdminPanelOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            </div>
            
            <button className={`btn-admin-action ${addBumpMode ? "active" : ""}`} onClick={() => { setAddBumpMode(b => !b); setAddPotholeMode(false); setReportPointMode(false); }}>
              <span>🔶</span> {addBumpMode ? "Kasis Ekleme — AKTİF" : "Kasis Ekle"}
            </button>
            
            <button className={`btn-admin-action ${addPotholeMode ? "active" : ""}`} onClick={() => { setAddPotholeMode(b => !b); setAddBumpMode(false); setReportPointMode(false); }} style={{ borderColor: "#7c3aed", color: addPotholeMode ? "#fff" : "#7c3aed", background: addPotholeMode ? "#7c3aed" : "transparent" }}>
              <span>🕳️</span> {addPotholeMode ? "Çukur Ekleme — AKTİF" : "Çukur Ekle"}
            </button>

            {removedIds.length > 0 && <div className="admin-info-badge">🗑️ {removedIds.length} sensör çukuru gizlendi</div>}

            <ReportPanel roadData={filteredRoadData} routePath={routePath} onSelectPointMode={() => { setReportPointMode(true); setAddBumpMode(false); }} />
            
            <button className="btn-admin-logout" onClick={logout}>Çıkış Yap</button>
          </div>
        )}

        {(addBumpMode || addPotholeMode || reportPointMode || selectingOriginMode || selectingDestMode) && (
          <div className="map-mode-overlay" style={{ zIndex: 1000 }}>
            <span>Haritaya tıklayın</span>
            <button onClick={() => { setAddBumpMode(false); setAddPotholeMode(false); setReportPointMode(false); setSelectingOriginMode(false); setSelectingDestMode(false); }}>İptal</button>
          </div>
        )}
      </div>
    </div>
  );
}
