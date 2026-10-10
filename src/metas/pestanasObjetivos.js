export function pestanasObjetivos({ miVendedorId = null, veTienda = false, permisos = [] } = {}) {
  const administra = permisos.includes("administrar_metas_personalizadas");
  const anula = permisos.includes("anular_capturas_metas");
  return [
    ...(miVendedorId != null ? [
      { clave: "mi-avance", etiqueta: "Mi avance", icono: "Gauge", grupo: "mio" },
      { clave: "mi-venta", etiqueta: "Mi venta", icono: "Target", grupo: "mio" },
      { clave: "mis-actividades", etiqueta: "Mis actividades", icono: "Megaphone", grupo: "mio" },
      { clave: "mis-creditos", etiqueta: "Mis créditos", icono: "CreditCard", grupo: "mio" },
      { clave: "mis-metas", etiqueta: "Mis metas extra", icono: "ListChecks", grupo: "mio" },
    ] : []),
    ...(veTienda ? [
      { clave: "tienda-avance", etiqueta: "Avance", icono: "BarChart3", grupo: "tienda" },
      { clave: "tienda-venta", etiqueta: "Venta", icono: "Store", grupo: "tienda" },
      { clave: "tienda-actividades", etiqueta: "Actividades", icono: "Users", grupo: "tienda" },
      { clave: "tienda-marcas", etiqueta: "Marcas, productos y créditos", icono: "Tags", grupo: "tienda" },
    ] : []),
    ...(veTienda || administra || anula ? [{ clave: "metas-tienda", etiqueta: "Metas extra", icono: "ListChecks", grupo: "tienda" }] : []),
    ...(administra ? [{ clave: "administrar-metas", etiqueta: "Administrar metas extra", icono: "Settings2", grupo: "admin" }] : []),
    ...(permisos.includes("cerrar_mes_objetivos") ? [{ clave: "cierre-mes", etiqueta: "Cierre del mes", icono: "Lock", grupo: "admin" }] : []),
  ];
}

export function gruposObjetivos(pestanas) {
  return [
    { clave: "mio", etiqueta: "Lo mío" },
    { clave: "tienda", etiqueta: "La tienda" },
    { clave: "admin", etiqueta: "Administración" },
  ].filter((grupo) => pestanas.some((p) => p.grupo === grupo.clave));
}

export function resolverActiva({ pestanas, pestana, grupo, ultimaPorGrupo = {} }) {
  // Una elección directa (también "Ver mi avance") abre el grupo de esa pestaña.
  const elegida = pestanas.find((p) => p.clave === pestana);
  if (elegida) return { grupo: elegida.grupo, pestana: elegida.clave };

  const grupos = gruposObjetivos(pestanas);
  const grupoValido = grupos.some((g) => g.clave === grupo);
  const grupoActivo = grupoValido ? grupo : grupos[0]?.clave;
  const disponibles = pestanas.filter((p) => p.grupo === grupoActivo);
  // Sin elección directa se está entrando a un grupo: recupera su última pestaña.
  // Si la elegida desapareció, cae a la primera del grupo, sin recuperar otra.
  const recordada = pestana == null && grupoValido
    ? disponibles.find((p) => p.clave === ultimaPorGrupo[grupoActivo]) : null;
  return { grupo: grupoActivo ?? null, pestana: (recordada || disponibles[0])?.clave ?? null };
}

export function esPestanaMetas(clave) {
  return ["mis-metas", "metas-tienda", "administrar-metas"].includes(clave);
}
