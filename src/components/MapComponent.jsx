import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Map, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { loadRealRoadData } from "../data/realData";
import { useAdmin } from "../context/AdminContext";
import { getRemovedPotholes, addRemovedPothole, getAddedSpeedBumps, addSpeedBump, removeSpeedBump, getAddedPotholes, addPothole, removeAddedPothole } from "../utils/adminStorage";
import ReportPanel from "./ReportPanel";

// ─── Constants ─────────────────────────────────────────────────────────────────
const KAHRAMANMARAS_CENTER = { lat: 37.588, lng: 36.82 };
const DEFAULT_ZOOM = 14;

/**
 * Tolerance for isLocationOnEdge (in degrees).
 * ~0.0005 ≈ ~55 meters at this latitude.
 * Points within this distance of the route polyline are considered "on route".
 */
const EDGE_TOLERANCE = 0.0005;

// Color helper: returns hex color based on vibration score
const getScoreColor = (score) => {
  if (score <= 3) return "#22c55e"; // green  – good
  if (score <= 7) return "#eab308"; // yellow – moderate
  return "#ef4444";                 // red    – bad
};

const getScoreLabel = (score) => {
  if (score <= 3) return "İyi";
  if (score <= 7) return "Orta";
  return "Kötü";
};

const getEventIcon = (eventType) => {
  return "🕳️";
};

const getEventLabel = (eventType) => {
  return "Çukur";
};

const BUMP_ICON = {
  path: "M -12,0 C -12,-12 12,-12 12,0 Z",
  scale: 1.2,
  fillColor: "#3b82f6",
  fillOpacity: 1,
  strokeColor: "#1e3a5f",
  strokeWeight: 2,
};

const POTHOLE_ICON = {
  path: "M -11,-9 L 11,-9 L 0,10 Z",
  scale: 1.2,
  fillColor: "#7c3aed",
  fillOpacity: 1,
  strokeColor: "#000000",
  strokeWeight: 2,
};

// ─── Defect Markers Sub-component ──────────────────────────────────────────────
function DefectMarkers({ roadData, isAdmin }) {
  const map = useMap();
  const markersRef = useRef([]);

  useEffect(() => {
    // Önceki marker'ları temizle
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (!map || !roadData || roadData.length === 0) return;

    // Tüm tespit edilen olayları göster (yeni algoritma sadece anomalileri döndürüyor)
    const badPoints = roadData;

    badPoints.forEach((point) => {
      const position = new google.maps.LatLng(point.lat, point.lng);
      const title = `${getScoreLabel(point.vibration_score)} Yol — Skor: ${point.vibration_score}/10`;

      let iconConfig;
      let labelConfig = null;

      if (point.eventType === "kasis") {
        iconConfig = BUMP_ICON;
      } else {
        iconConfig = {
          path: google.maps.SymbolPath.CIRCLE,
          scale: point.vibration_score >= 8 ? 16 : 12,
          fillColor: getScoreColor(point.vibration_score),
          fillOpacity: 0.9,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        };
      }

      const marker = new google.maps.Marker({
        map,
        position,
        title,
        icon: iconConfig,
        label: labelConfig,
        zIndex: point.eventType === "kasis" || point.eventType === "çukur" ? 100 : 10,
      });

      const removeLabel = point.eventType === "kasis" ? "Kasisi Kaldır"
        : point.eventType === "çukur" ? "Çukuru Kaldır"
          : "Noktayı Kaldır";
      const removeBtn = isAdmin
        ? `<br/><button onclick="window.dispatchEvent(new CustomEvent('rqm-remove-pothole',{detail:${point.id}}))" style="margin-top:6px;padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;">🗑️ ${removeLabel}</button>`
        : "";

      const infoWindow = new google.maps.InfoWindow({
        content: `<div style="font-family:Inter,sans-serif;padding:8px 12px;line-height:1.6;">
               <strong style="color:${getScoreColor(point.vibration_score)};font-size:14px;">
                 🕳️ Çukur Kümeleri
               </strong><br/>
               <span>Titreşim Skoru: <b>${point.vibration_score}/10</b></span><br/>
               <span style="color:#666;">Hız: <b>${point.speed} m/s</b></span><br/>
               <span style="color:#666;">Nokta Sayısı: <b>${point.n_points || 1}</b></span><br/>
               <span style="color:#666;">Şiddet: <b>${point.siddet || '-'} (${point.severity_score || '-'})</b></span>
               ${removeBtn}
             </div>`,
      });

      marker.addListener("click", () => infoWindow.open(map, marker));
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [map, roadData, isAdmin]);

  return null;
}


// ─── Autocomplete Input Sub-component ──────────────────────────────────────────
function AutocompleteInput({ label, placeholder, onPlaceSelect, showLocationBtn, onUseMyLocation, locationLoading, inputRef: externalRef, onMapSelect, selectingMapMode }) {
  const internalRef = useRef(null);
  const inputRef = externalRef || internalRef;
  const autocompleteRef = useRef(null);
  const places = useMapsLibrary("places");

  useEffect(() => {
    if (!places || !inputRef.current) return;

    autocompleteRef.current = new google.maps.places.Autocomplete(
      inputRef.current,
      {
        fields: ["geometry", "name", "formatted_address"],
        componentRestrictions: { country: "tr" },
      }
    );

    autocompleteRef.current.addListener("place_changed", () => {
      const place = autocompleteRef.current.getPlace();
      if (place?.geometry?.location) {
        onPlaceSelect(place);
      }
    });

    return () => {
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [places, onPlaceSelect]);

  return (
    <div className="autocomplete-field">
      <label>{label}</label>
      <div className="input-wrapper" style={{ display: "flex", gap: "6px" }}>
        <input ref={inputRef} type="text" placeholder={placeholder} style={{ flex: 1, minWidth: 0 }} />
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

// ─── Route Selection Markers Sub-component ────────────────────────────────────
function RouteSelectionMarkers({ origin, destination }) {
  const map = useMap();
  const originMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    if (origin?.geometry?.location) {
      if (!originMarkerRef.current) {
        originMarkerRef.current = new google.maps.Marker({
          map,
          title: "Başlangıç",
          label: { text: "A", color: "#ffffff", fontSize: "14px", fontWeight: "bold" }
        });
      }
      originMarkerRef.current.setPosition(origin.geometry.location);
    } else if (originMarkerRef.current) {
      originMarkerRef.current.setMap(null);
      originMarkerRef.current = null;
    }

    if (destination?.geometry?.location) {
      if (!destMarkerRef.current) {
        destMarkerRef.current = new google.maps.Marker({
          map,
          title: "Varış",
          label: { text: "B", color: "#ffffff", fontSize: "14px", fontWeight: "bold" }
        });
      }
      destMarkerRef.current.setPosition(destination.geometry.location);
    } else if (destMarkerRef.current) {
      destMarkerRef.current.setMap(null);
      destMarkerRef.current = null;
    }

    return () => {
      // Don't clean up on every render, only when unmounting or if map changes
    };
  }, [map, origin, destination]);

  useEffect(() => {
    return () => {
      if (originMarkerRef.current) originMarkerRef.current.setMap(null);
      if (destMarkerRef.current) destMarkerRef.current.setMap(null);
    };
  }, []);

  return null;
}

// ─── Directions Sub-component ──────────────────────────────────────────────────
function DirectionsHandler({ origin, destination, onRouteReady }) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const rendererRef = useRef(null);

  useEffect(() => {
    if (!map || !routesLib || !origin || !destination) return;

    const directionsService = new google.maps.DirectionsService();

    if (!rendererRef.current) {
      rendererRef.current = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: "#6366f1",
          strokeWeight: 5,
          strokeOpacity: 0.85,
        },
      });
    }

    directionsService.route(
      {
        origin: origin.geometry.location,
        destination: destination.geometry.location,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
          rendererRef.current.setDirections(result);

          // Extract the polyline path from the route for filtering
          const path = result.routes[0].overview_path;
          onRouteReady(path);
        } else {
          console.error("Yön bulunamadı:", status);
          onRouteReady(null);
        }
      }
    );

    return () => {
      if (rendererRef.current) {
        rendererRef.current.setMap(null);
        rendererRef.current = null;
      }
    };
  }, [map, routesLib, origin, destination, onRouteReady]);

  return null;
}

// ─── Route Warning Markers Sub-component ───────────────────────────────────────
function RouteWarningMarkers({ routePath, roadData, isAdmin }) {
  const map = useMap();
  const geometry = useMapsLibrary("geometry");
  const markersRef = useRef([]);

  useEffect(() => {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (!map || !geometry || !routePath || routePath.length === 0 || !roadData) return;

    const routePoly = new google.maps.Polyline({ path: routePath });

    roadData.forEach((point) => {

      const latLng = new google.maps.LatLng(point.lat, point.lng);
      const isOnRoute = google.maps.geometry.poly.isLocationOnEdge(
        latLng,
        routePoly,
        EDGE_TOLERANCE
      );

      if (isOnRoute) {
        let iconConfig;
        let labelConfig = null;

        if (point.eventType === "kasis") {
          iconConfig = BUMP_ICON;
        } else {
          iconConfig = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: getScoreColor(point.vibration_score),
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          };
        }

        const marker = new google.maps.Marker({
          map,
          position: latLng,
          title: `${getScoreLabel(point.vibration_score)} Yol — Skor: ${point.vibration_score}/10`,
          icon: iconConfig,
          label: labelConfig,
          zIndex: point.eventType === "kasis" || point.eventType === "çukur" ? 100 : 10,
        });

        const removeLabel2 = point.eventType === "kasis" ? "Kasisi Kaldır"
          : point.eventType === "çukur" ? "Çukuru Kaldır"
            : "Noktayı Kaldır";
        const removeBtn = isAdmin
          ? `<br/><button onclick="window.dispatchEvent(new CustomEvent('rqm-remove-pothole',{detail:${point.id}}))" style="margin-top:6px;padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;">🗑️ ${removeLabel2}</button>`
          : "";

        const infoWindow = new google.maps.InfoWindow({
          content: `<div style="font-family:Inter,sans-serif;padding:8px 12px;line-height:1.6;">
                 <strong style="color:${getScoreColor(point.vibration_score)};font-size:14px;">
                   🕳️ Çukur Kümeleri
                 </strong><br/>
                 <span>Titreşim Skoru: <b>${point.vibration_score}/10</b></span><br/>
                 <span style="color:#666;">Hız: <b>${point.speed} m/s</b></span><br/>
                 <span style="color:#666;">Nokta Sayısı: <b>${point.n_points || 1}</b></span><br/>
                 <span style="color:#666;">Şiddet: <b>${point.siddet || '-'} (${point.severity_score || '-'})</b></span>
                 ${removeBtn}
               </div>`,
        });
        marker.addListener("click", () => infoWindow.open(map, marker));

        markersRef.current.push(marker);
      }
    });

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [map, geometry, routePath, roadData, isAdmin]);

  return null;
}

// ─── Speed Bump Markers Sub-component ───────────────────────────────────────────
function SpeedBumpMarkers({ speedBumps, isAdmin, onRemoveBump }) {
  const map = useMap();
  const markersRef = useRef([]);

  useEffect(() => {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (!map || !speedBumps || speedBumps.length === 0) return;

    speedBumps.forEach((bump) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: bump.lat, lng: bump.lng },
        title: `Kasis${bump.note ? " — " + bump.note : ""}`,
        icon: BUMP_ICON,
        zIndex: 900,
      });

      const content = `<div style="font-family:Inter,sans-serif;padding:8px 12px;line-height:1.6;">
        <strong style="color:#f59e0b;font-size:14px;">🔶 Kasis (Manuel)</strong><br/>
        <span style="color:#666;">Koordinat: ${bump.lat.toFixed(5)}, ${bump.lng.toFixed(5)}</span><br/>
        ${bump.note ? `<span>Not: ${bump.note}</span><br/>` : ""}
        <span style="color:#999;font-size:11px;">Eklenme: ${new Date(bump.addedAt).toLocaleDateString("tr-TR")}</span>
        ${isAdmin ? `<br/><button onclick="window.dispatchEvent(new CustomEvent('rqm-remove-bump',{detail:'${bump.id}'}))" style="margin-top:6px;padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;">🗑️ Kasisi Kaldır</button>` : ""}
      </div>`;

      const infoWindow = new google.maps.InfoWindow({ content });
      marker.addListener("click", () => infoWindow.open(map, marker));
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [map, speedBumps, isAdmin]);

  return null;
}

// ─── Added Pothole Markers Sub-component ───────────────────────────────────────
function AddedPotholeMarkers({ potholes, isAdmin }) {
  const map = useMap();
  const markersRef = useRef([]);

  useEffect(() => {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (!map || !potholes || potholes.length === 0) return;

    potholes.forEach((ph) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: ph.lat, lng: ph.lng },
        title: `Çukur (Manuel)${ph.note ? " — " + ph.note : ""}`,
        icon: POTHOLE_ICON,
        zIndex: 900,
      });

      const content = `<div style="font-family:Inter,sans-serif;padding:8px 12px;line-height:1.6;">
        <strong style="color:#7c3aed;font-size:14px;">🕳️ Çukur (Manuel)</strong><br/>
        <span style="color:#666;">Koordinat: ${ph.lat.toFixed(5)}, ${ph.lng.toFixed(5)}</span><br/>
        ${ph.note ? `<span>Not: ${ph.note}</span><br/>` : ""}
        <span style="color:#999;font-size:11px;">Eklenme: ${new Date(ph.addedAt).toLocaleDateString("tr-TR")}</span>
        ${isAdmin ? `<br/><button onclick="window.dispatchEvent(new CustomEvent('rqm-remove-added-pothole',{detail:'${ph.id}'}))" style="margin-top:6px;padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;">🗑️ Çukuru Kaldır</button>` : ""}
      </div>`;

      const infoWindow = new google.maps.InfoWindow({ content });
      marker.addListener("click", () => infoWindow.open(map, marker));
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [map, potholes, isAdmin]);

  return null;
}

// ─── User Location Marker Sub-component ────────────────────────────────────────
function UserLocationMarker({ position }) {
  const map = useMap();
  const markerRef = useRef(null);
  const circleRef = useRef(null);

  useEffect(() => {
    if (!map || !position) return;

    // Blue pulsing dot for user location
    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({
        map,
        position,
        title: "Konumunuz",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#4285F4",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
        zIndex: 999,
      });

      // Accuracy circle around the dot
      circleRef.current = new google.maps.Circle({
        map,
        center: position,
        radius: 80,
        fillColor: "#4285F4",
        fillOpacity: 0.12,
        strokeColor: "#4285F4",
        strokeOpacity: 0.3,
        strokeWeight: 1,
      });
    } else {
      markerRef.current.setPosition(position);
      circleRef.current.setCenter(position);
    }

    return () => {
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
    };
  }, [map, position]);

  return null;
}

// ─── Map View Controller (pans map to target) ──────────────────────────────────
function MapViewController({ center }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !center) return;
    map.panTo(center);
    map.setZoom(16);
  }, [map, center]);

  return null;
}

// ─── Road Data Loader (parses real CSV sensor data) ───────────────────────────
function RoadDataLoader({ onDataReady }) {
  const map = useMap();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!map || loadedRef.current) return;
    loadedRef.current = true;

    console.log("🛣️ Gerçek sensör verileri yükleniyor...");
    const unsubscribe = loadRealRoadData((data) => {
      onDataReady(data);
    });

    return () => {
      if (unsubscribe) unsubscribe();
      loadedRef.current = false;
    };
  }, [map, onDataReady]);

  return null;
}

// ─── Main MapComponent ─────────────────────────────────────────────────────────
export default function MapComponent() {
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
  const [activeFilter, setActiveFilter] = useState(null); // null | "kasis" | "çukur"

  // ── Route selection states ──
  const [selectingOriginMode, setSelectingOriginMode] = useState(false);
  const [selectingDestMode, setSelectingDestMode] = useState(false);
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

  // Filtrelenmiş veri: silinen çukurlar çıkarılmış
  const filteredRoadData = useMemo(() => {
    return roadData.filter((d) => !removedIds.includes(d.id));
  }, [roadData, removedIds]);

  // Haritada gösterilecek veri: aktif kategori filtresi uygulanmış
  const displayData = useMemo(() => {
    if (!activeFilter) return filteredRoadData;
    if (activeFilter === "kasis") return filteredRoadData.filter(d => d.eventType === "kasis");
    if (activeFilter === "şiddetli") return filteredRoadData.filter(d => d.eventType !== "kasis" && d.vibration_score > 6);
    if (activeFilter === "orta") return filteredRoadData.filter(d => d.eventType !== "kasis" && d.vibration_score > 3 && d.vibration_score <= 6);
    if (activeFilter === "hafif") return filteredRoadData.filter(d => d.eventType !== "kasis" && d.vibration_score <= 3);
    return filteredRoadData;
  }, [filteredRoadData, activeFilter]);

  // Admin: Çukur silme
  const handleRemovePothole = useCallback((id) => {
    addRemovedPothole(id);
    setRemovedIds((prev) => prev.includes(id) ? prev : [...prev, id]);
  }, []);

  // Admin: Kasis ekleme
  const handleAddBump = useCallback((lat, lng) => {
    addSpeedBump({ lat, lng, note: "" });
    setSpeedBumps(getAddedSpeedBumps());
    setAddBumpMode(false);
  }, []);

  // Admin: Çukur ekleme
  const handleAddPothole = useCallback((lat, lng) => {
    addPothole({ lat, lng, note: "" });
    setAddedPotholes(getAddedPotholes());
    setAddPotholeMode(false);
  }, []);

  // Admin: Kasis kaldırma (event listener)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail) { removeSpeedBump(e.detail); setSpeedBumps(getAddedSpeedBumps()); }
    };
    window.addEventListener("rqm-remove-bump", handler);
    return () => window.removeEventListener("rqm-remove-bump", handler);
  }, []);

  // Admin: Manuel eklenen çukur kaldırma (event listener)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail) { removeAddedPothole(e.detail); setAddedPotholes(getAddedPotholes()); }
    };
    window.addEventListener("rqm-remove-added-pothole", handler);
    return () => window.removeEventListener("rqm-remove-added-pothole", handler);
  }, []);

  // Otomatik olarak kullanıcının konumunu al
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(loc);
        },
        (err) => {
          console.error("Otomatik konum alınamadı:", err);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }, []);

  // Admin: Çukur silme (event listener)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail) handleRemovePothole(e.detail);
    };
    window.addEventListener("rqm-remove-pothole", handler);
    return () => window.removeEventListener("rqm-remove-pothole", handler);
  }, [handleRemovePothole]);

  const handleRouteReady = useCallback(
    (path) => {
      setRoutePath(path);
    },
    []
  );

  // Rota veya veriler değiştiğinde rotadaki istatistikleri hesapla
  useEffect(() => {
    if (!routePath || !window.google || filteredRoadData.length === 0) {
      setRouteStats(null);
      return;
    }
    const routePoly = new google.maps.Polyline({ path: routePath });
    const onRoute = filteredRoadData.filter((p) => {
      const latLng = new google.maps.LatLng(p.lat, p.lng);
      return google.maps.geometry.poly.isLocationOnEdge(latLng, routePoly, EDGE_TOLERANCE);
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

  // Harita tıklama: kasis ekleme veya rapor nokta seçimi
  const handleMapClick = useCallback(
    (e) => {
      // Çeşitli kütüphane versiyonlarına karşı hem e.detail.latLng hem de e.latLng kontrolü
      const latLng = e.detail?.latLng || e.latLng;

      if (!latLng) {
        console.warn("Haritaya tıklandı ama koordinat bulunamadı!", e);
        return;
      }

      const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat;
      const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng;

      if (selectingOriginMode) {
        console.log("📍 Başlangıç noktası seçildi:", lat, lng);
        const fakePlace = {
          geometry: { location: new google.maps.LatLng(lat, lng) },
          name: "Haritadan Seçilen Nokta",
          formatted_address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        };
        setOrigin(fakePlace);
        if (originInputRef.current) originInputRef.current.value = "📍 Haritadan Seçildi";
        setSelectingOriginMode(false);
        return;
      }

      if (selectingDestMode) {
        console.log("📍 Varış noktası seçildi:", lat, lng);
        const fakePlace = {
          geometry: { location: new google.maps.LatLng(lat, lng) },
          name: "Haritadan Seçilen Nokta",
          formatted_address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        };
        setDestination(fakePlace);
        if (destInputRef.current) destInputRef.current.value = "📍 Haritadan Seçildi";
        setSelectingDestMode(false);
        return;
      }

      if (addBumpMode) {
        handleAddBump(lat, lng);
      } else if (addPotholeMode) {
        handleAddPothole(lat, lng);
      } else if (reportPointMode) {
        console.log("📍 Haritaya tıklandı (Rapor Modu AKTİF)");
        window.dispatchEvent(
          new CustomEvent("rqm-report-point-selected", { detail: { lat, lng } })
        );
        setReportPointMode(false);
      }
    },
    [addBumpMode, addPotholeMode, reportPointMode, handleAddBump, handleAddPothole, selectingOriginMode, selectingDestMode]
  );

  const handleStartSelectOrigin = () => {
    setSelectingOriginMode(true);
    setSelectingDestMode(false);
    setAddBumpMode(false);
    setReportPointMode(false);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const handleStartSelectDest = () => {
    setSelectingDestMode(true);
    setSelectingOriginMode(false);
    setAddBumpMode(false);
    setReportPointMode(false);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const handleGetRoute = () => {
    if (origin && destination) {
      setRouteRequested(false); // reset to trigger re-render
      setTimeout(() => setRouteRequested(true), 0);
    }
  };

  const handleClearRoute = () => {
    setRouteRequested(false);
    setRoutePath(null);
    setRouteStats(null);
    setOrigin(null);
    setDestination(null);
    if (originInputRef.current) originInputRef.current.value = "";
    if (destInputRef.current) destInputRef.current.value = "";
  };

  // Handle using current location as origin
  const originInputRef = useRef(null);
  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      alert("Tarayıcınız konum özelliğini desteklemiyor.");
      return;
    }
    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        // Create a fake Place object for the Directions API
        const fakePlace = {
          geometry: {
            location: new google.maps.LatLng(loc.lat, loc.lng),
          },
          name: "Konumum",
          formatted_address: `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`,
        };
        setOrigin(fakePlace);
        // Update the input field text
        if (originInputRef.current) {
          originInputRef.current.value = "📍 Mevcut Konumum";
        }
        setLocatingUser(false);
      },
      (err) => {
        console.error("Konum alınamadı:", err);
        alert("Konum alınamadı. Lütfen konum izni verdiğinizden emin olun.");
        setLocatingUser(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className={`map-container ${sidebarOpen ? "sidebar-open" : ""}`}>
      {/* ── Sidebar Toggle Button (visible when sidebar is closed) ── */}
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(true)}
        title="Menüyü Aç"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* ── Mobile Overlay ── */}
      <div
        className={`sidebar-overlay ${!sidebarOpen ? "hidden" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ── Sidebar ── */}
      <aside className={`sidebar ${!sidebarOpen ? "collapsed" : ""}`}>
        {/* Close button inside sidebar */}
        <button
          className="sidebar-close"
          onClick={() => setSidebarOpen(false)}
          title="Menüyü Kapat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="sidebar-scroll">
          <div className="sidebar-header">
            <div className="logo">
              <div className="logo-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12h2M19 12h2M12 3v2M12 19v2" />
                  <circle cx="12" cy="12" r="7" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
              <div>
                <h1>Yol Kalitesi</h1>
                <p className="subtitle">Jiroskop Tabanlı Haritalama</p>
              </div>
            </div>
          </div>

          <div className="sidebar-content">
            {/* Route inputs */}
            <div className="route-section">
              <div className="section-title">
                <span className="section-icon section-icon-route">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </span>
                Rota Planla
              </div>

              <div className="route-inputs">
                <div className="route-dots">
                  <div className="dot dot-origin"></div>
                  <div className="dot-line"></div>
                  <div className="dot dot-dest"></div>
                </div>
                <div className="route-fields">
                  <AutocompleteInput
                    label="Başlangıç"
                    placeholder="Nereden..."
                    onPlaceSelect={setOrigin}
                    showLocationBtn={true}
                    onUseMyLocation={handleUseMyLocation}
                    locationLoading={locatingUser}
                    inputRef={originInputRef}
                    onMapSelect={handleStartSelectOrigin}
                    selectingMapMode={selectingOriginMode}
                  />
                  <AutocompleteInput
                    label="Varış"
                    placeholder="Nereye..."
                    onPlaceSelect={setDestination}
                    inputRef={destInputRef}
                    onMapSelect={handleStartSelectDest}
                    selectingMapMode={selectingDestMode}
                  />
                </div>
              </div>

              <div className="route-buttons">
                <button
                  className="btn-primary"
                  onClick={handleGetRoute}
                  disabled={!origin || !destination}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="3 11 22 2 13 21 11 13 3 11" />
                  </svg>
                  Rota Getir
                </button>
                <button className="btn-secondary" onClick={handleClearRoute}>
                  Rotayı Temizle
                </button>
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
                        {routeStats.hafifCount > 0 && (
                          <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 }}>
                            🟢 {routeStats.hafifCount} hafif
                          </span>
                        )}
                        {routeStats.ortaCount > 0 && (
                          <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 }}>
                            🟠 {routeStats.ortaCount} orta
                          </span>
                        )}
                        {routeStats.siddetliCount > 0 && (
                          <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 }}>
                            🔴 {routeStats.siddetliCount} şiddetli
                          </span>
                        )}
                      </div>
                      <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Yol Kalitesi:</span>
                        <span style={{ background: routeStats.qualityColor, color: "#fff", padding: "2px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 700 }}>
                          {routeStats.quality}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="success-card">
                    <span className="success-card-icon">✅</span>
                    <div>
                      <strong>Güvenli Rota</strong>
                      <p>Bu rotada sorun bulunamadı.</p>
                      <span style={{ background: "#22c55e", color: "#fff", padding: "2px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 700 }}>İyi</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Legend */}
            <div className="legend-section">
              <div className="section-title">
                <span className="section-icon section-icon-legend">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </span>
                Gösterge
              </div>
              <div className="legend-items">
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "#22c55e" }}></span>
                  Hafif Çukur
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "#eab308" }}></span>
                  Orta Çukur
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "#ef4444" }}></span>
                  Şiddetli Çukur
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="stats-section">
              <div className="section-title">
                <span className="section-icon section-icon-stats">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                </span>
                Veri Özeti
              </div>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-value">{dataLoading ? <span className="skeleton" /> : displayData.length}</span>
                  <span className="stat-label">Toplam Olay</span>
                </div>
                <div
                  className={`stat-card stat-card-clickable${activeFilter === "şiddetli" ? " stat-card-active" : ""}`}
                  onClick={() => setActiveFilter(prev => prev === "şiddetli" ? null : "şiddetli")}
                  title="Sadece şiddetli çukurları göster"
                >
                  <span className="stat-value">{dataLoading ? <span className="skeleton" /> : filteredRoadData.filter((d) => d.vibration_score > 6).length}</span>
                  <span className="stat-label">🔴 Şiddetli</span>
                  {activeFilter === "şiddetli" && <span className="stat-filter-badge">filtre aktif</span>}
                </div>
                <div
                  className={`stat-card stat-card-clickable${activeFilter === "orta" ? " stat-card-active" : ""}`}
                  onClick={() => setActiveFilter(prev => prev === "orta" ? null : "orta")}
                  title="Sadece orta çukurları göster"
                >
                  <span className="stat-value">{dataLoading ? <span className="skeleton" /> : filteredRoadData.filter((d) => d.vibration_score > 3 && d.vibration_score <= 6).length}</span>
                  <span className="stat-label">🟠 Orta</span>
                  {activeFilter === "orta" && <span className="stat-filter-badge">filtre aktif</span>}
                </div>
                <div
                  className={`stat-card stat-card-clickable${activeFilter === "hafif" ? " stat-card-active" : ""}`}
                  onClick={() => setActiveFilter(prev => prev === "hafif" ? null : "hafif")}
                  title="Sadece hafif çukurları göster"
                >
                  <span className="stat-value">{dataLoading ? <span className="skeleton" /> : filteredRoadData.filter((d) => d.vibration_score <= 3).length}</span>
                  <span className="stat-label">🟢 Hafif</span>
                  {activeFilter === "hafif" && <span className="stat-filter-badge">filtre aktif</span>}
                </div>
                <div
                  className={`stat-card stat-card-clickable${activeFilter === "kasis" ? " stat-card-active" : ""}`}
                  onClick={() => setActiveFilter(prev => prev === "kasis" ? null : "kasis")}
                  title="Sadece kasisleri göster"
                >
                  <span className="stat-value">{dataLoading ? <span className="skeleton" /> : filteredRoadData.filter((d) => d.eventType === "kasis").length}</span>
                  <span className="stat-label">🔵 Kasis</span>
                  {activeFilter === "kasis" && <span className="stat-filter-badge">filtre aktif</span>}
                </div>
                <div className="stat-card">
                  <span className="stat-value">
                    {dataLoading
                      ? <span className="skeleton" />
                      : displayData.length > 0
                        ? (displayData.reduce((s, d) => s + d.vibration_score, 0) / displayData.length).toFixed(1)
                        : "0"}
                  </span>
                  <span className="stat-label">Ort. Skor</span>
                </div>
              </div>
            </div>
          </div>

          <div className="sidebar-footer">
            <p>Kahramanmaraş Bölgesi — Gerçek Zamanlı Veri</p>
            <span className="footer-version">v2.0 — Road Quality</span>
          </div>
        </div>
      </aside>

      {/* ── Map ── */}
      <div className={`map-wrapper ${addBumpMode || addPotholeMode || reportPointMode || selectingOriginMode || selectingDestMode ? "cursor-crosshair" : ""}`}>
        <Map
          defaultCenter={KAHRAMANMARAS_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          gestureHandling="greedy"
          disableDefaultUI={false}
          style={{ width: "100%", height: "100%" }}
          onClick={handleMapClick}
        >
          <RoadDataLoader onDataReady={handleDataReady} />

          <DefectMarkers roadData={displayData} isAdmin={isAdmin} />

          {/* Route Origin/Destination Markers */}
          <RouteSelectionMarkers origin={origin} destination={destination} />

          {routeRequested && origin && destination && (
            <DirectionsHandler
              origin={origin}
              destination={destination}
              onRouteReady={handleRouteReady}
            />
          )}

          {routePath && <RouteWarningMarkers routePath={routePath} roadData={filteredRoadData} isAdmin={isAdmin} />}

          {/* Admin: Speed bump markers */}
          <SpeedBumpMarkers speedBumps={speedBumps} isAdmin={isAdmin} />

          {/* Admin: Manuel eklenen çukur markers */}
          <AddedPotholeMarkers potholes={addedPotholes} isAdmin={isAdmin} />

          <MapViewController center={userLocation} />

          {userLocation && <UserLocationMarker position={userLocation} />}
        </Map>

        {/* Admin Panel - Floating on Top Right */}
        {isAdmin && !adminPanelOpen && (
          <button
            className="btn-admin-action"
            style={{ position: 'absolute', top: '20px', right: '65px', zIndex: 1000, background: 'var(--surface)', padding: '10px 15px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontWeight: 600, width: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}
            onClick={() => setAdminPanelOpen(true)}
          >
            <span style={{ fontSize: '16px' }}>🔐</span> Admin Panelini Aç
          </button>
        )}

        {isAdmin && adminPanelOpen && (
          <div className="floating-admin-panel">
            <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="section-icon section-icon-admin">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                Admin Paneli
                <span className="admin-badge">🔐</span>
              </div>
              <button
                onClick={() => setAdminPanelOpen(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--text-secondary)', padding: '0 4px' }}
                title="Paneli Kapat"
              >
                ✕
              </button>
            </div>

            {/* Kasis Ekleme */}
            <button
              className={`btn-admin-action ${addBumpMode ? "active" : ""}`}
              onClick={() => { setAddBumpMode(b => !b); setAddPotholeMode(false); setReportPointMode(false); }}
            >
              <span>🔶</span>
              {addBumpMode ? "Kasis Ekleme — AKTİF (haritaya tıkla)" : "Kasis Ekle"}
            </button>

            {/* Çukur Ekleme */}
            <button
              className={`btn-admin-action ${addPotholeMode ? "active" : ""}`}
              onClick={() => { setAddPotholeMode(b => !b); setAddBumpMode(false); setReportPointMode(false); }}
              style={{ borderColor: "#7c3aed", color: addPotholeMode ? "#fff" : "#7c3aed", background: addPotholeMode ? "#7c3aed" : "transparent" }}
            >
              <span>🕳️</span>
              {addPotholeMode ? "Çukur Ekleme — AKTİF (haritaya tıkla)" : "Çukur Ekle"}
            </button>

            {(addBumpMode || addPotholeMode) && (
              <div className="admin-mode-hint" style={{ marginTop: 0, marginBottom: "8px" }}>
                {addBumpMode ? "Kasis" : "Çukur"} eklemek istediğiniz noktaya tıklayın. Marker'a tıklayarak silebilirsiniz.
              </div>
            )}

            {/* Sayaçlar */}
            {removedIds.length > 0 && (
              <div className="admin-info-badge">🗑️ {removedIds.length} sensör çukuru gizlendi</div>
            )}
            {speedBumps.length > 0 && (
              <div className="admin-info-badge bump">🔶 {speedBumps.length} kasis eklendi</div>
            )}
            {addedPotholes.length > 0 && (
              <div className="admin-info-badge" style={{ borderColor: "#7c3aed", color: "#7c3aed" }}>🕳️ {addedPotholes.length} çukur eklendi</div>
            )}

            {/* Rapor Paneli */}
            <ReportPanel
              roadData={filteredRoadData}
              routePath={routePath}
              onSelectPointMode={() => { setReportPointMode(true); setAddBumpMode(false); }}
            />

            {/* Çıkış */}
            <button className="btn-admin-logout" onClick={logout}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Çıkış Yap
            </button>
          </div>
        )}

        {/* Mode overlay indicator (bottom center) */}
        {(addBumpMode || addPotholeMode || reportPointMode || selectingOriginMode || selectingDestMode) && (
          <div className="map-mode-overlay">
            <span>
              {addBumpMode && "🔶 Kasis Ekleme Modu — Haritaya tıklayın"}
              {addPotholeMode && "🕳️ Çukur Ekleme Modu — Haritaya tıklayın"}
              {reportPointMode && "📍 Rapor Noktası Seçin — Haritaya tıklayın"}
              {selectingOriginMode && "📍 Başlangıç Noktasını Seçin — Haritaya tıklayın"}
              {selectingDestMode && "📍 Varış Noktasını Seçin — Haritaya tıklayın"}
            </span>
            <button onClick={() => {
              setAddBumpMode(false);
              setAddPotholeMode(false);
              setReportPointMode(false);
              setSelectingOriginMode(false);
              setSelectingDestMode(false);
            }}>
              İptal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
