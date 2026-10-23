// Pestañas de Supervisión según permisos (spec 2026-10-22 F2). Sin JSX para probarlo con node --test.
export function pestanasSupervision(permisos = []) {
  return [
    ...(permisos.includes("realizar_visitas_tienda") ? [{ clave: "visita", etiqueta: "Visita a tienda" }] : []),
    ...(permisos.includes("atender_fallas_visita") ? [{ clave: "pendientes", etiqueta: "Pendientes de tienda" }] : []),
    ...(permisos.includes("ver_supervision") ? [{ clave: "resumen", etiqueta: "Supervisión" }] : []),
    ...(permisos.includes("administrar_checklist_visitas") ? [{ clave: "checklist", etiqueta: "Checklist" }] : []),
  ];
}

export const SECCIONES = [
  { clave: "imagen", etiqueta: "Imagen" },
  { clave: "sistemas", etiqueta: "Sistemas" },
  { clave: "funcionamiento", etiqueta: "Funcionamiento" },
];

// Estado de la visita de una tienda en un mes, para el resumen.
export function estadoVisita(visitas, sucursalId) {
  const suyas = visitas.filter((v) => v.sucursal_id === sucursalId);
  if (suyas.some((v) => v.estado === "terminada" && v.ubicacion?.comprobada)) return "hecha";
  if (suyas.some((v) => v.estado === "terminada")) return "no_comprobada";
  if (suyas.some((v) => v.estado === "en_curso")) return "en_curso";
  return "falta";
}
