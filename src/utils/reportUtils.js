// ─── Helpers ────────────────────────────────────────────────────────────────────

function getEventLabelTR(t) {
  if (t === "çukur") return "Çukur";
  if (t === "kasis") return "Kasis";
  if (t === "bozuk") return "Bozuk Yol";
  return "Bilinmiyor";
}

function getStatusLabel(score) {
  if (score <= 4) return "Hafif";
  if (score <= 6) return "Orta";
  if (score <= 8) return "Ciddi";
  return "Kritik";
}

function mapsLink(lat, lng) {
  return `https://maps.google.com/?q=${lat},${lng}`;
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export function generateCSV(dataPoints, reportTitle = "Yol Kalitesi Raporu") {
  const BOM = "﻿";
  const now = new Date().toLocaleString("tr-TR");
  const kasisCount  = dataPoints.filter(d => d.eventType === "kasis").length;
  const cukurCount  = dataPoints.filter(d => d.eventType === "çukur").length;
  const bozukCount  = dataPoints.filter(d => d.eventType === "bozuk").length;
  const critCount   = dataPoints.filter(d => d.vibration_score >= 9).length;
  const avgScore    = dataPoints.length
    ? (dataPoints.reduce((s, d) => s + d.vibration_score, 0) / dataPoints.length).toFixed(1)
    : "0";

  const metadata = [
    `# ${reportTitle}`,
    `# Oluşturulma Tarihi: ${now}`,
    `# Toplam Sorun: ${dataPoints.length}`,
    `# Kasis: ${kasisCount}  |  Çukur: ${cukurCount}  |  Bozuk Yol: ${bozukCount}`,
    `# Kritik (skor 9-10): ${critCount}  |  Ortalama Skor: ${avgScore}`,
    "",
  ].join("\n");

  const header = [
    "No",
    "Olay Türü",
    "Şiddet",
    "Skor (1-10)",
    "Durum",
    "Enlem",
    "Boylam",
    "Hız (m/s)",
    "Google Maps",
  ].join(";");

  const rows = dataPoints.map((p, i) => [
    i + 1,
    getEventLabelTR(p.eventType),
    p.siddet || "-",
    p.vibration_score,
    getStatusLabel(p.vibration_score),
    p.lat?.toFixed(6),
    p.lng?.toFixed(6),
    p.speed ?? "-",
    mapsLink(p.lat, p.lng),
  ].join(";"));

  return BOM + metadata + header + "\n" + rows.join("\n");
}

export function downloadCSV(csvContent, filename = "rapor.csv") {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename, style: "display:none" });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── PDF (print-to-PDF via HTML) ────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 9) return "#dc2626";
  if (score >= 7) return "#ea580c";
  if (score >= 5) return "#ca8a04";
  return "#16a34a";
}

function typeColor(type) {
  if (type === "çukur") return "#7c3aed";
  if (type === "kasis") return "#d97706";
  return "#dc2626";
}

export function generateHTMLReport(dataPoints, reportTitle = "Yol Kalitesi Raporu") {
  const now        = new Date().toLocaleString("tr-TR");
  const kasisCount = dataPoints.filter(d => d.eventType === "kasis").length;
  const cukurCount = dataPoints.filter(d => d.eventType === "çukur").length;
  const bozukCount = dataPoints.filter(d => d.eventType === "bozuk").length;
  const critCount  = dataPoints.filter(d => d.vibration_score >= 9).length;
  const avgScore   = dataPoints.length
    ? (dataPoints.reduce((s, d) => s + d.vibration_score, 0) / dataPoints.length).toFixed(1)
    : "0";

  const tableRows = dataPoints.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><span style="color:${typeColor(p.eventType)};font-weight:600;">${getEventLabelTR(p.eventType)}</span></td>
      <td>${p.siddet || "-"}</td>
      <td style="text-align:center;">
        <span style="background:${scoreColor(p.vibration_score)};color:#fff;padding:2px 8px;border-radius:999px;font-weight:700;font-size:12px;">${p.vibration_score}</span>
      </td>
      <td>${getStatusLabel(p.vibration_score)}</td>
      <td style="font-size:11px;">${p.lat?.toFixed(5)}, ${p.lng?.toFixed(5)}</td>
      <td style="font-size:11px;">${p.speed ?? "-"} m/s</td>
      <td style="font-size:11px;"><a href="${mapsLink(p.lat, p.lng)}" target="_blank" style="color:#2563eb;">Haritada Gör</a></td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8"/>
<title>${reportTitle}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; background: #fff; padding: 32px; }
  h1  { font-size: 22px; font-weight: 800; color: #1e293b; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  .summary { display: flex; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
  .card { flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; text-align: center; }
  .card .num { font-size: 28px; font-weight: 800; }
  .card .lbl { font-size: 11px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #1e293b; color: #fff; padding: 10px 12px; text-align: left; font-weight: 600; font-size: 12px; }
  td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  tr:nth-child(even) td { background: #f8fafc; }
  tr:hover td { background: #f0f9ff; }
  .footer { margin-top: 24px; font-size: 11px; color: #94a3b8; text-align: center; }
  @media print {
    body { padding: 16px; }
    a { color: #2563eb !important; text-decoration: none; }
  }
</style>
</head>
<body>
  <h1>🛣️ ${reportTitle}</h1>
  <p class="meta">Oluşturulma: ${now} &nbsp;|&nbsp; Kahramanmaraş Bölgesi — Jiroskop Tabanlı Yol Kalitesi Analizi</p>

  <div class="summary">
    <div class="card"><div class="num">${dataPoints.length}</div><div class="lbl">Toplam Sorun</div></div>
    <div class="card"><div class="num" style="color:#d97706">${kasisCount}</div><div class="lbl">⛔ Kasis</div></div>
    <div class="card"><div class="num" style="color:#7c3aed">${cukurCount}</div><div class="lbl">🕳️ Çukur</div></div>
    <div class="card"><div class="num" style="color:#dc2626">${bozukCount}</div><div class="lbl">⚡ Bozuk Yol</div></div>
    <div class="card"><div class="num" style="color:#dc2626">${critCount}</div><div class="lbl">🔴 Kritik (9-10)</div></div>
    <div class="card"><div class="num">${avgScore}</div><div class="lbl">Ort. Skor</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th><th>Tür</th><th>Şiddet</th><th>Skor</th><th>Durum</th>
        <th>Koordinat</th><th>Hız</th><th>Konum</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>

  <div class="footer">
    Bu rapor Yol Kalitesi Haritası uygulaması tarafından otomatik oluşturulmuştur. &nbsp;|&nbsp; ${now}
  </div>

  <script>window.onload = () => window.print();<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, "_blank");
  if (!win) alert("Popup engellendi. Lütfen tarayıcı ayarlarından popup iznine izin verin.");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ─── Unified entry point ─────────────────────────────────────────────────────

export function createAndDownloadReport(dataPoints, title = "Yol Kalitesi Raporu", format = "csv") {
  if (format === "pdf") {
    generateHTMLReport(dataPoints, title);
  } else {
    const timestamp = new Date().toISOString().slice(0, 10);
    downloadCSV(generateCSV(dataPoints, title), `yol_raporu_${timestamp}.csv`);
  }
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export function filterByRadius(roadData, center, radiusMeters = 200) {
  return roadData.filter(p => haversineDistance(center.lat, center.lng, p.lat, p.lng) <= radiusMeters);
}

export function filterByRoute(roadData, routePath, tolerance = 0.0005) {
  if (!routePath?.length || !window.google) return [];
  const poly = new google.maps.Polyline({ path: routePath });
  return roadData.filter(p => {
    if (p.vibration_score < 4) return false;
    return google.maps.geometry.poly.isLocationOnEdge(new google.maps.LatLng(p.lat, p.lng), poly, tolerance);
  });
}
