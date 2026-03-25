import { useEffect, useRef, useState, useCallback } from "react";
import { Map, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { generateRoadData } from "../data/mockData";

// ─── Constants ─────────────────────────────────────────────────────────────────
const KAHRAMANMARAS_CENTER = { lat: 37.5753, lng: 36.9228 };
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

// ─── Heatmap Sub-component ─────────────────────────────────────────────────────
function HeatmapLayer({ roadData }) {
  const map = useMap();
  const visualization = useMapsLibrary("visualization");
  const heatmapRef = useRef(null);

  useEffect(() => {
    if (!map || !visualization || !roadData || roadData.length === 0) return;

    // Build weighted LatLng data from road data points
    const heatmapData = roadData.map((point) => ({
      location: new google.maps.LatLng(point.lat, point.lng),
      weight: point.vibration_score,
    }));

    // Create or update the HeatmapLayer
    if (!heatmapRef.current) {
      heatmapRef.current = new google.maps.visualization.HeatmapLayer({
        data: heatmapData,
        map,
        radius: 30,
        opacity: 0.7,
        gradient: [
          "rgba(0, 255, 0, 0)",
          "rgba(0, 255, 0, 1)",
          "rgba(255, 255, 0, 1)",
          "rgba(255, 165, 0, 1)",
          "rgba(255, 0, 0, 1)",
        ],
      });
    } else {
      heatmapRef.current.setData(heatmapData);
      heatmapRef.current.setMap(map);
    }

    return () => {
      if (heatmapRef.current) {
        heatmapRef.current.setMap(null);
        heatmapRef.current = null;
      }
    };
  }, [map, visualization, roadData]);

  return null;
}

// ─── Autocomplete Input Sub-component ──────────────────────────────────────────
function AutocompleteInput({ label, placeholder, onPlaceSelect, showLocationBtn, onUseMyLocation, locationLoading, inputRef: externalRef }) {
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
      <div className="input-wrapper">
        <input ref={inputRef} type="text" placeholder={placeholder} />
      </div>
      {showLocationBtn && (
        <button
          className="btn-use-location"
          onClick={onUseMyLocation}
          disabled={locationLoading}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
          </svg>
          {locationLoading ? "Konum alınıyor..." : "Konumumu kullan"}
        </button>
      )}
    </div>
  );
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
        suppressMarkers: false,
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
function RouteWarningMarkers({ routePath, roadData }) {
  const map = useMap();
  const geometry = useMapsLibrary("geometry");
  const markersRef = useRef([]);

  useEffect(() => {
    // Clean up old markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (!map || !geometry || !routePath || routePath.length === 0 || !roadData) return;

    const routePoly = new google.maps.Polyline({ path: routePath });

    roadData.forEach((point) => {
      if (point.vibration_score <= 4) return;

      const latLng = new google.maps.LatLng(point.lat, point.lng);
      const isOnRoute = google.maps.geometry.poly.isLocationOnEdge(
        latLng,
        routePoly,
        EDGE_TOLERANCE
      );

      if (isOnRoute) {
        const marker = new google.maps.Marker({
          map,
          position: latLng,
          title: `${getScoreLabel(point.vibration_score)} Yol — Skor: ${point.vibration_score}/10`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: getScoreColor(point.vibration_score),
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          label: {
            text: `${point.vibration_score}`,
            color: "#ffffff",
            fontWeight: "bold",
            fontSize: "12px",
          },
        });

        const infoWindow = new google.maps.InfoWindow({
          content: `<div style="font-family:Inter,sans-serif;padding:4px 8px;">
            <strong style="color:${getScoreColor(point.vibration_score)}">
              ⚠ ${getScoreLabel(point.vibration_score)} Yol
            </strong><br/>
            <span>Titreşim Skoru: <b>${point.vibration_score}/10</b></span>
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
  }, [map, geometry, routePath, roadData]);

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

// ─── Road Data Loader (fetches real road polylines from Directions API) ────────
function RoadDataLoader({ onDataReady }) {
  const map = useMap();
  const routes = useMapsLibrary("routes");
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!map || !routes || loadedRef.current) return;
    loadedRef.current = true;

    console.log("🛣️ Yol verileri Directions API'den yükleniyor...");
    generateRoadData().then((data) => {
      console.log(`✅ ${data.length} yol veri noktası yüklendi`);
      onDataReady(data);
    });
  }, [map, routes, onDataReady]);

  return null;
}

// ─── Main MapComponent ─────────────────────────────────────────────────────────
export default function MapComponent() {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [routeRequested, setRouteRequested] = useState(false);
  const [routePath, setRoutePath] = useState(null);
  const [warningCount, setWarningCount] = useState(0);
  const [userLocation, setUserLocation] = useState(null);
  const [locatingUser, setLocatingUser] = useState(false);
  const [roadData, setRoadData] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  const handleRouteReady = useCallback(
    (path) => {
      setRoutePath(path);

      // Count how many bad points are on the route
      if (path && window.google && roadData.length > 0) {
        const routePoly = new google.maps.Polyline({ path });
        const count = roadData.filter((p) => {
          if (p.vibration_score <= 4) return false;
          const latLng = new google.maps.LatLng(p.lat, p.lng);
          return google.maps.geometry.poly.isLocationOnEdge(
            latLng,
            routePoly,
            EDGE_TOLERANCE
          );
        }).length;
        setWarningCount(count);
      } else {
        setWarningCount(0);
      }
    },
    [roadData]
  );

  const handleGetRoute = () => {
    if (origin && destination) {
      setRouteRequested(false); // reset to trigger re-render
      setTimeout(() => setRouteRequested(true), 0);
    }
  };

  const handleClearRoute = () => {
    setRouteRequested(false);
    setRoutePath(null);
    setWarningCount(0);
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
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
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
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="sidebar-scroll">
          <div className="sidebar-header">
            <div className="logo">
              <div className="logo-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12h2M19 12h2M12 3v2M12 19v2"/>
                  <circle cx="12" cy="12" r="7"/>
                  <circle cx="12" cy="12" r="3"/>
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
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
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
                  />
                  <AutocompleteInput
                    label="Varış"
                    placeholder="Nereye..."
                    onPlaceSelect={setDestination}
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
                    <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                  </svg>
                  Rota Getir
                </button>
                <button className="btn-secondary" onClick={handleClearRoute}>
                  Rotayı Temizle
                </button>
              </div>
            </div>

            {/* Route warnings summary */}
            {routeRequested && routePath && (
              <div className="warnings-section">
                {warningCount > 0 ? (
                  <div className="warning-card">
                    <span className="warning-card-icon">⚠️</span>
                    <div>
                      <strong>{warningCount} Uyarı Bulundu</strong>
                      <p>Bu rotada dikkat edilmesi gereken bölgeler var.</p>
                    </div>
                  </div>
                ) : (
                  <div className="success-card">
                    <span className="success-card-icon">✅</span>
                    <div>
                      <strong>Güvenli Rota</strong>
                      <p>Bu rotada kötü yol noktası bulunamadı.</p>
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
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="9" y1="21" x2="9" y2="9"/>
                  </svg>
                </span>
                Gösterge
              </div>
              <div className="legend-items">
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "#22c55e" }}></span>
                  İyi (1-3)
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "#eab308" }}></span>
                  Orta (4-7)
                </div>
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: "#ef4444" }}></span>
                  Kötü (8-10)
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="stats-section">
              <div className="section-title">
                <span className="section-icon section-icon-stats">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10"/>
                    <line x1="12" y1="20" x2="12" y2="4"/>
                    <line x1="6" y1="20" x2="6" y2="14"/>
                  </svg>
                </span>
                Veri Özeti
              </div>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-value">{dataLoading ? <span className="skeleton" /> : roadData.length}</span>
                  <span className="stat-label">Toplam Nokta</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">
                    {dataLoading ? <span className="skeleton" /> : roadData.filter((d) => d.vibration_score >= 8).length}
                  </span>
                  <span className="stat-label">Kötü Yol</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">
                    {dataLoading
                      ? <span className="skeleton" />
                      : roadData.length > 0
                      ? (roadData.reduce((s, d) => s + d.vibration_score, 0) / roadData.length).toFixed(1)
                      : "0"}
                  </span>
                  <span className="stat-label">Ort. Skor</span>
                </div>
              </div>
            </div>
          </div>

          <div className="sidebar-footer">
            <p>Kahramanmaraş Bölgesi — Gerçek Zamanlı Veri</p>
            <span className="footer-version">v1.0 — Road Quality</span>
          </div>
        </div>
      </aside>

      {/* ── Map ── */}
      <div className="map-wrapper">
        <Map
          defaultCenter={KAHRAMANMARAS_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          gestureHandling="greedy"
          disableDefaultUI={false}
          style={{ width: "100%", height: "100%" }}
        >
          {/* Load road data dynamically from Directions API */}
          <RoadDataLoader onDataReady={(data) => { setRoadData(data); setDataLoading(false); }} />

          {/* Heatmap layer showing all data points */}
          <HeatmapLayer roadData={roadData} />

          {/* Directions rendering (only when route is requested) */}
          {routeRequested && origin && destination && (
            <DirectionsHandler
              origin={origin}
              destination={destination}
              onRouteReady={handleRouteReady}
            />
          )}

          {/* Warning markers on route (only for bad roads) */}
          {routePath && <RouteWarningMarkers routePath={routePath} roadData={roadData} />}

          {/* Pan map to user location */}
          <MapViewController center={userLocation} />

          {/* User location blue dot */}
          {userLocation && <UserLocationMarker position={userLocation} />}
        </Map>
      </div>
    </div>
  );
}
