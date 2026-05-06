import { useState, useCallback, useEffect } from "react";
import { filterByRadius, filterByRoute, createAndDownloadReport } from "../utils/reportUtils";

export default function ReportPanel({ roadData, routePath, onSelectPointMode }) {
  const [reportMode,    setReportMode]    = useState("point");
  const [radius,        setRadius]        = useState(200);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [generating,    setGenerating]    = useState(false);
  const [lastReport,    setLastReport]    = useState(null);

  useEffect(() => {
    const handler = (e) => { if (e.detail) { setSelectedPoint(e.detail); setReportMode("point"); } };
    window.addEventListener("rqm-report-point-selected", handler);
    return () => window.removeEventListener("rqm-report-point-selected", handler);
  }, []);

  const run = useCallback((points, title, reportInfo, format) => {
    if (points.length > 0) {
      createAndDownloadReport(points, title, format);
      setLastReport({ ...reportInfo, format });
    } else {
      setLastReport({ ...reportInfo, empty: true });
    }
    setGenerating(false);
  }, []);

  const download = useCallback((format) => {
    if (!roadData) return;
    setGenerating(true);

    setTimeout(() => {
      if (reportMode === "point") {
        if (!selectedPoint) { setGenerating(false); return; }
        const pts = filterByRadius(roadData, selectedPoint, radius).filter(d => d.vibration_score >= 4);
        run(pts,
          `Nokta Raporu — ${selectedPoint.lat.toFixed(4)}, ${selectedPoint.lng.toFixed(4)} (${radius}m)`,
          { type: "point", count: pts.length }, format);

      } else if (reportMode === "route") {
        if (!routePath) { setGenerating(false); return; }
        const pts = filterByRoute(roadData, routePath);
        run(pts, "Rota Raporu — Yol Kalitesi Analizi", { type: "route", count: pts.length }, format);

      } else {
        const pts = roadData.filter(d => d.vibration_score >= 5);
        run(pts, "Tüm Yol Arızaları — Yol Kalitesi Raporu", { type: "all", count: pts.length }, format);
      }
    }, 300);
  }, [roadData, routePath, reportMode, selectedPoint, radius, run]);

  const btnStyle = (color) => ({
    flex: 1,
    padding: "7px 4px",
    fontSize: "12px",
    fontWeight: 600,
    borderRadius: "7px",
    cursor: "pointer",
    border: `1.5px solid ${color}`,
    background: color,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
  });

  const canDownload = reportMode === "all"
    || (reportMode === "point" && !!selectedPoint)
    || (reportMode === "route" && !!routePath);

  return (
    <div className="report-panel">
      <div className="section-title">
        <span className="section-icon section-icon-report">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </span>
        Rapor Oluştur
      </div>

      {/* Kapsam seçici */}
      <div className="report-tabs">
        <button className={`report-tab ${reportMode === "point" ? "active" : ""}`} onClick={() => setReportMode("point")}>📍 Nokta</button>
        <button className={`report-tab ${reportMode === "route" ? "active" : ""}`} onClick={() => setReportMode("route")}>🗺️ Rota</button>
        <button className={`report-tab ${reportMode === "all"   ? "active" : ""}`} onClick={() => setReportMode("all")}>📋 Tümü</button>
      </div>

      {/* Nokta raporu */}
      {reportMode === "point" && (
        <div className="report-mode-content">
          <p className="report-hint">Haritada bir noktaya tıklayarak o bölgedeki sorunları raporlayın.</p>
          <button className="btn-report-select" onClick={() => onSelectPointMode?.()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
            </svg>
            Haritadan Nokta Seç
          </button>
          {selectedPoint && (
            <div className="report-selected-info">
              <span>📍 {selectedPoint.lat.toFixed(4)}, {selectedPoint.lng.toFixed(4)}</span>
            </div>
          )}
          <div className="report-radius-field">
            <label>Yarıçap: <strong>{radius}m</strong></label>
            <input type="range" min="50" max="1000" step="50" value={radius} onChange={e => setRadius(Number(e.target.value))} />
          </div>
        </div>
      )}

      {/* Rota raporu */}
      {reportMode === "route" && (
        <div className="report-mode-content">
          <p className="report-hint">Rota planlamasını kullanarak rotanızı belirleyin, sonra rapor alın.</p>
          <div className="report-route-ready">
            <span className={`report-route-badge ${routePath ? "" : "warning"}`}>
              {routePath ? "✅ Rota hazır" : "⚠️ Önce rota belirleyin"}
            </span>
          </div>
        </div>
      )}

      {/* Tüm arızalar */}
      {reportMode === "all" && (
        <div className="report-mode-content">
          <p className="report-hint">Tüm tespit edilen yol arızalarının (skor ≥ 5) raporunu alın.</p>
        </div>
      )}

      {/* İndirme butonları — her zaman görünür */}
      <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
        <button
          style={{ ...btnStyle("#2563eb"), opacity: (!canDownload || generating) ? 0.45 : 1 }}
          onClick={() => download("csv")}
          disabled={!canDownload || generating}
        >
          {generating ? <span className="login-spinner" /> : <>📄 CSV</>}
        </button>
        <button
          style={{ ...btnStyle("#dc2626"), opacity: (!canDownload || generating) ? 0.45 : 1 }}
          onClick={() => download("pdf")}
          disabled={!canDownload || generating}
        >
          {generating ? <span className="login-spinner" /> : <>🖨️ PDF</>}
        </button>
      </div>
      {lastReport && !lastReport.empty && lastReport.format === "pdf" && (
        <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "6px", lineHeight: 1.4 }}>
          Yeni sekmede açılan raporda <b>Ctrl+P</b> ile yazdır diyaloğundan PDF olarak kaydedin.
        </p>
      )}

      {/* Son işlem sonucu */}
      {lastReport && (
        <div className={`report-result ${lastReport.empty ? "empty" : "success"}`}>
          {lastReport.empty
            ? <span>Bu alanda/rotada sorun bulunamadı.</span>
            : <span>✅ {lastReport.count} sorun — {lastReport.format?.toUpperCase()} hazır.</span>}
        </div>
      )}
    </div>
  );
}
