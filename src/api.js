/**
 * api.js — Envoltura de fetch que agrega el token de sesión (JWT) y la
 * sucursal activa a cada llamada, para no repetir esta lógica en cada
 * componente. El backend ignora la sucursal para usuarios amarrados; solo
 * la respeta para quien tiene "ver_todas_las_sucursales".
 */

// En producción, define VITE_API_URL (ej: https://mi-backend.onrender.com/api)
// al construir el frontend. Sin esa variable, cae a localhost para desarrollo.
export const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

/**
 * Lo que dice el selector de sucursal del encabezado: el id de la tienda como
 * texto, o "todas". Vive aquí porque es el mismo valor que apiFetch le agrega
 * a cada llamada — para que las pantallas no lo lean cada una a su manera.
 */
export function sucursalActiva() {
  return localStorage.getItem("sucursal_activa") || "todas";
}

/**
 * true cuando el encabezado dice "Todas las sucursales".
 *
 * En ese estado el sistema puede MOSTRAR datos de todas las tiendas, pero no
 * puede GUARDAR: no sabría en cuál. Las pantallas que capturan usan esto para
 * frenar ANTES, con un mensaje visible, en vez de dejar que la cajera capture
 * todo y le rebote. El backend también lo rechaza (400 en las rutas de
 * creación de backend/server.js), pero eso es la última red, no el aviso.
 *
 * Solo le pasa al Administrador: cualquier otro rol arranca amarrado a su
 * tienda y el encabezado nunca le dice "Todas".
 */
export function sinSucursalElegida() {
  return sucursalActiva() === "todas";
}

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
