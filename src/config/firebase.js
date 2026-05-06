/**
 * Firebase Configuration — Yol Kalitesi Haritası
 *
 * Bu dosya Firebase altyapısını hazırlar.
 * Firebase Console'dan projeyi oluşturduktan sonra
 * .env dosyasına gerekli değişkenleri ekleyin.
 *
 * Gerekli .env değişkenleri:
 *   VITE_FIREBASE_API_KEY=...
 *   VITE_FIREBASE_AUTH_DOMAIN=...
 *   VITE_FIREBASE_PROJECT_ID=...
 *   VITE_FIREBASE_STORAGE_BUCKET=...
 *   VITE_FIREBASE_MESSAGING_SENDER_ID=...
 *   VITE_FIREBASE_APP_ID=...
 */

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

/**
 * Firebase bağlantısının aktif olup olmadığını kontrol eder.
 * .env'de config yoksa false döner ve uygulama localStorage ile çalışır.
 */
export const isFirebaseConfigured = () => {
  return !!(firebaseConfig.apiKey && firebaseConfig.projectId);
};

// Firebase uygulamasını sadece config varsa başlat
let app = null;
let db = null;

if (isFirebaseConfigured()) {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("🔥 Firebase bağlantısı başarılı");
  } catch (error) {
    console.warn("⚠️ Firebase başlatılamadı, localStorage kullanılacak:", error.message);
  }
} else {
  console.info("ℹ️ Firebase yapılandırılmamış, localStorage kullanılacak");
}

export { app, db };
export default db;
