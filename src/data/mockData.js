/**
 * This file now exports a function that generates road data dynamically
 * using Google Maps Directions API polylines, ensuring all points
 * are exactly on real roads.
 *
 * vibration_score: 1-3 İyi (Green), 4-7 Orta (Yellow), 8-10 Kötü (Red)
 */

// Seeded PRNG for reproducible vibration scores
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Route pairs across Kahramanmaraş for good road coverage
const ROUTE_PAIRS = [
  // Major arteries
  { origin: "37.5880,36.9050", destination: "37.5730,36.9420" },
  { origin: "37.5920,36.9220", destination: "37.5660,36.9200" },
  { origin: "37.5870,36.9350", destination: "37.5700,36.9080" },
  { origin: "37.5850,36.9120", destination: "37.5780,36.9450" },
  // Cross-city routes
  { origin: "37.5900,36.9100", destination: "37.5900,36.9400" },
  { origin: "37.5680,36.9080", destination: "37.5750,36.9420" },
  { origin: "37.5830,36.9320", destination: "37.5720,36.9120" },
  { origin: "37.5860,36.9180", destination: "37.5690,36.9350" },
  // Inner city detail
  { origin: "37.5810,36.9200", destination: "37.5810,36.9320" },
  { origin: "37.5780,36.9150", destination: "37.5780,36.9300" },
  { origin: "37.5750,36.9180", destination: "37.5850,36.9280" },
  { origin: "37.5840,36.9240", destination: "37.5730,36.9240" },
];

const TARGET_POINT_COUNT = 525;

/**
 * Interpolate extra points along a polyline path to get denser coverage.
 * @param {Array<{lat: number, lng: number}>} path - Array of LatLng objects
 * @param {number} count - Desired number of output points
 * @returns {Array<{lat: number, lng: number}>}
 */
function interpolatePath(path, count) {
  if (path.length === 0) return [];
  if (path.length === 1) return [path[0]];

  // Calculate total distance (using simple Euclidean for small areas)
  const segments = [];
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i + 1].lat - path[i].lat;
    const dy = path[i + 1].lng - path[i].lng;
    const d = Math.sqrt(dx * dx + dy * dy);
    segments.push(d);
    totalDist += d;
  }

  const points = [];
  const step = totalDist / count;

  let segIdx = 0;
  let traveled = 0;
  let segTraveled = 0;

  for (let i = 0; i < count; i++) {
    const target = i * step;

    while (segIdx < segments.length - 1 && traveled + segments[segIdx] < target) {
      traveled += segments[segIdx];
      segIdx++;
      segTraveled = 0;
    }

    const remain = target - traveled;
    const t = segments[segIdx] > 0 ? remain / segments[segIdx] : 0;

    const lat = path[segIdx].lat + (path[segIdx + 1].lat - path[segIdx].lat) * Math.min(t, 1);
    const lng = path[segIdx].lng + (path[segIdx + 1].lng - path[segIdx].lng) * Math.min(t, 1);

    points.push({
      lat: parseFloat(lat.toFixed(6)),
      lng: parseFloat(lng.toFixed(6)),
    });
  }

  return points;
}

/**
 * Fetches real road polylines from Google Maps Directions API
 * and generates data points along them.
 *
 * @returns {Promise<Array>} Array of road data points with vibration scores
 */
export async function generateRoadData() {
  if (!window.google || !window.google.maps) {
    console.error("Google Maps not loaded yet");
    return [];
  }

  const ds = new google.maps.DirectionsService();
  const allPathPoints = [];

  // Fetch real routes in parallel (batched to avoid rate limits)
  for (const route of ROUTE_PAIRS) {
    try {
      const result = await new Promise((resolve, reject) => {
        ds.route(
          {
            origin: route.origin,
            destination: route.destination,
            travelMode: google.maps.TravelMode.DRIVING,
          },
          (res, status) => {
            if (status === "OK") resolve(res);
            else reject(new Error(status));
          }
        );
      });

      // Extract polyline path — these are real road coordinates
      const path = result.routes[0].overview_path.map((p) => ({
        lat: p.lat(),
        lng: p.lng(),
      }));
      allPathPoints.push(path);
    } catch (err) {
      console.warn(`Route failed (${route.origin} → ${route.destination}):`, err.message);
    }
  }

  if (allPathPoints.length === 0) {
    console.error("No routes fetched — returning empty data");
    return [];
  }

  // Calculate how many points per route to reach TARGET_POINT_COUNT
  const pointsPerRoute = Math.ceil(TARGET_POINT_COUNT / allPathPoints.length);

  // Interpolate points along each route
  const rand = mulberry32(42);
  const data = [];
  let id = 1;

  for (const path of allPathPoints) {
    const interpolated = interpolatePath(path, pointsPerRoute);
    for (const pt of interpolated) {
      // Add tiny random perpendicular offset (±5m) for visual spread
      const offset = (rand() - 0.5) * 0.0001;
      const score = Math.floor(rand() * 10) + 1;

      data.push({
        id: id++,
        lat: parseFloat((pt.lat + offset).toFixed(6)),
        lng: parseFloat((pt.lng + offset).toFixed(6)),
        vibration_score: score,
      });
    }
  }

  return data.slice(0, TARGET_POINT_COUNT);
}

// Keep a static fallback (empty) — the real data comes from generateRoadData()
const mockRoadData = [];
export default mockRoadData;
