/**
 * menuCategorias.js — La estructura del menú y quién ve qué.
 *
 * Vive aparte de BarraLateral.jsx a propósito: aquí no hay JSX ni iconos, solo
 * datos y funciones puras. Así se puede probar con `node --test`, que es la
 * única prueba automática que este proyecto tiene del lado del frontend, y es
 * justo la parte donde un error no se ve: si el filtro se equivoca, a alguien
 * le falta un módulo y nadie se entera hasta que pasa en la tienda.
 *
 * Los iconos los pone BarraLateral.jsx, que es quien dibuja.
 */

export const CATEGORIAS = [
  {
    id: "operacion",
    nombre: "OPERACIÓN",
    modulos: [
      {
        id: "pos", nombre: "Punto de Venta", modulo: "pos", pantalla: "punto_venta",
        // Estas dos pantallas ya existen dentro de PuntoDeVenta.jsx. Se muestran
        // para que se vean en el mapa del sistema, pero navegan al padre: entrar
        // directo exigiría tocar PuntoDeVenta.jsx, que está fuera de alcance.
        hijos: [
          { id: "consultas", nombre: "Consultas de Ventas" },
          { id: "apartados", nombre: "Apartados" },
        ],
      },
      { id: "corte", nombre: "Corte de Caja", modulo: "corte", permiso: "realizar_corte_caja", pantalla: "corte_caja" },
      { id: "gastos", nombre: "Gastos", modulo: "gastos", permiso: "ver_gastos", pantalla: "gastos_caja" },
      {
        id: "inventario", nombre: "Inventario y Productos", modulo: "inventario",
        hijos: [{ id: "recepcion", nombre: "Recepción de Compras" }],
      },
      { id: "traspasos", nombre: "Traspasos entre Sucursales", modulo: "inventario", permiso: "realizar_traspasos" },
      { id: "existencias_sicar", nombre: "Existencias SICAR", modulo: "inventario", permiso: "ver_existencias_sicar" },
      { id: "traspasos_sicar", nombre: "Traspasos SICAR", modulo: "inventario", permiso: "ver_traspasos_sicar" },
      { id: "facturas_por_llegar", nombre: "Facturas por Llegar", modulo: "inventario", permiso: "ver_facturas_por_llegar" },
    ],
  },
  {
    id: "comercial",
    nombre: "COMERCIAL",
    modulos: [
      { id: "crm", nombre: "CRM", modulo: "crm" },
      { id: "radar_demanda", nombre: "Radar de Demanda", modulo: "radar_demanda",
        permiso: ["ver_radar_demanda", "registrar_demanda", "ver_resumen_demanda"] },
      { id: "ml", nombre: "MercadoLibre", modulo: "ml" },
      { id: "gerencia_ventas", nombre: "Objetivos", modulo: "pos",
        permiso: [
          "usar_gerente_ventas", "editar_objetivos_venta", "administrar_metas_personalizadas", "anular_capturas_metas", "cerrar_mes_objetivos",
        ] },
    ],
  },
  {
    id: "administracion",
    nombre: "ADMINISTRACIÓN",
    modulos: [
      { id: "reportes", nombre: "Reportes", modulo: "reportes", permiso: "ver_reportes" },
      { id: "estado_cuenta", nombre: "Estado de Cuenta", modulo: "cuenta_comun", permiso: "ver_estado_cuenta" },
      // Garantías vive aquí y no en operación: quien la usa a diario no es la
      // cajera sino quien gestiona el reclamo.
      { id: "garantias", nombre: "Garantías", modulo: "inventario", permiso: "gestionar_garantias" },
      { id: "supervision", nombre: "Supervisión", modulo: "supervision",
        permiso: ["realizar_visitas_tienda", "administrar_checklist_visitas", "atender_fallas_visita", "ver_supervision"] },
      { id: "cortes_sicar", nombre: "Cortes SICAR", modulo: "admin", permiso: "ver_cortes_sicar" },
      { id: "roles", nombre: "Roles y Personal", modulo: "admin" },
      { id: "respaldos", nombre: "Respaldos", modulo: "respaldos", permiso: "ver_respaldos" },
      { id: "configuracion", nombre: "Configuración", modulo: "pos", permiso: ["editar_configuracion_pos", "activar_pantallas_caja"] },
    ],
  },
];

/**
 * ¿Este rol ve este módulo?
 *
 * Copiado tal cual del Dashboard.jsx anterior, con su lógica de listas intacta:
 * `permiso` acepta una clave O UNA LISTA, y basta tener CUALQUIERA. No es un
 * descuido — hay módulos con varias puertas. A "Objetivos" entra la
 * vendedora (usar_gerente_ventas) y también la jefatura (editar_objetivos_venta).
 * Con una sola clave, un rol que solo tuviera el de jefatura no veía el módulo y
 * le "desaparecía" sin explicación.
 *
 * Los `!usuario?.modulos` / `!usuario?.permisos` son un default permisivo a
 * propósito: si el backend todavía no mandó las listas, más vale mostrar de más
 * que dejar el menú vacío. Las rutas del backend son la defensa de verdad.
 */
export function moduloVisible(m, usuario) {
  const moduloOk = !usuario?.modulos || usuario.modulos.includes(m.modulo);
  const requeridos = m.permiso ? [].concat(m.permiso) : [];
  const permisoOk =
    requeridos.length === 0 ||
    !usuario?.permisos ||
    requeridos.some((clave) => usuario.permisos.includes(clave));
  return moduloOk && permisoOk;
}

/**
 * Las categorías que este rol debe ver, ya sin los módulos que no le tocan y
 * sin las categorías que se quedaron vacías: un encabezado que no lleva a nada
 * solo le enseña al usuario lo que no puede hacer.
 *
 * Devuelve copias. CATEGORIAS no se muta nunca: esto se llama en cada dibujado
 * y una mutación iría vaciando el menú solo.
 */
export function categoriasVisibles(usuario, pantallas) {
  return CATEGORIAS
    .map((c) => ({ ...c, modulos: c.modulos.filter((m) => moduloVisible(m, usuario) && !vistaApagada(m.id, pantallas, usuario)) }))
    .filter((c) => c.modulos.length > 0);
}

// Tienda de MercadoLibre: su corte sigue aunque Corte de Caja esté apagado (spec pantallas-caja 3b).
const SUCURSAL_ML = 5;

/**
 * Si la pantalla `vista` está apagada por el administrador, el aviso a mostrar; si no, null.
 * Solo esconde: el freno de verdad está en el servidor (responde 409 aunque alguien llegue aquí).
 * `pantallas` ausente o una clave ausente = encendida, igual que el servidor.
 */
export function vistaApagada(vista, pantallas, usuario) {
  const modulo = CATEGORIAS.flatMap((c) => c.modulos).find((m) => m.id === vista);
  if (!modulo?.pantalla || !pantallas || pantallas[modulo.pantalla] !== false) return null;
  if (modulo.pantalla === "corte_caja" && (usuario?.ver_todas || Number(usuario?.sucursal_id) === SUCURSAL_ML)) return null;
  return `${modulo.nombre} está desactivada por el administrador.`;
}
