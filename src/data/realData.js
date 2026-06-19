import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot } from "firebase/firestore";

// Firebase Config ayarların
const firebaseConfig = {
  apiKey: "AIzaSyC6GT45jW0dmWuz1EqCqkEaQWbFYtBz-KQ",
  authDomain: "yol22-eb14c.firebaseapp.com",
  projectId: "yol22-eb14c",
  storageBucket: "yol22-eb14c.firebasestorage.app",
  messagingSenderId: "899862452422",
  appId: "1:899862452422:web:b5e71c00d8b51bd0b6dfc7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * Hem çukurları (potholes) hem de kasisleri (bumps) Firestore'dan gerçek zamanlı çeker.
 * Kasisleri sabit mavi yapar, çukurları şiddetine göre (Kırmızı, Turuncu, Yeşil) renklendirir.
 */
export function loadRealRoadData(onUpdate) {
  console.log("Firestore'dan yol anomalileri (çukur ve kasis) yükleniyor...");

  // İki koleksiyonun verilerini hafızada tutacak nesne
  let allAnomalies = { potholes: [], bumps: [] };

  // Haritayı tetikleyen ortak birleştirme fonksiyonu
  const mergeAndEmit = () => {
    const combined = [...allAnomalies.potholes, ...allAnomalies.bumps];
    // Şiddet skoruna göre büyükten küçüğe sırala (Önce en tehlikeliler üstte görünsün)
    combined.sort((a, b) => b.severity_score - a.severity_score);
    onUpdate(combined);
  };

  // 1. ÇUKUR DİNLEYİCİSİ (Dereceli: Kırmızı, Turuncu, Yeşil)
  const unsubscribePotholes = onSnapshot(collection(db, "potholes"), (snapshot) => {
    allAnomalies.potholes = snapshot.docs.map(doc => {
      const p = doc.data();

      let vibration_score = 3;
      let marker_color = "green";

      // Şiddet kontrolü ve renk ataması
      if (p.severity === "Ağır / Tehlikeli Çukur") {
        vibration_score = 9;
        marker_color = "red";
      } else if (p.severity === "Orta Şiddetli Çukur") {
        vibration_score = 6;
        marker_color = "orange";
      } else if (p.severity === "Hafif Çukur") {
        vibration_score = 3;
        marker_color = "green";
      }

      return {
        id: p.cluster_id,
        lat: p.lat,
        lng: p.lon,
        siddet: p.severity,
        severity_score: p.severity_score,
        peakToPeak: p.az_range_mean,
        n_points: p.n_points,
        eventType: "çukur",
        color: marker_color, // Doğrudan şiddet rengini basıyoruz, çakışmayı önler
        vibration_score: vibration_score,
        speed: 0,
      };
    });
    mergeAndEmit();
  }, (error) => {
    console.error("Çukur verisi dinleme hatası:", error);
  });

  // 2. KASİS DİNLEYİCİSİ (Şiddetsiz: Net Mavi)
  const unsubscribeBumps = onSnapshot(collection(db, "bumps"), (snapshot) => {
    console.log(`🔵 Firestore 'bumps' koleksiyonu: ${snapshot.docs.length} doküman bulundu`);
    
    // İlk dokümanın ham verisini göster (alan adlarını kontrol için)
    if (snapshot.docs.length > 0) {
      console.log("🔵 İlk kasis ham verisi:", JSON.stringify(snapshot.docs[0].data()));
    }

    allAnomalies.bumps = snapshot.docs.map(doc => {
      const b = doc.data();

      const mapped = {
        id: b.cluster_id,
        lat: b.lat,
        lng: b.lon ?? b.lng,  // Firestore'da 'lon' veya 'lng' olabilir
        siddet: "Kasis",
        severity_score: b.severity_score ?? 5,
        peakToPeak: b.az_range_mean,
        n_points: b.n_points,
        eventType: "kasis",
        color: "blue",
        vibration_score: 5,
        speed: 0,
      };
      return mapped;
    });

    // Geçersiz koordinatları filtrele
    const validCount = allAnomalies.bumps.filter(b => b.lat && b.lng).length;
    const invalidCount = allAnomalies.bumps.length - validCount;
    if (invalidCount > 0) {
      console.warn(`⚠️ ${invalidCount} kasisin koordinatı eksik/geçersiz!`);
    }
    console.log(`🔵 ${validCount} geçerli kasis haritaya ekleniyor`);

    mergeAndEmit();
  }, (error) => {
    console.error("Kasis verisi dinleme hatası:", error);
  });

  // Bileşenden çıkıldığında dinleyicileri kapatmak için temizleme fonksiyonu döndür
  return () => {
    unsubscribePotholes();
    unsubscribeBumps();
  };
}

export default loadRealRoadData;