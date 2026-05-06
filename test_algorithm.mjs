import fs from "node:fs";
const csv = fs.readFileSync("./yol_veri.csv", "utf8");

const ACCEL_LSB_PER_G = 16384, GYRO_LSB_PER_DPS = 131, G = 9.81;

const MIN_SPEED        = 1.5;
const BASELINE_WIN_MS  = 1500;
const EVENT_WIN_MS     = 700;
const BG_WIN_START_MS  = 3000;   // bg RMS penceresi başlangıcı (öncesi)
const BG_WIN_END_MS    = 800;    // bg RMS penceresi bitişi (öncesi)

// Kasis eşikleri
const KASIS_P2P_MIN    = 5.0;
const KASIS_DECEL_MIN  = 1.2;    // normal
const KASIS_DECEL_EASY = 0.8;    // yüksek p2p (>=7) için gevşek
const KASIS_P2P_HIGH   = 7.0;    // gevşek decel için min p2p
const KASIS_CONTRAST   = 2.8;    // spike / bg_rms — bozuktan ayırt

// Çukur eşikleri
const POTHOLE_P2P_MIN  = 5.0;
const ROLL_TRIGGER     = 22;

// Bozuk
const BOZUK_P2P_MIN    = 8.0;

const YAW_REJECT       = 35;
const DECEL_LOOKBACK   = 2000;
const MERGE_GAP_MS     = 2500;

function parseNum(s) { return s ? parseFloat(s.trim().replace(",", ".")) : 0; }
function parseLatLon(s) {
  if (!s) return 0;
  const p = s.trim().split(".");
  return p.length > 2 ? parseFloat(p[0] + "." + p.slice(1).join("")) : parseFloat(s.replace(",", "."));
}

const lines = csv.split("\n");
const rows = [];
for (let i = 1; i < lines.length; i++) {
  const p = lines[i].trim().split(",");
  if (p.length < 13) continue;
  const t = parseNum(p[2]), ax = parseNum(p[3]), ay = parseNum(p[4]), az = parseNum(p[5]);
  const wx = parseNum(p[6]), wy = parseNum(p[7]), wz = parseNum(p[8]);
  const lat = parseLatLon(p[9]), lng = parseLatLon(p[10]), speed = parseNum(p[11]);
  if ([t, ax, ay, az, wx, wy, wz].some(Number.isNaN)) continue;
  rows.push({ t, ax, ay, az, wx, wy, wz, lat, lng, speed });
}

// Bias kalibrasyonu
const sample = rows.filter(r => r.speed < 0.3).slice(0, 200);
const base = sample.length >= 30 ? sample : rows.slice(0, 100);
const mean = (arr, k) => arr.reduce((s, r) => s + r[k], 0) / arr.length;
const biasWx = mean(base, "wx"), biasWy = mean(base, "wy"), biasWz = mean(base, "wz");

// Kayan baseline (ax)
function rollingBaseline(rows, windowMs) {
  const out = new Array(rows.length).fill(0);
  let sum = 0, count = 0, l = 0;
  for (let r = 0; r < rows.length; r++) {
    sum += rows[r].ax; count++;
    while (rows[r].t - rows[l].t > windowMs && l < r) { sum -= rows[l].ax; count--; l++; }
    out[r] = sum / count;
  }
  return out;
}
const axBaseline = rollingBaseline(rows, BASELINE_WIN_MS);

const samples = rows.map((r, i) => ({
  ...r,
  vert:     ((r.ax - axBaseline[i]) / ACCEL_LSB_PER_G) * G,
  yawRate:  Math.abs((r.wx - biasWx) / GYRO_LSB_PER_DPS),
  rollRate: Math.hypot(r.wy - biasWy, r.wz - biasWz) / GYRO_LSB_PER_DPS,
}));

function idxAt(arr, fromIdx, dtMs) {
  const target = arr[fromIdx].t + dtMs;
  if (dtMs > 0) { let i = fromIdx; while (i < arr.length - 1 && arr[i].t < target) i++; return i; }
  let i = fromIdx; while (i > 0 && arr[i].t > target) i--; return i;
}

// RMS vert over a window range
function bgRms(samples, i, startMs, endMs) {
  const lo = idxAt(samples, i, -startMs);
  const hi = idxAt(samples, i, -endMs);
  if (hi <= lo) return 0;
  let ss = 0, n = 0;
  for (let j = lo; j <= hi; j++) { ss += samples[j].vert ** 2; n++; }
  return Math.sqrt(ss / n);
}

const events = [];
for (let i = 0; i < samples.length; i++) {
  const s = samples[i];
  if (s.speed < MIN_SPEED) continue;
  if (!Number.isFinite(s.lat) || s.lat === 0) continue;

  const lo = idxAt(samples, i, -EVENT_WIN_MS / 2);
  const hi = idxAt(samples, i,  EVENT_WIN_MS / 2);

  let vMax = -Infinity, vMin = Infinity, rMax = 0, yMax = 0;
  let peakCount = 0, prev = 0;
  for (let j = lo; j <= hi; j++) {
    const v = samples[j].vert;
    if (v > vMax) vMax = v;
    if (v < vMin) vMin = v;
    if (samples[j].rollRate > rMax) rMax = samples[j].rollRate;
    if (samples[j].yawRate > yMax) yMax = samples[j].yawRate;
    if (Math.sign(v) !== Math.sign(prev) && Math.abs(v) > 1.5) peakCount++;
    prev = v;
  }
  const p2p = vMax - vMin;
  if (p2p < 4.5) continue;
  if (yMax > YAW_REJECT) continue;

  // Yavaşlama
  const back = idxAt(samples, i, -DECEL_LOOKBACK);
  let maxPrev = s.speed;
  for (let j = back; j < i; j++) if (samples[j].speed > maxPrev) maxPrev = samples[j].speed;
  const decel = maxPrev - s.speed;

  // Arka plan gürültüsü (kasise varmadan önceki yol)
  const bgNoise = bgRms(samples, i, BG_WIN_START_MS, BG_WIN_END_MS);
  const contrast = p2p / (bgNoise + 0.5);  // +0.5 → düz yolda sonsuz bölme engel

  const negDom = (-vMin) > vMax * 1.15;
  const posDom = vMax > (-vMin) * 1.15;

  let eventType = null, score = 0, siddet = "";

  // ── KASİS ──
  // Normal: yavaşlama >= 1.2 + p2p >= 5 + pozitif/çift zirve + kontrast yüksek
  // Hafifletilmiş: p2p >= 7 + yavaşlama >= 0.8 + kontrast yüksek (hızlı geçiş)
  const decelOk   = decel >= KASIS_DECEL_MIN;
  const decelEasy = decel >= KASIS_DECEL_EASY && p2p >= KASIS_P2P_HIGH;
  const kasPattern = posDom || peakCount >= 2;
  const goodContrast = contrast >= KASIS_CONTRAST;

  if ((decelOk || decelEasy) && p2p >= KASIS_P2P_MIN && kasPattern && goodContrast) {
    eventType = "kasis";
    score = Math.min(10, Math.round(4 + p2p * 0.4 + decel * 1.3));
    siddet = peakCount >= 2 ? "Plastik/tık-tık" : "Yayvan kasis";
  }
  // ── ÇUKUR ──
  else if (rMax > ROLL_TRIGGER && p2p >= POTHOLE_P2P_MIN && yMax < YAW_REJECT * 0.6 && (negDom || !posDom)) {
    eventType = "çukur";
    score = Math.min(10, Math.round(4 + p2p * 0.35 + rMax * 0.07));
    siddet = "Tek tekerlek darbesi";
  }
  // ── BOZUK ──
  else if (p2p >= BOZUK_P2P_MIN) {
    eventType = "bozuk";
    score = Math.min(10, Math.round(3 + p2p * 0.45));
    siddet = "Genel sarsıntı";
  } else continue;

  events.push({ t: s.t, lat: s.lat, lng: s.lng, speed: s.speed, eventType, score, p2p, rMax, decel, contrast, bgNoise, siddet });
}

// Merge
const merged = [];
for (const ev of events) {
  const last = merged[merged.length - 1];
  if (last && (ev.t - last.t) < MERGE_GAP_MS) {
    if (ev.score > last.score) Object.assign(last, ev);
  } else merged.push({ ...ev });
}

const stats = { kasis: 0, çukur: 0, bozuk: 0 };
for (const e of merged) stats[e.eventType] = (stats[e.eventType] || 0) + 1;
console.log(`\n${rows.length} satır → ${events.length} ham → ${merged.length} olay`);
console.log("Tip:", stats);

console.log("\n── KASİSLER ──");
merged.filter(e => e.eventType === "kasis").forEach(e =>
  console.log(`  skor=${e.score} p2p=${e.p2p.toFixed(1)} decel=${e.decel.toFixed(2)} kontrast=${e.contrast.toFixed(1)} bgNoise=${e.bgNoise.toFixed(2)} hız=${e.speed.toFixed(1)} @${e.lat.toFixed(5)},${e.lng.toFixed(5)}`));

console.log("\n── ÇUKURLAR ──");
merged.filter(e => e.eventType === "çukur").forEach(e =>
  console.log(`  skor=${e.score} p2p=${e.p2p.toFixed(1)} roll=${e.rMax.toFixed(0)} hız=${e.speed.toFixed(1)} @${e.lat.toFixed(5)},${e.lng.toFixed(5)}`));

console.log("\n── BOZUK (skor 8+) ──");
merged.filter(e => e.eventType === "bozuk").forEach(e =>
  console.log(`  skor=${e.score} p2p=${e.p2p.toFixed(1)} bgNoise=${e.bgNoise.toFixed(2)} kontrast=${e.contrast.toFixed(1)} hız=${e.speed.toFixed(1)} @${e.lat.toFixed(5)},${e.lng.toFixed(5)}`));
