/**
 * api.js — Envoltura de fetch que agrega el token de sesión (JWT) y la
 * sucursal activa a cada llamada, para no repetir esta lógica en cada
 * componente. El backend ignora la sucursal para usuarios amarrados; solo
 * la respeta para quien tiene "ver_todas_las_sucursales".
 */

// En producción, define VITE_API_URL (ej: https://mi-backend.onrender.com/api)
// al construir el frontend. Sin esa variable, cae a localhost para desarrollo.
export const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export async function apiFetch(ruta, opciones = {}) {
  const token = localStorage.getItem("token");
  const sucursalActiva = localStorage.getItem("sucursal_activa"); // id numérico o "todas"

  // Agregar sucursal_id como query param (salvo que ya venga en la ruta o sea "todas").
  let rutaFinal = ruta;
  if (sucursalActiva && sucursalActiva !== "todas" && !ruta.includes("sucursal_id=")) {
    rutaFinal += (ruta.includes("?") ? "&" : "?") + "sucursal_id=" + encodeURIComponent(sucursalActiva);
  }

  const headers = { "Content-Type": "application/json", ...(opciones.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${rutaFinal}`, { ...opciones, headers });
  if (res.status === 401) {
    // Sesión inválida o expirada: mandar de vuelta al login.
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    localStorage.removeItem("sucursal_activa");
    window.location.reload();
  }
  return res;
}
