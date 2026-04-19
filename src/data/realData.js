/**
 * Real road quality data parser with physics-based event detection.
 *
 * CSV columns (semicolon-delimited, comma decimal separator):
 *   time; ax; ay; az; wx; wy; wz; Latitude; Longitude; Speed (m/s); Altitude (m)
 *
 * Detection logic:
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  KASİS (Speed Bump):                                              │
 *  │    - Araç yavaşlıyor (hız düşüyor)                                │
 *  │    - Sensör yukarı yönde hareket algılıyor (az pozitif pik)        │
 *  │    - Sürücü kasisi gördü ve yavaşladı                             │
 *  │                                                                    │
 *  │  ÇUKUR (Pothole):                                                  │
 *  │    - Araç pek yavaşlamıyor (hız sabit/yüksek)                     │
 *  │    - Sensör aşağı yönde ani hareket algılıyor (az negatif pik)    │
 *  │    - Sürücü çukuru görmedi, araç çukura düştü                     │
 *  │                                                                    │
 *  │  DÜZ YOL (Smooth Road):                                           │
 *  │    - az ekseni düşük salınım (gürültü seviyesi)                   │
 *  │    - Normal sürüş titreşimi                                       │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 * Vibration score mapping:
 *   1-3  → İyi   (Good / Green)
 *   4-7  → Orta  (Moderate / Yellow)
 *   8-10 → Kötü  (Bad / Red)
 */

import csvContent1 from "../../2026-04-0111.20.40.csv?raw";
import csvContent2 from "../../2026-03-2916.33.02.csv?raw";

// ─── Parsing Helpers ────────────────────────────────────────────────────────────

/** Parse Turkish-locale number (comma decimal) to JS float. */
function parseNum(str) {
  if (!str) return 0;
  return parseFloat(str.trim().replace(",", "."));
}

// ─── Physics Thresholds (SERT FİLTRE) ───────────────────────────────────────────

/**
 * Gürültü eşiği (noise floor).
 * |az| bu değerin altındaysa, normal yol titreşimi sayılır.
 * Araç motor titreşimi, hafif yol pürüzleri vs. hep gürültüdür.
 */
const NOISE_THRESHOLD = 2.0; // g — yüksek eşik, küçük sarsıntıları yoksay

/**
 * Olay algılama eşiği.
 * Peak-to-peak (max_az - min_az) bu değerin üstündeyse,
 * bir yol olayı (çukur veya kasis) var demektir.
 * 4.5g altı = normal sürüş titreşimi. (Daha sert filtre)
 */
const EVENT_THRESHOLD = 4.5; // g — sadece çok belirgin olayları algıla

/**
 * Yavaşlama eşiği.
 * Hız farkı (speed_end - speed_start) bu değerden düşükse,
 * araç yavaşlamış demektir → sürücü bir şey gördü (kasis).
 */
const DECELERATION_THRESHOLD = -1.0; // m/s — 1 sn içinde 1 m/s yavaşlama frenleme demektir

/**
 * Ciddi olay eşiği.
 * Tek bir az pikinin mutlak değeri bu değeri geçerse,
 * ciddi bir çukur veya kasis var demektir.
 */
const SEVERE_PEAK_THRESHOLD = 6.0; // g — sadece gerçekten çok sert darbeler

/**
 * Peak-to-peak → Skor haritalama tablosu.
 * Sert filtre: Çoğu nokta skor 1-3 olacak.
 * Sadece gerçek yol hasarları yüksek skor alacak.
 */
const SCORE_MAP = [
  [2.0, 1],   // < 2.0g → düz yol, normal titreşim
  [3.5, 2],   // 2.0-3.5g → hafif pürüz, sorun yok
  [4.5, 3],   // 3.5-4.5g → hafif sarsıntı, kabul edilebilir (Olay sayılmaz)
  [6.0, 5],   // 4.5-6.0g → orta düzey çukur/kasis
  [7.5, 7],   // 6.0-7.5g → ciddi çukur/kasis
  [9.0, 8],   // 7.5-9.0g → ağır hasar
  [12.0, 9],  // 9.0-12.0g → tehlikeli
  [Infinity, 10], // > 12.0g → çok tehlikeli
];

// ─── Core Algorithm ─────────────────────────────────────────────────────────────

/**
 * Analiz sonucu: her GPS grubu için yol olayı tespiti.
 *
 * @param {Object} group - GPS grubu
 * @param {number[]} group.azValues - Z-ekseni ivmeölçer değerleri
 * @param {number[]} group.speeds  - Hız değerleri
 * @returns {{ score: number, eventType: string, peakToPeak: number, maxPeak: number }}
 */
function analyzeGroup(group) {
  const { azValues, speeds } = group;

  if (azValues.length === 0) {
    return { score: 1, eventType: "düz", peakToPeak: 0, maxPeak: 0 };
  }

  // ── 1. Peak analizi ───────────────────────────────────────────────
  let maxAz = -Infinity;  // en yüksek yukarı pik
  let minAz = Infinity;   // en düşük aşağı pik
  let maxAzIdx = 0;
  let minAzIdx = 0;

  for (let i = 0; i < azValues.length; i++) {
    if (azValues[i] > maxAz) {
      maxAz = azValues[i];
      maxAzIdx = i;
    }
    if (azValues[i] < minAz) {
      minAz = azValues[i];
      minAzIdx = i;
    }
  }

  const peakToPeak = maxAz - minAz;                 // toplam salınım genliği
  const maxPeak = Math.max(Math.abs(maxAz), Math.abs(minAz)); // en büyük mutlak pik

  // ── 2. Skor hesapla (peak-to-peak tabanlı) ──────────────────────
  let score = 1;
  for (const [threshold, s] of SCORE_MAP) {
    if (peakToPeak <= threshold) {
      score = s;
      break;
    }
  }

  // ── 3. Olay türü tespiti ──────────────────────────────────────────

  // Gürültü seviyesinin altındaysa → düz yol
  if (peakToPeak < EVENT_THRESHOLD) {
    return { score, eventType: "düz", peakToPeak, maxPeak };
  }

  // Hız değişimi analizi: araç yavaşladı mı?
  let speedDelta = 0;
  if (speeds.length >= 2) {
    speedDelta = speeds[speeds.length - 1] - speeds[0];
  }
  const isDecelerating = speedDelta < DECELERATION_THRESHOLD;

  // Pik sırası analizi:
  //   - Negatif pik ÖNCE geldiyse → araç düştü → ÇUKUR
  //   - Pozitif pik ÖNCE geldiyse → araç yukarı kalktı → KASİS
  const negativeFirst = minAzIdx < maxAzIdx;

  // Az baskın yön: hangisi daha güçlü?
  const negativeDominant = Math.abs(minAz) > Math.abs(maxAz);

  let eventType;

  if (negativeDominant && negativeFirst && !isDecelerating) {
    // Aşağı yönde baskın + ilk hareket aşağı + yavaşlama yok
    // → Sürücü çukuru görmedi, araç çukura düştü
    eventType = "çukur";
  } else if (!negativeDominant && isDecelerating) {
    // Yukarı yönde baskın + araç yavaşlıyordu
    // → Sürücü kasisi gördü ve yavaşladı
    eventType = "kasis";
  } else if (negativeDominant && negativeFirst && isDecelerating) {
    // Aşağı yönde ama yavaşladı → kasisi fark etti ama geç kaldı
    eventType = "kasis";
  } else if (peakToPeak > SEVERE_PEAK_THRESHOLD * 2) {
    // Çok büyük salınım, iki yönde de şiddetli → bozuk yol
    eventType = "bozuk";
  } else if (!negativeDominant && !negativeFirst) {
    // İlk hareket yukarı ve yukarı yönlü baskın → yüksek ihtimalle kasis veya tümsek
    eventType = "kasis";
  } else {
    // Geri kalan her türlü şiddetli darbeyi çukur olarak varsay (kasisler daha nadirdir)
    eventType = "çukur";
  }

  // ── 4. Ciddi olay bonus skoru ─────────────────────────────────────
  // Tek bir ani pik çok yüksekse, skor minimum 5 olmalı
  if (maxPeak >= SEVERE_PEAK_THRESHOLD && score < 5) {
    score = 5;
  }
  // Çok şiddetli ani düşüş (6g+) → minimum 7
  if (maxPeak >= SEVERE_PEAK_THRESHOLD * 2 && score < 7) {
    score = 7;
  }

  return { score, eventType, peakToPeak, maxPeak };
}

// ─── CSV Parser & Main Export ───────────────────────────────────────────────────

/**
 * Parse the raw CSV content and produce an array of road data points
 * with physics-based vibration scores and event type classification.
 *
 * @returns {Array<{
 *   id: number,
 *   lat: number,
 *   lng: number,
 *   vibration_score: number,
 *   speed: number,
 *   eventType: string,
 *   peakToPeak: number
 * }>}
 */
export function loadRealRoadData() {
  const lines = [
    ...csvContent1.split("\n"),
    ...csvContent2.split("\n")
  ];
  const dataLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("time") || line.startsWith("Time")) continue;

    const parts = line.split(";");
    if (parts.length < 10) continue;

    const time = parseNum(parts[0]);
    const az = parseNum(parts[3]);  // Z-ekseni ivmeölçer
    const lat = parseNum(parts[7]);
    const lng = parseNum(parts[8]);
    const speed = parseNum(parts[9]);

    // GPS fixi olmayan noktaları atla
    if (lat === 0 && lng === 0) continue;
    // Duran araç okumaları anlamlı değil
    if (speed < 0.5) continue;

    dataLines.push({ time, lat, lng, speed, az });
  }

  // ── GPS koordinatına göre grupla ──────────────────────────────────
  // Aynı lat+lng = aynı GPS epoch'u (GPS ~1 Hz güncellenir)
  const groups = [];
  let currentGroup = null;

  for (const row of dataLines) {
    const key = `${row.lat.toFixed(8)}_${row.lng.toFixed(8)}`;

    if (!currentGroup || currentGroup.key !== key) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = {
        key,
        lat: row.lat,
        lng: row.lng,
        speeds: [row.speed],
        azValues: [row.az],
        times: [row.time],
      };
    } else {
      currentGroup.speeds.push(row.speed);
      currentGroup.azValues.push(row.az);
      currentGroup.times.push(row.time);
    }
  }
  if (currentGroup) groups.push(currentGroup);

  // ── Her grubu analiz et ───────────────────────────────────────────
  const roadData = groups.map((group, idx) => {
    const analysis = analyzeGroup(group);
    const avgSpeed = group.speeds.reduce((a, b) => a + b, 0) / group.speeds.length;

    return {
      id: idx + 1,
      lat: group.lat,
      lng: group.lng,
      vibration_score: analysis.score,
      speed: parseFloat(avgSpeed.toFixed(2)),
      eventType: analysis.eventType,       // "düz", "çukur", "kasis", "bozuk"
      peakToPeak: parseFloat(analysis.peakToPeak.toFixed(3)),
    };
  });

  // Debug: Olay istatistikleri
  const stats = { düz: 0, çukur: 0, kasis: 0, bozuk: 0 };
  roadData.forEach((p) => { stats[p.eventType] = (stats[p.eventType] || 0) + 1; });
  console.log("📊 Yol olayı istatistikleri:", stats);
  console.log(`📊 Skor dağılımı — İyi(1-3): ${roadData.filter(p => p.vibration_score <= 3).length}, Orta(4-7): ${roadData.filter(p => p.vibration_score >= 4 && p.vibration_score <= 7).length}, Kötü(8-10): ${roadData.filter(p => p.vibration_score >= 8).length}`);

  return roadData;
}

export default loadRealRoadData;
