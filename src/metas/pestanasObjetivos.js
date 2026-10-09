export function pestanasObjetivos({ miVendedorId = null, veTienda = false, permisos = [] } = {}) {
  const administra = permisos.includes("administrar_metas_personalizadas");
  const anula = permisos.includes("anular_capturas_metas");
  return [
    ...(miVendedorId != null ? [
      { clave: "mi-avance", etiqueta: "Mi avance", icono: "Gauge" },
      { clave: "mi-venta", etiqueta: "Mi venta", icono: "Target" },
      { clave: "mis-actividades", etiqueta: "Mis actividades", icono: "Megaphone" },
      { clave: "mis-creditos", etiqueta: "Mis créditos", icono: "CreditCard" },
      { clave: "mis-metas", etiqueta: "Mis metas", icono: "CheckSquare" },
    ] : []),
    ...(veTienda ? [
      { clave: "tienda-avance", etiqueta: "Avance de la tienda", icono: "BarChart3" },
      { clave: "tienda-venta", etiqueta: "Venta de la tienda", icono: "Store" },
      { clave: "tienda-actividades", etiqueta: "Actividades de la tienda", icono: "Users" },
      { clave: "tienda-marcas", etiqueta: "Marcas, productos y créditos", icono: "Tags" },
    ] : []),
    ...(veTienda || administra || anula ? [{ clave: "metas-tienda", etiqueta: "Metas de la tienda", icono: "BarChart3" }] : []),
    ...(administra ? [{ clave: "administrar-metas", etiqueta: "Administrar metas", icono: "Settings2" }] : []),
    ...(permisos.includes("cerrar_mes_objetivos") ? [{ clave: "cierre-mes", etiqueta: "Cierre del mes", icono: "Lock" }] : []),
  ];
}

export function esPestanaMetas(clave) {
  return ["mis-metas", "metas-tienda", "administrar-metas"].includes(clave);
}
