/**
 * Admin Storage — Yol Kalitesi Haritası
 *
 * Silinen çukurlar ve eklenen kasisler için localStorage yönetimi.
 * Firebase yapılandırıldığında Firestore'a geçiş yapılacak.
 */

import { db, isFirebaseConfigured } from "../config/firebase";
// Firestore imports — Firebase aktifken kullanılacak
// import { collection, doc, getDocs, setDoc, deleteDoc } from "firebase/firestore";

const STORAGE_KEYS = {
  REMOVED_POTHOLES: "rqm_removed_potholes",
  ADDED_SPEED_BUMPS: "rqm_added_speed_bumps",
  ADDED_POTHOLES: "rqm_added_potholes",
};

// ─── Silinen Çukurlar ───────────────────────────────────────────────────────────

/**
 * Silinen çukur ID'lerini döndürür.
 * @returns {number[]}
 */
export function getRemovedPotholes() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.REMOVED_POTHOLES);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Bir çukuru silinmiş olarak işaretle.
 * @param {number} id — Çukur veri noktası ID'si
 */
export function addRemovedPothole(id) {
  const removed = getRemovedPotholes();
  if (!removed.includes(id)) {
    removed.push(id);
    localStorage.setItem(STORAGE_KEYS.REMOVED_POTHOLES, JSON.stringify(removed));
  }
}

/**
 * Silinen bir çukuru geri yükle.
 * @param {number} id
 */
export function restorePothole(id) {
  const removed = getRemovedPotholes().filter((pid) => pid !== id);
  localStorage.setItem(STORAGE_KEYS.REMOVED_POTHOLES, JSON.stringify(removed));
}

/**
 * Tüm silinen çukurları geri yükle.
 */
export function clearRemovedPotholes() {
  localStorage.removeItem(STORAGE_KEYS.REMOVED_POTHOLES);
}

// ─── Eklenen Kasisler ───────────────────────────────────────────────────────────

/**
 * Eklenen kasis listesini döndürür.
 * @returns {Array<{id: string, lat: number, lng: number, note: string, addedAt: string}>}
 */
export function getAddedSpeedBumps() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.ADDED_SPEED_BUMPS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Yeni bir kasis noktası ekle.
 * @param {{lat: number, lng: number, note?: string}} bump
 * @returns {string} Oluşturulan kasis ID'si
 */
export function addSpeedBump({ lat, lng, note = "" }) {
  const bumps = getAddedSpeedBumps();
  const id = `bump_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const newBump = {
    id,
    lat,
    lng,
    note,
    addedAt: new Date().toISOString(),
  };
  bumps.push(newBump);
  localStorage.setItem(STORAGE_KEYS.ADDED_SPEED_BUMPS, JSON.stringify(bumps));
  return id;
}

/**
 * Eklenen bir kasisi kaldır.
 * @param {string} id
 */
export function removeSpeedBump(id) {
  const bumps = getAddedSpeedBumps().filter((b) => b.id !== id);
  localStorage.setItem(STORAGE_KEYS.ADDED_SPEED_BUMPS, JSON.stringify(bumps));
}

/**
 * Tüm eklenen kasisleri temizle.
 */
export function clearAddedSpeedBumps() {
  localStorage.removeItem(STORAGE_KEYS.ADDED_SPEED_BUMPS);
}

// ─── Manuel Eklenen Çukurlar ────────────────────────────────────────────────────

export function getAddedPotholes() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.ADDED_POTHOLES);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

export function addPothole({ lat, lng, note = "" }) {
  const potholes = getAddedPotholes();
  const id = `pothole_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  potholes.push({ id, lat, lng, note, addedAt: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEYS.ADDED_POTHOLES, JSON.stringify(potholes));
  return id;
}

export function removeAddedPothole(id) {
  const potholes = getAddedPotholes().filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEYS.ADDED_POTHOLES, JSON.stringify(potholes));
}
