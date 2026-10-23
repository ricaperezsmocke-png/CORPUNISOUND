// Estilos y utilidades compartidas de Supervisión. Las clases largas viven aquí por la regla de 200 caracteres.
export const BOTON = "bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50";
export const BOTON_SECUNDARIO = "border border-slate-300 bg-white text-slate-700 rounded-lg px-3 py-2 text-sm";
export const CAMPO = "block neu-campo rounded-lg px-3 py-2 mt-1 w-full";
export const AVISO = "bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm";
export const ROJO = "bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm";
export const RESULTADO = "flex-1 rounded-lg border py-2.5 text-sm font-semibold";
export const RESULTADOS = [
  { clave: "bien", etiqueta: "Bien", activo: "bg-emerald-600 border-emerald-600 text-white" },
  { clave: "falla", etiqueta: "Falla", activo: "bg-red-600 border-red-600 text-white" },
  { clave: "no_aplica", etiqueta: "N/A", activo: "bg-slate-600 border-slate-600 text-white" },
];

export const fechaDia = (iso) => new Date(iso).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" });

// La pantalla pide la ubicación al navegador; si no llega en 10 s, falla con un mensaje claro.
export function pedirUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Este dispositivo no da ubicación"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error("No se pudo obtener la ubicación; activa el GPS y da permiso")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}
