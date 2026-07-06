/**
 * api.js — Envoltura de fetch que agrega el token de sesión (JWT) a cada
 * llamada protegida, para no repetir esta lógica en cada componente.
 */

export const API = "http://localhost:4000/api";

export async function apiFetch(ruta, opciones = {}) {
  const token = localStorage.getItem("token");
  const headers = { "Content-Type": "application/json", ...(opciones.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${ruta}`, { ...opciones, headers });
  if (res.status === 401) {
    // Sesión inválida o expirada: mandar de vuelta al login.
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    window.location.reload();
  }
  return res;
}
