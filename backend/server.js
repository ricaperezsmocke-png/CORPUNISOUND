/**
 * server.js — Backend único para el dashboard:
 *   1. Sirve los datos de los módulos (mismos datos de prueba que ya probamos)
 *   2. Expone /api/chat, que recibe la conversación del dashboard,
 *      llama a Claude con la herramienta consultar_modulo, y regresa
 *      la respuesta final ya redactada.
 *
 * La API key de Anthropic vive SOLO aquí (nunca en el navegador).
 *
 * Uso:
 *   cp .env.example .env    (y pega tu API key real dentro de .env)
 *   npm install
 *   npm start
 */

require("./instrument"); // Sentry: DEBE ser el primer require (auto-instrumenta HTTP/Express).
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Sentry = require("@sentry/node");
const Anthropic = require("@anthropic-ai/sdk");
const { predecirDemanda } = require("./predicciones");
const { parsearReporteVentasSicar, previsualizarHistorialVentas, aplicarHistorialVentas } = require("./historialVentas");
const {
  listarProductos, crearProducto, actualizarProducto, eliminarProducto,
  reactivarProducto, clonarProducto, ajustarExistencia, listarCategorias, crearCategoria,
  listarDepartamentos, crearDepartamento, crearProveedor, generarClave
} = require("./productos");
const { listarClientes, obtenerCliente, crearCliente, actualizarCliente } = require("./clientes");
const {
  listarClientesCRM, obtenerClienteCRM, cambiarEstadoCliente,
  registrarContacto, listarContactos, resumenPorSucursal, rankingVendedores,
  obtenerSeguimientosPostventaPendientes
} = require("./crm");
const { crearVenta, listarVentas, obtenerVentaDetalle, cancelarVenta, cambiarCajaVenta } = require("./ventas");
const { sembrarCajas } = require("./cajas");
const { avisarSiLaEpocaEstaEnElFuturo } = require("./corteEpoca");
const { reconciliarTrasRestaurar } = require("./reconciliarRestauracion");
const {
  crearApartado, registrarAbono, cancelarApartado, listarApartados, obtenerApartadosProximosAVencer,
} = require("./apartados");
const {
  crearGarantia, marcarEnviada, actualizarUbicacion, registrarResolucion,
  recibirEnTienda, entregarACliente, listarGarantias,
} = require("./garantias");
const { agregarGasto, listarGastos, eliminarGasto } = require("./garantiasGastos");
const { obtenerConfiguracion, actualizarConfiguracion, reconciliarPedirVendedor } = require("./configuracion");
const { calcularCorteEnCurso, crearCorte, listarCortes, filtrarCorteEnCursoPorPermiso } = require("./cortes");
const { listarCondiciones, actualizarCondicion } = require("./condicionesPago");
const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");
const { tablero, calcularProgreso, cambiarEstadoTarea, fijarMeta, nuevoEstadoTareasVenta } = require("./gerenteVentas");
const { sugerirMetaConExplicacion } = require("./gerenteVentasIA");
const { listarVendedores, crearVendedor, actualizarVendedor, desactivarVendedor, estaActivo } = require("./vendedores");
const { validarSistemaDePermisos } = require("./validarPermisos");
const { requiereLogin, requierePermiso, requiereAlcanceGlobal, firmarToken, verificarToken, alcanceSucursal, dentroDeAlcance, sucursalDeEscritura, sucursalDelFormulario, validarUbicacionLogin, mensajePorMotivoUbicacion, invalidarSesionesAnterioresA, configurarRevisionDeCuenta } = require("./auth");
const { consultarModulo, tablasConsultables } = require("./consultarModulo");
const { listarRoles, obtenerRol, permisosDeRol, crearRol, actualizarRol, eliminarRol, clonarRol, sembrarRolesIniciales, reconciliarRoles } = require("./roles");
const { sembrarCategoriasGastos } = require("./gastosCategorias");
const { crearGasto, cancelarGasto, listarGastos: listarGastosGasto, movimientosDeGasto } = require("./gastos");
const { listarCategorias: listarCategoriasGasto, crearCategoria: crearCategoriaGasto,
        renombrarCategoria: renombrarCategoriaGasto, desactivarCategoria: desactivarCategoriaGasto,
      } = require("./gastosCategorias");
const { crearDeposito, listarDepositos, cancelarDeposito, adjuntarComprobante } = require("./depositos");
const { estadoCuenta } = require("./estadoCuenta");
const { crearTraspaso, recibirTraspaso, listarTraspasos } = require("./traspasos");
const { crearRecepcion, listarRecepciones, historialCostoProducto } = require("./compras");
const { reconciliarSucursalesCedis } = require("./sucursales");
const { fechaLocal } = require("./fechas");
const { crearRegistroIntentos, estaBloqueado, registrarFallo, registrarExito } = require("./intentosLogin");
const { contarClavesSat, necesitaImportarClavesSat } = require("./clavesSat");
const { importarClavesSat } = require("./scripts/importarClavesSat");
const { parsearExcel, previsualizarImportacion, aplicarImportacion, exportarRespaldo } = require("./migracion");
const { listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, esAccionSobreSiMismo, iniciarSesion, usuariosQueChocanAlNormalizar } = require("./usuarios");
const { armarSesion } = require("./sesion");
const { buscarClavesSat } = require("./clavesSat");
const { parsearFacturaXML } = require("./cfdi");
const { analizarFacturaImagen } = require("./facturaIA");
const {
  intercambiarCodigo, urlAutorizacion, listarPublicaciones,
  publicarProducto, actualizarStockML, actualizarPublicacion,
  listarOrdenes, importarOrdenComoVenta,
} = require("./mercadolibre");
const drive = require("./drive");
const { subirDocumento, listarDocumentos, eliminarDocumento } = require("./documentosPersonal");
const { reporteVentas, reporteUtilidad, reporteCompras, reporteCortesCaja, reporteExistencias, reporteEstadoCuentaClientes, reporteMovimientosCaja, reporteGastosGarantias, reporteGastos } = require("./reportes");
const crypto = require("crypto");
const {
  crearRespaldo, limpiarViejos, verificarRespaldo, copiaParaReverificar, restaurar,
  estadoRespaldos, compararConEstadoActual, claveRestauracionConfigurada,
} = require("./respaldos");
const { llaveDesdeEnv } = require("./respaldoCifrado");
const { debeRespaldar, INTERVALO_REVISION_MS } = require("./respaldoReloj");
const mantenimiento = require("./mantenimiento");
const {
  MOTIVOS_DEMANDA, ESTADOS_DEMANDA, TRANSICIONES_PERMITIDAS,
  normalizarRadarDemanda, crearDemanda: crearDemandaRadar, crearDemandaConCRM,
  listarDemandas, obtenerDemanda, actualizarDemanda,
  agregarSeguimiento, cambiarEstado, obtenerHistorial, obtenerResumen, obtenerAnalisis,
  enriquecerDemanda, enriquecerHistorial, listarVentasCandidatas,
} = require("./radarDemanda");
const { booleanoEstricto } = require("./radar/entrada");
const { obtenerEvidenciaCompras } = require("./radarDemandaInteligencia");
const { clasificarEvidenciaCompra, clasificarProductoNoManejado } = require("./radarDemandaReglas");

// Si la persistencia no carga, en producción se ABORTA el arranque en vez de
// fingir que el sistema funciona. El porqué del criterio está documentado en
// arranquePersistencia.js — resumido: `guardar` quedaba como función vacía y
// cada venta del día se escribía en el vacío, con un console.warn que nadie lee.
const { debeAbortarSinPersistencia, mensajeSinPersistencia } = require("./arranquePersistencia");

let cargar = () => null, guardar = () => {};
try {
  const p = require("./persistencia");
  cargar = p.cargar; guardar = p.guardar;
  console.log("✅ Módulo de persistencia SQLite cargado");
} catch (e) {
  const abortar = debeAbortarSinPersistencia();
  const mensaje = mensajeSinPersistencia(e, abortar);
  if (abortar) {
    console.error(mensaje);
    // `throw` y no `process.exit`: deja el stack de la causa real en el log de
    // Render y no se traga el error si alguien requiere este archivo.
    throw new Error("Arranque cancelado: el sistema no puede guardar nada (persistencia SQLite no disponible)");
  }
  console.warn(mensaje);
}

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || true, // 'true' permite cualquier origen en desarrollo local
}));
// Límite subido de 100kb (default) a 15mb: el catálogo completo de un
// respaldo/importación viaja como Excel en base64 dentro del body JSON,
// igual filosofía que ya usa el importador de factura XML CFDI.
// Límite subido a 50mb: el reporte de ventas histórico de una sucursal
// (años de tickets) puede pesar varios MB en crudo, más al viajar en
// base64 dentro del body JSON — misma filosofía que Migración de Datos.
app.use(express.json({ limit: "50mb" }));

const anthropic = new Anthropic(); // lee ANTHROPIC_API_KEY de .env

// ============================================================
// DATOS DE PRUEBA (mismos que ya validamos en el kit anterior)
// ============================================================
const DB = {
  pos: {
    ventas: [
      { id: 1, fecha: "2026-05-10", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 1200, metodo_pago: "efectivo", estatus: "cerrada" },
      { id: 2, fecha: "2026-05-20", sucursal_id: 2, vendedor_id: 3, cliente_id: 2, total: 800, metodo_pago: "tarjeta", estatus: "cerrada" },
      { id: 3, fecha: "2026-06-05", sucursal_id: 3, vendedor_id: 4, cliente_id: 0, total: 2100, metodo_pago: "efectivo", estatus: "cerrada" },
      { id: 4, fecha: "2026-06-18", sucursal_id: 4, vendedor_id: 5, cliente_id: 0, total: 950, metodo_pago: "efectivo", estatus: "cerrada" },
      { id: 5, fecha: "2026-06-25", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 1750, metodo_pago: "tarjeta", estatus: "cerrada" }
    ],
    venta_detalle: [
      { id: 1, venta_id: 1, producto_id: 1, cantidad: 20, precio_unitario: 25, descuento: 0, subtotal: 500 },
      { id: 2, venta_id: 1, producto_id: 2, cantidad: 40, precio_unitario: 16, descuento: 0, subtotal: 640 },
      { id: 3, venta_id: 2, producto_id: 3, cantidad: 25, precio_unitario: 32, descuento: 0, subtotal: 800 },
      { id: 4, venta_id: 3, producto_id: 1, cantidad: 60, precio_unitario: 25, descuento: 50, subtotal: 1450 },
      { id: 5, venta_id: 3, producto_id: 4, cantidad: 65, precio_unitario: 10, descuento: 0, subtotal: 650 },
      { id: 6, venta_id: 4, producto_id: 2, cantidad: 50, precio_unitario: 16, descuento: 0, subtotal: 800 },
      { id: 7, venta_id: 4, producto_id: 4, cantidad: 15, precio_unitario: 10, descuento: 0, subtotal: 150 },
      { id: 8, venta_id: 5, producto_id: 3, cantidad: 40, precio_unitario: 32, descuento: 30, subtotal: 1250 },
      { id: 9, venta_id: 5, producto_id: 1, cantidad: 20, precio_unitario: 25, descuento: 0, subtotal: 500 }
    ],
    vendedores: [
      { id: 1, nombre: "Ana López", sucursal_id: 1, meta_mensual: 50000 },
      { id: 2, nombre: "Carlos Ruiz", sucursal_id: 1, meta_mensual: 50000 },
      { id: 3, nombre: "María R.", sucursal_id: 2, meta_mensual: 50000 },
      { id: 4, nombre: "Pedro L.", sucursal_id: 3, meta_mensual: 50000 },
      { id: 5, nombre: "Ana G.", sucursal_id: 4, meta_mensual: 50000 }
    ],
    // Tareas sugeridas al vendedor para alcanzar su meta. Ver gerenteVentas.js.
    tareas_venta: { tareas: [], ultimo_id: 0 },
    sucursales: [
      { id: 1, nombre: "Ocosingo", ciudad: "Chiapas", lat: null, lng: null },
      { id: 2, nombre: "Yajalón", ciudad: "Chiapas", lat: null, lng: null },
      { id: 3, nombre: "San Cristóbal", ciudad: "Chiapas", lat: null, lng: null },
      { id: 4, nombre: "Palenque", ciudad: "Chiapas", lat: null, lng: null },
      { id: 5, nombre: "MercadoLibre", ciudad: "Online", sin_ubicacion: true },
      { id: 6, nombre: "CEDIS", ciudad: "Chiapas", sin_ubicacion: true, lat: null, lng: null },
    ],
    condiciones_pago: [],
    configuracion: null,
    cajas: [],
    cortes_caja: [],
    corte_epoca: null,
    apartado_abonos: [],
  },
  crm: {
    clientes: [
      {
        id: 0, clave: "", representante: "Público en General", nombre: "Público en General",
        tipo: "menudeo", rfc: "XAXX010101000", email: "", telefono: "", celular: "",
        sujeto_credito: false, precio_lista: 1, dias_credito: 0, limite_credito: 0,
        monedero: 0, saldo: 0, saldo_vencido: 0, fecha_vencimiento: null,
        fecha_alta: "2025-01-01", vendedor_asignado_id: null, sucursal_id: 1,
        estado: "compro", ultimo_contacto: null, ubicacion: ""
      },
      {
        id: 1, clave: "CLI001", representante: "Abarrotes Mary", nombre: "Abarrotes Mary",
        tipo: "mayoreo", rfc: "XAXX010101000", email: "", telefono: "9191234567", celular: "",
        sujeto_credito: true, precio_lista: 2, dias_credito: 30, limite_credito: 5000,
        monedero: 0, saldo: 0, saldo_vencido: 0, fecha_vencimiento: null,
        fecha_alta: "2025-03-01", vendedor_asignado_id: 1, sucursal_id: 1,
        estado: "compro", ultimo_contacto: "2026-06-05", ubicacion: "Ocosingo, Chiapas"
      },
      {
        id: 2, clave: "CLI002", representante: "Juan Pérez", nombre: "Juan Pérez",
        tipo: "menudeo", rfc: "XAXX010101000", email: "", telefono: "9169876543", celular: "",
        sujeto_credito: false, precio_lista: 1, dias_credito: 0, limite_credito: 0,
        monedero: 0, saldo: 0, saldo_vencido: 0, fecha_vencimiento: null,
        fecha_alta: "2025-06-15", vendedor_asignado_id: 3, sucursal_id: 2,
        estado: "compro", ultimo_contacto: "2026-06-25", ubicacion: "Ocosingo, Chiapas"
      }
    ],
    contactos_cliente: [],
    oportunidades: []
  },
  inventario: {
    existencias: [
      { producto_id: 1, sucursal_id: 1, cantidad_actual: 120, cantidad_minima: 30, cantidad_maxima: 300 },
      { producto_id: 2, sucursal_id: 1, cantidad_actual: 15, cantidad_minima: 40, cantidad_maxima: 400 },
      { producto_id: 3, sucursal_id: 1, cantidad_actual: 60, cantidad_minima: 20, cantidad_maxima: 150 },
      { producto_id: 4, sucursal_id: 1, cantidad_actual: 200, cantidad_minima: 50, cantidad_maxima: 500 },
      { producto_id: 1, sucursal_id: 2, cantidad_actual: 90, cantidad_minima: 30, cantidad_maxima: 300 },
      { producto_id: 2, sucursal_id: 2, cantidad_actual: 110, cantidad_minima: 40, cantidad_maxima: 400 },
      { producto_id: 3, sucursal_id: 3, cantidad_actual: 45, cantidad_minima: 20, cantidad_maxima: 150 },
      { producto_id: 4, sucursal_id: 4, cantidad_actual: 300, cantidad_minima: 50, cantidad_maxima: 500 }
    ],
    movimientos_inventario: [],
    compras: [],
    compra_detalle: [],
    traspasos: [],
    garantias: [],
    garantia_movimientos: [],
    garantia_gastos: [],
  },
  "catalogo-productos": {
    productos: [
      { id: 1, sku: "AB-001", nombre: "Arroz 1kg", categoria_id: 1, proveedor_id: 1, costo: 18, precio_venta: 25, unidad_medida: "pza", activo: true },
      { id: 2, sku: "BE-001", nombre: "Refresco 600ml", categoria_id: 2, proveedor_id: 2, costo: 10, precio_venta: 16, unidad_medida: "pza", activo: true },
      { id: 3, sku: "LI-001", nombre: "Detergente 1L", categoria_id: 3, proveedor_id: 3, costo: 22, precio_venta: 32, unidad_medida: "pza", activo: true },
      { id: 4, sku: "BE-002", nombre: "Agua 1L", categoria_id: 2, proveedor_id: 3, costo: 6, precio_venta: 10, unidad_medida: "pza", activo: true }
    ],
    categorias: [
      { id: 1, nombre: "Abarrotes", categoria_padre_id: null },
      { id: 2, nombre: "Bebidas", categoria_padre_id: null },
      { id: 3, nombre: "Limpieza", categoria_padre_id: null }
    ],
    proveedores: [
      { id: 1, nombre: "Distribuidora del Norte", contacto: "555-111", tiempo_entrega_dias: 5, condiciones_pago: "30 días" },
      { id: 2, nombre: "Importadora Sureste", contacto: "555-222", tiempo_entrega_dias: 10, condiciones_pago: "Contado" },
      { id: 3, nombre: "Proveedor Local Chiapas", contacto: "555-333", tiempo_entrega_dias: 2, condiciones_pago: "15 días" }
    ],
    departamentos: [],
    producto_proveedor: []
  },
  admin: {
    roles: [],
    usuarios: [],
    intentos_bloqueados_ubicacion: [],
    documentos_personal: [],
  },
  ml: {
    cuenta: null,
    publicaciones: [],
    ordenes_importadas: [],
  },
  drive: {
    cuenta: null,
  },
  gastos: {
    gastos: [],
    categorias: [],
    gasto_movimientos: [],
    ultimo_id: 0,
  },
  cuenta_comun: {
    depositos: [],
    deposito_movimientos: [],
    ultimo_id: 0,
  },
  respaldos: {
    copias: [],
    movimientos: [],
    ultimo_id: 0,
    ultimo_exitoso: null,
    ultimo_intento: null,
    carpeta_drive_id: null,
  },
  radar_demanda: {
    registros: [],
    seguimientos: [],
    ultimo_id: 0,
    ultimo_seguimiento_id: 0,
  },
};

sembrarRolesIniciales(DB);

// Restaurar estado guardado en SQLite (si existe)
const estadoGuardado = cargar();
if (estadoGuardado) {
  for (const modulo of Object.keys(DB)) {
    if (estadoGuardado[modulo]) {
      for (const tabla of Object.keys(DB[modulo])) {
        if (estadoGuardado[modulo][tabla] !== undefined) {
          DB[modulo][tabla] = estadoGuardado[modulo][tabla];
        }
      }
    }
  }
  console.log("✅ Datos restaurados desde almacenamiento persistente");
}

// Una base anterior a Radar no trae este módulo; una copia intermedia puede
// traer arreglos sin contadores o registros anteriores con campos faltantes.
// Se preserva lo existente y solo se completan valores defensivos.
normalizarRadarDemanda(DB);

sembrarCategoriasGastos(DB);

// Garantiza que CEDIS (sucursal 6) exista y que 5/6 tengan sin_ubicacion=true,
// tanto si el DB viene del seed fresco como si viene de datos persistidos
// anteriores a esta feature. Ver backend/sucursales.js.
DB.pos.sucursales = reconciliarSucursalesCedis(DB.pos.sucursales);

// Marca de agua de la transición a cortes sellados. Se fija y persiste una
// sola vez: moverla en otro arranque convertiría movimientos nuevos en
// históricos y volvería a abrir huecos en la contabilidad.
if (!DB.pos.corte_epoca) {
  DB.pos.corte_epoca = new Date().toISOString();
  guardar(DB);
}
// Una época en el futuro haría que cada venta, abono y gasto nuevo se tratara
// como histórico, reabriendo los huecos que el sello cierra. No debería poder
// pasar, pero sí puede llegar así al restaurar un respaldo de otra máquina, y
// entonces la contabilidad queda expuesta en silencio. Se grita.
avisarSiLaEpocaEstaEnElFuturo(DB);

// Normaliza bases anteriores y garantiza las dos cajas fijas por sucursal.
// sembrarCajas lanza si los datos no tienen exactamente una predeterminada.
if (!Array.isArray(DB.pos.cajas)) DB.pos.cajas = [];
try {
  sembrarCajas(DB);
} catch (e) {
  console.error("🚨 Error de datos en las cajas: " + e.message);
  throw e;
}

// Garantiza que el rol "Administrador" tenga TODOS los módulos y permisos del
// catálogo actual, aunque venga de un snapshot persistido anterior a módulos
// o permisos nuevos (ml, traspasos, compras...). Los demás roles no se tocan.
// Ver backend/roles.js -> reconciliarRoles.
reconciliarRoles(DB);

// Enciende "solicitar vendedor al cerrar venta" en las bases que ya existen: el
// default nuevo no las alcanza porque la configuración se guarda entera.
// Ver backend/configuracion.js -> reconciliarPedirVendedor.
reconciliarPedirVendedor(DB);

// Las bases que vienen de un SQLite anterior a Gerencia de Ventas no traen la
// colección de tareas. Mismo patrón que reconciliarSucursalesCedis: se repara
// al arrancar en vez de reventar la primera vez que alguien abre la pantalla.
if (!DB.pos.tareas_venta || !Array.isArray(DB.pos.tareas_venta.tareas)) {
  DB.pos.tareas_venta = nuevoEstadoTareasVenta();
}

// Mismo espíritu que el aviso de DB_PATH en persistencia.js: si los respaldos
// NO están funcionando, hay que gritarlo. Creer que hay respaldos y que no los
// haya es el peor final posible.
let LLAVE_RESPALDO = null;
try {
  LLAVE_RESPALDO = llaveDesdeEnv();
} catch (e) {
  console.error("❌ " + e.message);
}
if (!LLAVE_RESPALDO) {
  console.warn("⚠️  RESPALDO_LLAVE no está configurada: EL SISTEMA NO SE ESTÁ RESPALDANDO.");
} else {
  console.log("✅ Respaldos automáticos activos (cada hora, cifrados)");
}
if (!claveRestauracionConfigurada()) {
  console.warn("⚠️  CLAVE_RESTAURACION no está configurada: restaurar está DESHABILITADO.");
}

/** Registro de intentos PROPIO para la clave de restauración: separado del que
 *  cuida el login, para que un ataque contra el botón de restaurar no deje a
 *  nadie fuera de su sesión, ni al revés. */
const intentosRestauracion = crearRegistroIntentos();

// ¿Este proceso ES el servidor, o alguien está REQUIRIENDO server.js?
// Las pruebas hacen `require("./server")` para pegarle a las rutas de verdad
// (ver rutasEscrituraSucursal.test.js). En ese caso solo se exporta la app: no
// se abre el puerto ni se dispara la descarga del catálogo del SAT.
const ESTE_PROCESO_ES_EL_SERVIDOR = require.main === module;

/**
 * El ciclo de respaldo. Revisa cada 5 minutos, respalda si va atrasado.
 *
 * `unref()` para que este temporizador NO impida que el proceso termine: sin
 * eso, Render se quedaría esperando en cada redespliegue.
 *
 * Todo va dentro de try/catch: un respaldo que falla NUNCA debe tumbar el
 * backend ni interrumpir una venta. La tienda siempre puede seguir vendiendo.
 */
/** Guardia de reentrada del ciclo. `debeRespaldar` mira `ultimo_exitoso`, que
 *  solo se actualiza cuando Drive confirma: si una subida tarda más que el
 *  intervalo de revisión (base grande, Drive lento), el siguiente tick disparaba
 *  OTRO respaldo encima, y dos `limpiarViejos` traslapados llegaban a pedirle a
 *  Drive el borrado del mismo archivo dos veces. */
let cicloEnCurso = false;

async function cicloRespaldo() {
  if (!LLAVE_RESPALDO) return;
  // Mientras se restaura, el reloj se calla. Respaldar a media restauración
  // guardaría una foto de un estado que no es ni el viejo ni el nuevo.
  if (mantenimiento.estaActivo()) return;
  if (cicloEnCurso) return;
  cicloEnCurso = true;
  try {
    const veredicto = debeRespaldar(DB.respaldos, Date.now());
    if (veredicto.respaldar) {
      const copia = await crearRespaldo(DB, drive, { tipo: veredicto.tipo, llave: LLAVE_RESPALDO });
      console.log(`💾 Respaldo ${copia.tipo} ${copia.nombre_archivo} (${veredicto.motivo})`);
      // La verificación que de verdad cuenta: se baja de Drive el punto del día
      // y se comprueba. Solo en los "dia" para no duplicar tráfico cada hora.
      if (copia.tipo === "dia") {
        const v = await verificarRespaldo(DB, drive, copia.id, LLAVE_RESPALDO);
        if (!v.ok) console.error("⚠️  Respaldo NO verificado:", v.diferencias.join("; "));
      }
      // Y se revisa UNA copia vieja, la que lleve más tiempo sin comprobarse.
      // Antes una copia solo se verificaba el día que nacía: si alguien vaciaba
      // la carpeta de Drive, el índice seguía mostrando 30 días en verde y nadie
      // se enteraba hasta el día que hacía falta restaurar de verdad.
      const vieja = copiaParaReverificar(DB, copia.id);
      if (vieja) {
        const v = await verificarRespaldo(DB, drive, vieja.id, LLAVE_RESPALDO);
        if (!v.ok) {
          console.error(`⚠️  El respaldo ${vieja.nombre_archivo} YA NO SIRVE:`, v.diferencias.join("; "));
          Sentry.captureMessage(`Respaldo previo ilegible: ${vieja.nombre_archivo}`);
        }
      }
      guardar(DB);
    }
  } catch (e) {
    console.error("⚠️  Falló el ciclo de respaldo:", e.message);
    Sentry.captureException(e);
    try { guardar(DB); } catch (_) {} // conserva la copia marcada "fallido"
  } finally {
    // La retención corre SIEMPRE, haya respaldo nuevo o no, y en su propio
    // try/catch. Antes colgaba del camino feliz: si Drive rechazaba las subidas
    // por falta de espacio, `crearRespaldo` lanzaba y la limpieza no corría nunca
    // — justo cuando hacía falta liberar espacio. Un atasco que se sostenía solo.
    // La verificación de las 3 copias protegidas hace que esto no pueda dejar a
    // nadie sin respaldos.
    try {
      await limpiarViejos(DB, drive, Date.now());
    } catch (e) {
      console.error("⚠️  Falló la limpieza de respaldos viejos:", e.message);
    }
    cicloEnCurso = false;
  }
}

if (ESTE_PROCESO_ES_EL_SERVIDOR) {
  const temporizador = setInterval(cicloRespaldo, INTERVALO_REVISION_MS);
  if (typeof temporizador.unref === "function") temporizador.unref();
  // Un primer intento al arrancar: si el proceso estuvo caído, se pone al
  // corriente ya, sin esperar los 5 minutos.
  setTimeout(cicloRespaldo, 10_000).unref();
}

// Garantiza el catálogo de Claves SAT (búsqueda en pantalla Artículo de Compras).
// En Render, datos.sqlite no viaja con el deploy (está en .gitignore), así que
// el catálogo se pierde en cada reinicio del dyno. Se reimporta solo, en
// segundo plano, sin bloquear el arranque del servidor: mientras tanto la
// búsqueda de Clave SAT simplemente devuelve vacío (ver clavesSat.js).
if (ESTE_PROCESO_ES_EL_SERVIDOR && necesitaImportarClavesSat(contarClavesSat())) {
  console.log("📦 Catálogo de Claves SAT ausente o incompleto — importando en segundo plano...");
  importarClavesSat().then(
    (total) => console.log(`✅ Catálogo de Claves SAT importado: ${total} claves`),
    (e) => console.error("⚠️  No se pudo importar el catálogo de Claves SAT (la búsqueda seguirá vacía hasta el próximo arranque):", e.message)
  );
}

function listarModulosYTablas() {
  // Solo lo que el asistente PUEDE leer. Antes anunciaba todas las tablas del
  // sistema —incluidas `admin.usuarios` y las cuentas de Drive y ML—, así que
  // al modelo se le estaba diciendo dónde estaban las contraseñas.
  return tablasConsultables(DB);
}

// ============================================================
// HERRAMIENTA Y PROMPT PARA LA API DE CLAUDE
// ============================================================
const TOOL = {
  name: "consultar_modulo",
  description: "Consulta datos reales de un módulo (pos, crm, inventario, catalogo-productos). Úsala siempre antes de dar cifras; nunca inventes números.",
  input_schema: {
    type: "object",
    properties: {
      modulo: { type: "string", description: "id del módulo: pos, crm, inventario, catalogo-productos" },
      tabla: { type: "string", description: "nombre de la tabla dentro del módulo" },
      filtros: { type: "object", description: "fecha_inicio, fecha_fin, proveedor_id, categoria_id, vendedor_id, sucursal_id, etc." },
      agrupar_por: { type: "string", description: "campo por el cual agrupar y sumar, ej: vendedor_id, categoria_id, mes" }
    },
    required: ["modulo", "tabla"]
  }
};

const TOOL_PREDICCION = {
  name: "predecir_demanda",
  description:
    "Calcula una predicción de demanda/estacionalidad para un producto o categoría, basada en el historial real de ventas (tendencia + patrón por mes). Úsala cuando pregunten qué conviene tener en stock, qué se vende más en cierta época, o pidan un pronóstico.",
  input_schema: {
    type: "object",
    properties: {
      producto_id: { type: "number", description: "id del producto (opcional si se da categoria_id)" },
      categoria_id: { type: "number", description: "id de la categoría (opcional si se da producto_id)" },
      meses_adelante: { type: "number", description: "cuántos meses hacia adelante predecir (default 3)" }
    }
  }
};

function construirSystemPrompt(alcance, DB) {
  const hoy = new Date();
  const fechaISO = fechaLocal(hoy);
  const diaSemana = hoy.toLocaleDateString("es-MX", { weekday: "long", timeZone: "America/Mexico_City" });

  const sucursales = DB.pos.sucursales.map((s) => `${s.id}=${s.nombre}`).join(", ");
  const alcanceTexto = alcance.verTodas
    ? `Este usuario puede ver TODAS las sucursales (${sucursales}). Cuando le pidan comparar o desglosar por tienda, usa el filtro sucursal_id. Sucursales: ${sucursales}.`
    : `Este usuario SOLO puede ver la sucursal ${alcance.sucursalId} (${DB.pos.sucursales.find((s) => s.id === alcance.sucursalId)?.nombre || "—"}). Aunque pregunte por otra sucursal, tus datos ya vienen limitados a la suya; no inventes datos de otras tiendas y acláralo si insiste.`;

  return `Eres el asistente de inteligencia de negocio del dashboard principal del sistema.

ALCANCE DE SUCURSAL DEL USUARIO: ${alcanceTexto}

FECHA ACTUAL DEL SISTEMA: ${fechaISO} (${diaSemana}). Usa siempre esta fecha real para
interpretar "hoy", "ayer", "esta semana", "este mes", etc. — nunca inventes ni asumas
qué fecha es hoy; si necesitas calcular un rango, hazlo a partir de este valor exacto.

Antes de responder preguntas sobre ventas, inventario, clientes o proveedores, usa la
herramienta consultar_modulo para obtener datos reales; nunca inventes cifras.
Si preguntas por ventas de un periodo específico no devuelven resultados, antes de decir
que no hay ventas, considera consultar sin filtro de fecha o con un rango más amplio
(por ejemplo, los últimos 30 días) para confirmar si el dato existe con otra fecha, y
explícale al usuario qué rango sí tiene datos.
Cuando pregunten por pronósticos, estacionalidad, o qué conviene tener en stock, usa la
herramienta predecir_demanda.
Si el nivel de confianza de una predicción es "baja", acláraselo al usuario en vez de
sonar muy seguro.
Si preguntan por tendencias, agrupa por mes. Desglosa por proveedor, categoría o
vendedor si el usuario no especifica.

Cuando te pidan sugerir una campaña, promoción, o qué ofrecerle a algún cliente o
grupo de clientes, SIEMPRE consulta primero crm.clientes (trae score, segmento,
estado de pipeline y su historial de compras real) y cruza esa información con
catalogo-productos para basar tu sugerencia en datos reales, no genéricos. Prioriza:
- Clientes en segmento "en_riesgo" (llevan 30-90 días sin comprar) — sugiere
  recuperarlos con algo relacionado a su última compra.
- Clientes con alertas activas ("sin_contacto", "pendiente", "riesgo") — señala
  que necesitan seguimiento antes que campaña de venta.
- Cruza qué categorías/productos ha comprado cada cliente para sugerir venta
  cruzada relevante (ej. quien compró guitarra, ofrécele cuerdas o accesorios).
Sé específico: menciona nombres de clientes reales y por qué los sugieres, no
hables en abstracto de "segmentar a tus clientes".

Responde en español, breve y claro, con las cifras en pesos cuando aplique.
Módulos y tablas disponibles: ${JSON.stringify(listarModulosYTablas())}`;
}


// ============================================================
// RUTAS
// ============================================================
const resolverPermisosDeRol = (rolId) => permisosDeRol(DB, rolId);

// Desactivar o borrar una cuenta corta su sesión en la siguiente petición, en
// vez de dejarla viva hasta 12 h. Ver requiereLogin en auth.js.
configurarRevisionDeCuenta((usuarioId) => {
  const cuenta = (DB.admin.usuarios || []).find((u) => u.id === Number(usuarioId));
  if (!cuenta || cuenta.activo === false) return null;
  return { rol_id: cuenta.rol_id };
});

/**
 * Aviso de arranque: Gerencia de Ventas invisible para todo el mundo.
 *
 * `reconciliarRoles` solo reparte permisos nuevos al rol Administrador, a
 * propósito, para no escalar privilegios en silencio. La consecuencia es que
 * tras desplegar este módulo NADIE más lo ve, y desde afuera parece que el
 * despliegue no funcionó. Este mensaje convierte "el módulo no aparece" en una
 * instrucción concreta.
 */
function avisarSiNadieUsaGerenciaDeVentas() {
  const otros = (DB.admin.roles || []).filter((r) => r.nombre !== "Administrador");
  const alguno = otros.some((r) => permisosDeRol(DB, r.id).includes("usar_gerente_ventas"));
  if (otros.length > 0 && !alguno) {
    console.warn(
      "⚠️  Ningún rol distinto de Administrador tiene 'usar_gerente_ventas': " +
      "tus vendedoras NO verán 'Mi Objetivo de Venta'. Dáselo en Roles y Personal → Roles."
    );
  }
}
avisarSiNadieUsaGerenciaDeVentas();
// Atajo usado por las rutas de registro individual (:id) para saber si el
// usuario puede ver TODAS las sucursales o está amarrado a la suya.
const resolverAlcance = (req) => alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));

// Auto-persistencia: guarda el DB después de cada mutación exitosa
app.use((req, res, next) => {
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) return next();
  const jsonOriginal = res.json.bind(res);
  res.json = function (datos) {
    const resultado = jsonOriginal(datos);
    if (res.statusCode < 400) guardar(DB);
    return resultado;
  };
  next();
});

/**
 * Mientras se restaura un respaldo, el sistema no acepta escrituras.
 *
 * Solo se frenan los métodos que MUTAN. Las lecturas siguen pasando a propósito:
 * la propia pantalla de Respaldos necesita consultar el estado para mostrar el
 * aviso, y una cajera que tiene la pantalla abierta debe poder ver por qué no la
 * dejan cobrar, en vez de encontrarse con un sistema que no responde.
 *
 * Esto también cierra el doble clic en "Restaurar": la segunda petición se topa
 * con el bloqueo que puso la primera.
 */
const METODOS_QUE_ESCRIBEN = new Set(["POST", "PUT", "PATCH", "DELETE"]);

app.use((req, res, next) => {
  if (!mantenimiento.estaActivo() || !METODOS_QUE_ESCRIBEN.has(req.method)) return next();
  const info = mantenimiento.estado();
  return res.status(503).json({
    error:
      info.motivo ||
      "El sistema está en mantenimiento. Espera un momento y vuelve a intentar.",
    mantenimiento: true,
  });
});

// Sin la lista de módulos: esta ruta es PÚBLICA (la usa el monitor de Render)
// y estaba entregándole a internet el mapa completo de tablas del sistema.
app.get("/api/salud", (req, res) => res.json({ ok: true }));

// ---------- Radar de Demanda ----------

function responderErrorRadar(res, error) {
  if (error && typeof error.estatus === "number") {
    return res.status(error.estatus).json({ error: error.message });
  }
  const mensaje = error && error.message ? error.message : "Error interno en Radar de Demanda";
  if (mensaje === "Demanda no encontrada") return res.status(404).json({ error: mensaje });
  if (mensaje.startsWith("No se permite cambiar")) return res.status(409).json({ error: mensaje });
  const errorDeDominio = /no es válid|no puede modificarse|no se puede modificar|no encontrado|no encontrada|debe ser|Selecciona|El campo|mayor que cero/.test(mensaje);
  if (errorDeDominio) return res.status(400).json({ error: mensaje });
  Sentry.captureException(error);
  console.error("Error inesperado en Radar de Demanda:", mensaje);
  return res.status(500).json({ error: "Error interno en Radar de Demanda" });
}

function requierePermisoPatchRadar(req, res, next) {
  const terminal = ["CONVERTIDA", "NO_CONVERTIDA", "CANCELADA"].includes(req.body?.estado);
  const permiso = terminal ? "cerrar_demanda" : "dar_seguimiento_demanda";
  return requierePermiso(permiso, resolverPermisosDeRol)(req, res, next);
}

app.get("/api/radar-demanda", requiereLogin, requierePermiso("ver_radar_demanda", resolverPermisosDeRol), (req, res) => {
  try { res.json(listarDemandas(DB, resolverAlcance(req), req.query)); }
  catch (e) { responderErrorRadar(res, e); }
});

app.get("/api/radar-demanda/meta", requiereLogin, requierePermiso("ver_radar_demanda", resolverPermisosDeRol), (req, res) => {
  res.json({
    estados: ESTADOS_DEMANDA,
    motivos: MOTIVOS_DEMANDA,
    transiciones: TRANSICIONES_PERMITIDAS,
  });
});

app.post("/api/radar-demanda", requiereLogin, requierePermiso("registrar_demanda", resolverPermisosDeRol), (req, res) => {
  try {
    if (booleanoEstricto(req.body?.intencion_compra, "intencion_compra") && !resolverPermisosDeRol(req.usuarioToken.rol_id).includes("crear_cliente")) {
      return res.status(403).json({ error: "No tienes permiso para agregar prospectos al CRM." });
    }
    const alcance = resolverAlcance(req);
    // La sucursal viene del alcance resuelto. body.sucursal_id nunca decide
    // dónde guardar, ni siquiera para una cuenta global.
    const sucursalId = sucursalDeEscritura(alcance, null);
    if (!sucursalId) {
      return res.status(400).json({ error: "Elige una sucursal en el encabezado antes de registrar la demanda." });
    }
    const registrar = req.body?.intencion_compra ? crearDemandaConCRM : crearDemandaRadar;
    res.json(registrar(DB, req.body || {}, {
      usuarioId: req.usuarioToken.id,
      sucursalId,
    }));
  } catch (e) { responderErrorRadar(res, e); }
});

app.get("/api/radar-demanda/resumen", requiereLogin, requierePermiso("ver_resumen_demanda", resolverPermisosDeRol), (req, res) => {
  try { res.json(obtenerResumen(DB, resolverAlcance(req))); }
  catch (e) { responderErrorRadar(res, e); }
});

app.get("/api/radar-demanda/analisis", requiereLogin, requierePermiso("ver_resumen_demanda", resolverPermisosDeRol), (req, res) => {
  try { res.json(obtenerAnalisis(DB, resolverAlcance(req), req.query)); }
  catch (e) { responderErrorRadar(res, e); }
});

const ORDEN_INTELIGENCIA = Object.freeze({
  REVISAR_TRASPASO: 0,
  REVISAR_COMPRA: 1,
  OBSERVAR: 2,
  EVIDENCIA_INSUFICIENTE: 3,
});

function comprasHistoricasSeguras(comprasHistoricas, puedeVerCostos) {
  if (puedeVerCostos) return { ...(comprasHistoricas || {}) };
  const {
    ultimo_costo: _ultimoCosto,
    costo_promedio_historico_ponderado: _costoPromedio,
    ...sinCostos
  } = comprasHistoricas || {};
  return sinCostos;
}

function compararOportunidadesInteligencia(a, b) {
  const porClasificacion = (ORDEN_INTELIGENCIA[a.clasificacion] ?? 99)
    - (ORDEN_INTELIGENCIA[b.clasificacion] ?? 99);
  if (porClasificacion) return porClasificacion;
  const ceroA = Number(a.inventario?.cantidad_actual) <= 0 ? 0 : 1;
  const ceroB = Number(b.inventario?.cantidad_actual) <= 0 ? 0 : 1;
  if (ceroA !== ceroB) return ceroA - ceroB;
  const radarA = a.radar?.["30d"] || {};
  const radarB = b.radar?.["30d"] || {};
  if ((Number(radarA.solicitudes) || 0) !== (Number(radarB.solicitudes) || 0)) {
    return (Number(radarB.solicitudes) || 0) - (Number(radarA.solicitudes) || 0);
  }
  if ((Number(radarA.contactos_distintos) || 0) !== (Number(radarB.contactos_distintos) || 0)) {
    return (Number(radarB.contactos_distintos) || 0) - (Number(radarA.contactos_distintos) || 0);
  }
  if ((Number(a.ventas?.unidades_30d) || 0) !== (Number(b.ventas?.unidades_30d) || 0)) {
    return (Number(b.ventas?.unidades_30d) || 0) - (Number(a.ventas?.unidades_30d) || 0);
  }
  return String(radarB.ultima_solicitud || "").localeCompare(String(radarA.ultima_solicitud || ""));
}

function proyectarInteligenciaCompras(evidencia, puedeVerCostos) {
  const resumen = {
    revisar_traspaso: 0,
    revisar_compra: 0,
    observar: 0,
    evidencia_insuficiente: 0,
    evaluar_incorporacion: 0,
  };
  const claveResumen = {
    REVISAR_TRASPASO: "revisar_traspaso",
    REVISAR_COMPRA: "revisar_compra",
    OBSERVAR: "observar",
    EVIDENCIA_INSUFICIENTE: "evidencia_insuficiente",
  };

  const oportunidades = evidencia.productos.map((expediente) => {
    const decision = clasificarEvidenciaCompra(expediente);
    resumen[claveResumen[decision.clasificacion]] += 1;
    return {
      producto: expediente.producto,
      sucursal: expediente.sucursal,
      clasificacion: decision.clasificacion,
      razones: decision.razones,
      advertencias: decision.advertencias,
      radar: expediente.radar,
      ventas: expediente.ventas,
      inventario: expediente.inventario,
      otras_sucursales: expediente.otras_sucursales,
      traspasos: expediente.traspasos,
      compras_historicas: comprasHistoricasSeguras(expediente.compras_historicas, puedeVerCostos),
      proveedores: expediente.proveedores,
      calidad_datos: decision.calidad_datos,
    };
  }).sort(compararOportunidadesInteligencia);

  const productosNoManejados = evidencia.productos_no_manejados.map((producto) => {
    const decision = clasificarProductoNoManejado(producto);
    if (decision.estado === "EVALUAR_INCORPORACION") resumen.evaluar_incorporacion += 1;
    else resumen.observar += 1;
    return {
      ...producto,
      clasificacion: decision.estado,
      razones: decision.razones,
      advertencias: decision.advertencias,
    };
  });

  return {
    periodo: evidencia.periodo,
    resumen,
    oportunidades,
    productos_no_manejados: productosNoManejados,
    capacidades: evidencia.capacidades,
  };
}

app.get("/api/radar-demanda/inteligencia", requiereLogin, requierePermiso("ver_resumen_demanda", resolverPermisosDeRol), (req, res) => {
  try {
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    const evidencia = obtenerEvidenciaCompras(DB, resolverAlcance(req), { fecha_fin: req.query.fecha_fin });
    res.json(proyectarInteligenciaCompras(evidencia, permisos.includes("ver_reportes")));
  } catch (e) {
    responderErrorRadar(res, e);
  }
});

app.get("/api/radar-demanda/:id/ventas-candidatas", requiereLogin, requierePermiso("cerrar_demanda", resolverPermisosDeRol), (req, res) => {
  try {
    const demanda = obtenerDemanda(DB, req.params.id, resolverAlcance(req));
    res.json(listarVentasCandidatas(DB, demanda, req.query));
  } catch (e) { responderErrorRadar(res, e); }
});

app.get("/api/radar-demanda/:id", requiereLogin, requierePermiso("ver_radar_demanda", resolverPermisosDeRol), (req, res) => {
  try {
    const demanda = obtenerDemanda(DB, req.params.id, resolverAlcance(req));
    res.json(enriquecerDemanda(DB, demanda));
  }
  catch (e) { responderErrorRadar(res, e); }
});

app.patch("/api/radar-demanda/:id", requiereLogin, requierePermisoPatchRadar, (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "estado")) {
      const permitidos = new Set(["estado", "comentario", "venta_recuperada_id"]);
      const inesperado = Object.keys(req.body).find((campo) => !permitidos.has(campo));
      if (inesperado) return res.status(400).json({ error: `El campo ${inesperado} no corresponde a un cambio de estado` });
      return res.json(cambiarEstado(DB, req.params.id, req.body.estado, {
        comentario: req.body.comentario,
        venta_recuperada_id: req.body.venta_recuperada_id,
      }, alcance, req.usuarioToken.id));
    }
    res.json(actualizarDemanda(DB, req.params.id, req.body || {}, alcance));
  } catch (e) { responderErrorRadar(res, e); }
});

app.post("/api/radar-demanda/:id/seguimientos", requiereLogin, requierePermiso("dar_seguimiento_demanda", resolverPermisosDeRol), (req, res) => {
  try {
    res.json(agregarSeguimiento(
      DB, req.params.id, req.body || {}, resolverAlcance(req), req.usuarioToken.id
    ));
  } catch (e) { responderErrorRadar(res, e); }
});

app.get("/api/radar-demanda/:id/historial", requiereLogin, requierePermiso("ver_radar_demanda", resolverPermisosDeRol), (req, res) => {
  try {
    const historial = obtenerHistorial(DB, req.params.id, resolverAlcance(req));
    res.json(enriquecerHistorial(DB, historial));
  }
  catch (e) { responderErrorRadar(res, e); }
});

app.get("/api/predicciones", requiereLogin, requierePermiso("ver_predicciones", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { producto_id, categoria_id, meses_adelante } = req.query;
  // Para el amarrado, se predice solo sobre las ventas (y el historial
  // importado) de su sucursal.
  const DBScope = alcance.verTodas
    ? DB
    : {
        ...DB,
        pos: {
          ...DB.pos,
          ventas: DB.pos.ventas.filter((v) => Number(v.sucursal_id) === alcance.sucursalId),
          historial_ventas_mensual: (DB.pos.historial_ventas_mensual || []).filter((h) => Number(h.sucursal_id) === alcance.sucursalId),
        },
      };
  const resultado = predecirDemanda(DBScope, {
    producto_id: producto_id ? Number(producto_id) : undefined,
    categoria_id: categoria_id ? Number(categoria_id) : undefined,
    meses_adelante: meses_adelante ? Number(meses_adelante) : undefined
  });
  res.json(resultado);
});

app.post("/api/predicciones/historial/previsualizar", requiereLogin, requierePermiso("ver_predicciones", resolverPermisosDeRol), (req, res) => {
  try {
    const { archivo_base64 } = req.body;
    const csvTexto = Buffer.from(archivo_base64, "base64").toString("utf8");
    const { agregados, resumen } = parsearReporteVentasSicar(csvTexto);
    const previsualizacion = previsualizarHistorialVentas(DB, agregados);
    res.json({ ...resumen, ...previsualizacion, agregados });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/predicciones/historial/aplicar", requiereLogin, requierePermiso("ver_predicciones", resolverPermisosDeRol), (req, res) => {
  try {
    const { agregados } = req.body;
    if (!Array.isArray(agregados) || agregados.length === 0) {
      return res.status(400).json({ error: "No hay datos previsualizados para aplicar" });
    }
    // La sucursal la manda ESTE formulario y tiene que ganar siempre — ver el
    // porqué completo en sucursalDelFormulario (backend/auth.js): usar
    // alcanceSucursal() aquí dejaría que el selector del encabezado pisara la
    // sucursal de origen que el usuario eligió en la pantalla.
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    const sucursal_id = sucursalDelFormulario(permisos, req.usuarioToken, req.body.sucursal_id);
    if (!sucursal_id) return res.status(400).json({ error: "Selecciona la sucursal de origen del archivo" });
    const resultado = aplicarHistorialVentas(DB, agregados, sucursal_id);
    res.json(resultado);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Catálogo de productos / inventario (CRUD real) ----------
app.get("/api/productos", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  // Amarrado o global-con-sucursal: existencia de esa sucursal. Global "todas": suma (null).
  const sucursalId = alcance.verTodas ? null : alcance.sucursalId;
  // Los inactivos se piden a propósito y solo los usa el catálogo (su casilla
  // "ver inactivos"). El default los esconde para TODAS las demás pantallas —
  // caja, traspasos, garantías, recepción de compras, MercadoLibre y
  // predicciones leen esta misma ruta, y ninguna debe ofrecer un producto que
  // se dio de baja.
  const incluirInactivos = req.query.incluir_inactivos === "1";
  res.json(listarProductos(DB, sucursalId, { incluirInactivos }));
});

app.post("/api/productos", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try {
    const permisosDeQuienPregunta = resolverPermisosDeRol(req.usuarioToken.rol_id);
    const alcance = alcanceSucursal(req, permisosDeQuienPregunta);
    const sucursal_id = sucursalDeEscritura(alcance, req.body.sucursal_id);
    if (!sucursal_id) {
      return res.status(400).json({ error: "Elige una sucursal en el encabezado antes de dar de alta un producto — su existencia inicial tiene que quedar en una tienda." });
    }
    res.json(crearProducto(DB, req.body, sucursal_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/productos/:id", requiereLogin, requierePermiso("editar_producto", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = sucursalDeEscritura(alcance, req.body.sucursal_id);
    // El único cliente de esta ruta es el formulario de Inventario ▸ Productos
    // (src/InventarioProductos.jsx), que SIEMPRE manda existencia mínima y
    // máxima, y esas dos son de una tienda concreta (antes se caían a la 1 y
    // cambiaban los mínimos de otra sucursal). La Recepción de Compras no pasa
    // por aquí: llama a actualizarProducto() dentro del proceso, con la
    // sucursal ya resuelta (ver backend/compras.js).
    if (!sucursal_id) {
      return res.status(400).json({ error: "Elige una sucursal en el encabezado antes de editar un producto — su existencia mínima y máxima son distintas en cada tienda." });
    }
    res.json(actualizarProducto(DB, req.params.id, req.body, sucursal_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Borrar un producto NO es una operación de sucursal: eliminarProducto() lo
// saca del catálogo global y borra sus existencias en TODAS las tiendas
// (productos.js filtra solo por producto_id). Por eso, además del permiso,
// exige alcance global: un rol amarrado a una tienda al que alguien le
// conceda "eliminar_producto" desde la pantalla de roles no puede arrasar el
// inventario de sucursales que ni siquiera puede ver.
//
// La respuesta dice cuál de las dos cosas pasó (borrado real o desactivación)
// porque no son lo mismo para quien lo pidió: si se desactivó, el producto
// sigue en el catálogo y hay que decírselo, no dejarlo creer que desapareció.
app.delete("/api/productos/:id", requiereLogin, requierePermiso("eliminar_producto", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), (req, res) => {
  try { res.json({ ok: true, ...eliminarProducto(DB, req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Reactivar pide el mismo permiso y el mismo alcance global que desactivar:
// devolver un producto a la caja de las 6 tiendas es tan global como quitarlo.
app.post("/api/productos/:id/reactivar", requiereLogin, requierePermiso("eliminar_producto", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), (req, res) => {
  try { res.json(reactivarProducto(DB, req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/productos/:id/clonar", requiereLogin, requierePermiso("clonar_producto", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = sucursalDeEscritura(alcance, req.body.sucursal_id);
    if (!sucursal_id) {
      return res.status(400).json({ error: "Elige una sucursal en el encabezado antes de clonar un producto — la copia se da de alta en una tienda." });
    }
    res.json(clonarProducto(DB, req.params.id, sucursal_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/productos/:id/ajustar", requiereLogin, requierePermiso("ajustar_existencia", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    // Amarrado: su sucursal del token, sin importar el body. Global: la del encabezado.
    const sucursal_id = sucursalDeEscritura(alcance, req.body.sucursal_id);
    if (!sucursal_id) {
      return res.status(400).json({ error: "Elige una sucursal en el encabezado antes de ajustar la existencia — con \"Todas\" la lista muestra la suma de todas las tiendas y el ajuste no sabría a cuál aplicarse." });
    }
    res.json(ajustarExistencia(DB, req.params.id, { ...req.body, sucursal_id }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/productos/generar-clave", (req, res) => res.json({ clave: generarClave() }));

// ---------- Traspasos entre sucursales ----------
app.get("/api/traspasos", requiereLogin, requierePermiso("realizar_traspasos", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarTraspasos(DB, alcance, req.query.estatus));
});

app.post("/api/traspasos", requiereLogin, requierePermiso("realizar_traspasos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    // Esta pantalla manda la sucursal de origen en el cuerpo y llama con
    // ?sucursal_id=todas justo para que gane la del formulario.
    const sucursal_origen_id = sucursalDeEscritura(alcance, req.body.sucursal_origen_id);
    if (!sucursal_origen_id) {
      return res.status(400).json({ error: "Elige la sucursal de donde sale la mercancía antes de enviar el traspaso." });
    }
    res.json(crearTraspaso(DB, req.body, sucursal_origen_id, req.usuarioToken));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/traspasos/:id/recibir", requiereLogin, requierePermiso("realizar_traspasos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const traspaso = DB.inventario.traspasos.find((t) => t.id === Number(req.params.id));
    // Usuario global: confirma en nombre de la sucursal destino real del traspaso (no necesita elegirla).
    const sucursal_id = alcance.verTodas ? (traspaso ? traspaso.sucursal_destino_id : null) : alcance.sucursalId;
    res.json(recibirTraspaso(DB, req.params.id, req.body, sucursal_id, req.usuarioToken));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/compras", requiereLogin, requierePermiso("recibir_compra", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarRecepciones(DB, alcance));
});

app.post("/api/compras", requiereLogin, requierePermiso("recibir_compra", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = sucursalDeEscritura(alcance, req.body.sucursal_id);
    if (!sucursal_id) {
      return res.status(400).json({ error: "Elige la sucursal que recibe la mercancía antes de guardar la recepción." });
    }
    res.json(crearRecepcion(DB, req.body, sucursal_id, req.usuarioToken));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/compras/importar-xml", requiereLogin, requierePermiso("recibir_compra", resolverPermisosDeRol), (req, res) => {
  try {
    res.json(parsearFacturaXML(req.body.xml));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/compras/importar-ia", requiereLogin, requierePermiso("recibir_compra", resolverPermisosDeRol), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Falta configurar ANTHROPIC_API_KEY en el archivo .env del backend" });
    }
    const { archivo_base64, tipo_mime } = req.body;
    if (!["application/pdf", "image/jpeg", "image/png"].includes(tipo_mime)) {
      throw new Error("Tipo de archivo no permitido — solo PDF, JPG o PNG");
    }
    const tamanoBytes = Buffer.from(archivo_base64, "base64").length;
    if (tamanoBytes > 10 * 1024 * 1024) throw new Error("El archivo no puede pesar más de 10 MB");
    const resultado = await analizarFacturaImagen(anthropic, archivo_base64, tipo_mime);
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/migracion/previsualizar", requiereLogin, requierePermiso("migrar_datos", resolverPermisosDeRol), (req, res) => {
  try {
    const { tipo, archivo_base64 } = req.body;
    // Mismo cálculo de sucursal_id que /api/migracion/aplicar (ver más abajo):
    // la previsualización debe reflejar EXACTAMENTE el mismo matching que
    // hará aplicar, o podrían mostrarle a Victor "actualización" y terminar
    // aplicando una "alta" (o viceversa) — ver hallazgo de revisión de rama
    // completa sobre matching de clientes por clave+sucursal.
    //
    // Gana SIEMPRE la "Sucursal de origen del archivo" que se elige en esta
    // pantalla, nunca el selector del encabezado — ver el porqué completo en
    // sucursalDelFormulario (backend/auth.js). Antes esta ruta usaba
    // alcanceSucursal(), así que con una tienda elegida arriba el Excel de una
    // sucursal se importaba a otra sin ninguna señal.
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    let sucursal_id = null;
    if (tipo === "articulos" || tipo === "clientes") {
      sucursal_id = sucursalDelFormulario(permisos, req.usuarioToken, req.body.sucursal_id);
      if (!sucursal_id) return res.status(400).json({ error: "Selecciona la sucursal de origen del archivo" });
    }
    const { filas, columnas_reconocidas, columnas_no_reconocidas } = parsearExcel(archivo_base64, tipo);
    const previsualizacion = previsualizarImportacion(DB, tipo, filas, sucursal_id);
    res.json({ ...previsualizacion, columnas_reconocidas, columnas_no_reconocidas });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/migracion/aplicar", requiereLogin, requierePermiso("migrar_datos", resolverPermisosDeRol), (req, res) => {
  try {
    const { tipo, filas, defaults, nombre_archivo } = req.body;
    // Igual que en previsualizar: manda la sucursal elegida en ESTA pantalla,
    // no la del encabezado (ver sucursalDelFormulario en backend/auth.js).
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    let sucursal_id = null;
    if (tipo === "articulos" || tipo === "clientes") {
      sucursal_id = sucursalDelFormulario(permisos, req.usuarioToken, req.body.sucursal_id);
      if (!sucursal_id) return res.status(400).json({ error: "Selecciona la sucursal de origen del archivo" });
    }
    const resumen = aplicarImportacion(DB, tipo, filas, sucursal_id, defaults, nombre_archivo);
    res.json(resumen);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/migracion/exportar", requiereLogin, requierePermiso("migrar_datos", resolverPermisosDeRol), (req, res) => {
  try {
    const { tipo } = req.query;
    // La misma pantalla de Migración elige aquí la sucursal a exportar, así
    // que vale lo mismo que en previsualizar/aplicar: gana el selector de la
    // pantalla. Si no, el respaldo se descargaría con los datos de la tienda
    // del encabezado y el nombre del archivo diría otra cosa.
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    let sucursal_id = null;
    if (tipo === "articulos" || tipo === "clientes") {
      sucursal_id = sucursalDelFormulario(permisos, req.usuarioToken, req.query.sucursal_id);
      if (!sucursal_id) return res.status(400).json({ error: "Selecciona la sucursal a exportar" });
    }
    const base64 = exportarRespaldo(DB, tipo, sucursal_id);
    res.setHeader("Content-Disposition", `attachment; filename="respaldo-${tipo}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(Buffer.from(base64, "base64"));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/productos/:id/historial-costo", requiereLogin, requierePermiso("recibir_compra", resolverPermisosDeRol), (req, res) => {
  res.json(historialCostoProducto(DB, req.params.id));
});

app.get("/api/categorias", (req, res) => res.json(listarCategorias(DB)));
app.post("/api/categorias", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearCategoria(DB, req.body.nombre)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/proveedores", (req, res) => res.json(DB["catalogo-productos"].proveedores));
app.post("/api/proveedores", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearProveedor(DB, req.body.nombre, req.body.rfc)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/sat/claves", requiereLogin, (req, res) => {
  res.json(buscarClavesSat(req.query.q, req.query.pagina));
});

app.get("/api/departamentos", (req, res) => res.json(listarDepartamentos(DB)));
app.post("/api/departamentos", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearDepartamento(DB, req.body.nombre)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Autenticación ----------

app.get("/api/auth/necesita-setup", (req, res) => res.json({ necesitaSetup: DB.admin.usuarios.length === 0 }));

app.post("/api/auth/setup-inicial", async (req, res) => {
  try {
    if (DB.admin.usuarios.length > 0) return res.status(400).json({ error: "Ya existe personal registrado; usa el login normal." });
    const rolAdmin = DB.admin.roles.find((r) => r.nombre === "Administrador");
    const nuevo = await crearUsuario(DB, { ...req.body, rol_id: rolAdmin.id, sucursal_id: 1 });
    res.json(nuevo);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Contador de intentos fallidos de login, en memoria (ver intentosLogin.js).
const intentosLogin = crearRegistroIntentos();

app.post("/api/auth/login", async (req, res) => {
  try {
    const { usuario, password, sucursal_id_seleccionada, lat, lng } = req.body;

    // Freno a la fuerza bruta: si la cuenta acumuló demasiados fallos, se
    // rechaza ANTES de tocar la contraseña, hasta que pase el bloqueo.
    const bloqueo = estaBloqueado(intentosLogin, usuario);
    if (bloqueo.bloqueado) {
      const minutos = Math.ceil(bloqueo.restanteMs / 60000);
      return res.status(429).json({ error: `Demasiados intentos fallidos. Espera ${minutos} min e intenta de nuevo.` });
    }

    let encontrado;
    try {
      encontrado = await iniciarSesion(DB, usuario, password);
    } catch (e) {
      // Usuario o contraseña incorrectos: cuenta el fallo y devuelve 401.
      registrarFallo(intentosLogin, usuario);
      return res.status(401).json({ error: e.message });
    }
    // Contraseña correcta: se limpia el contador (un fallo de GPS más abajo NO
    // cuenta como intento de contraseña, así que no debe sumar al bloqueo).
    registrarExito(intentosLogin, usuario);
    const resultado = validarUbicacionLogin(encontrado, sucursal_id_seleccionada, lat, lng, DB);
    if (!resultado.ok) {
      const sucursalDijo = DB.pos.sucursales.find((s) => s.id === Number(sucursal_id_seleccionada));
      const nuevoId = DB.admin.intentos_bloqueados_ubicacion.length
        ? Math.max(...DB.admin.intentos_bloqueados_ubicacion.map((i) => i.id)) + 1
        : 1;
      DB.admin.intentos_bloqueados_ubicacion.push({
        id: nuevoId,
        usuario: encontrado.usuario,
        sucursal_dijo_id: sucursal_id_seleccionada != null && sucursal_id_seleccionada !== "" ? Number(sucursal_id_seleccionada) : null,
        sucursal_dijo_nombre: sucursalDijo ? sucursalDijo.nombre : "—",
        sucursal_real_id: encontrado.sucursal_id,
        lat_detectada: lat != null ? Number(lat) : null,
        lng_detectada: lng != null ? Number(lng) : null,
        distancia_metros: resultado.distancia != null ? Math.round(resultado.distancia) : null,
        motivo: resultado.motivo,
        fecha: new Date().toISOString(),
      });
      guardar(DB);
      return res.status(401).json({ error: mensajePorMotivoUbicacion(resultado.motivo), motivo: resultado.motivo });
    }
    const token = firmarToken(encontrado);
    res.json({ token, usuario: armarSesion(DB, encontrado) });
  } catch (e) { res.status(401).json({ error: e.message }); }
});

app.get("/api/auth/yo", requiereLogin, (req, res) => {
  try {
    const usuario = DB.admin.usuarios.find((u) => u.id === req.usuarioToken.id);
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(armarSesion(DB, usuario));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Catálogo de permisos y módulos (para pintar la pantalla de Roles) ----------
app.get("/api/permisos-catalogo", (req, res) => res.json({ permisos: listarPermisos(), modulos: listarModulosSistema() }));

// ---------- Roles ----------
app.get("/api/roles", (req, res) => res.json(listarRoles(DB)));
app.post("/api/roles", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearRol(DB, req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
// Los roles son configuración del sistema entero, no de una tienda: quien
// edita un rol cambia lo que pueden hacer usuarios de todas las sucursales.
app.put("/api/roles/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), (req, res) => {
  try { res.json(actualizarRol(DB, req.params.id, req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/roles/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), (req, res) => {
  try { eliminarRol(DB, req.params.id); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/roles/:id/clonar", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), (req, res) => {
  try { res.json(clonarRol(DB, req.params.id, req.body.nombre)); } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Usuarios / personal ----------
app.get("/api/usuarios", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => res.json(listarUsuarios(DB)));
// El botón "Dar de alta personal" está gateado con dar_alta_personal en el
// frontend (AdminRoles.jsx); la ruta debe exigir la MISMA clave que el botón.
app.post("/api/usuarios", requiereLogin, requierePermiso("dar_alta_personal", resolverPermisosDeRol), async (req, res) => {
  try { res.json(await crearUsuario(DB, req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
// Administrar personal es configuración del sistema, no de una tienda: aquí se
// asigna el rol y la sucursal de cada cuenta. Mismo criterio que /roles/:id.
app.put("/api/usuarios/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), async (req, res) => {
  try {
    if (req.body.activo !== undefined && !req.body.activo && esAccionSobreSiMismo(req.params.id, req.usuarioToken.id)) {
      throw new Error("No puedes desactivarte a ti mismo mientras tienes la sesión abierta");
    }
    res.json(await actualizarUsuario(DB, req.params.id, req.body));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/usuarios/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), (req, res) => {
  try {
    if (esAccionSobreSiMismo(req.params.id, req.usuarioToken.id)) {
      throw new Error("No puedes eliminarte a ti mismo mientras tienes la sesión abierta");
    }
    res.json(eliminarUsuario(DB, req.params.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Expedientes de Personal (Google Drive) ----------

/**
 * Guard de las rutas de expediente: el empleado del :id debe caer dentro del
 * alcance de quien pregunta.
 *
 * Esto NO es defensa hipotética. "gestionar_expedientes" lo tiene el Gerente
 * de sucursal (roles.js solo le quita cuatro permisos y éste no es uno) y ese
 * rol NO tiene "ver_todas_las_sucursales". Sin este guard, el gerente de una
 * tienda lista, sube y BORRA los documentos personales —identificaciones,
 * contratos— de empleados de otras tiendas, que ni siquiera puede ver en el
 * resto del sistema.
 *
 * Responde 404 y no 403, igual que dentroDeAlcance en el resto de rutas por
 * :id: un 403 confirmaría que esa persona existe en otra sucursal.
 *
 * @returns el empleado si está en alcance, o null habiendo YA respondido.
 */
function empleadoEnAlcance(req, res) {
  // OJO: NO usa resolverAlcance(). Ese mira ?sucursal_id=, que apiFetch inyecta
  // desde el SELECTOR DEL ENCABEZADO (src/api.js) — y ese selector nació para
  // FILTRAR listas, no para decidir a quién se tiene derecho a alcanzar.
  // Usándolo, un administrador con el encabezado puesto en Ocosingo veía al
  // empleado de Yajalón en la lista de personal (GET /api/usuarios no filtra
  // por sucursal) y al abrir su expediente recibía "Usuario no encontrado".
  // El alcance de una PERSONA depende solo de quién pregunta: su permiso y la
  // sucursal de su token.
  const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
  const alcance = Array.isArray(permisos) && permisos.includes("ver_todas_las_sucursales")
    ? { verTodas: true, sucursalId: null }
    : { verTodas: false, sucursalId: Number(req.usuarioToken.sucursal_id) };
  const empleado = DB.admin.usuarios.find((u) => u.id === Number(req.params.id));
  if (!empleado || !dentroDeAlcance(empleado.sucursal_id, alcance)) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return null;
  }
  return empleado;
}

app.get("/api/drive/estado", requiereLogin, async (req, res) => {
  const configurado = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  try {
    // Prueba que el token SIRVA (lo refresca si hace falta), no solo que exista.
    const estado = await drive.verificarConexion(DB);
    if (estado.refrescado) guardar(DB); // persiste el access_token recién refrescado
    res.json({ conectado: estado.conectado, configurado, conectado_en: estado.conectado_en });
  } catch (e) {
    res.json({ conectado: false, configurado, conectado_en: DB.drive.cuenta?.conectado_en || null });
  }
});

app.get("/api/drive/auth-url", requiereLogin, requierePermiso("conectar_cuenta_drive", resolverPermisosDeRol), (req, res) => {
  try {
    const redirect = process.env.GOOGLE_REDIRECT_URI ||
      `${req.protocol}://${req.get("host")}/api/drive/callback`;
    res.json({ url: drive.urlAutorizacion(redirect) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/drive/callback", async (req, res) => {
  const { code } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  if (!code) return res.redirect(`${frontendUrl}?drive=error&msg=sin_codigo`);
  const redirect = process.env.GOOGLE_REDIRECT_URI ||
    `${req.protocol}://${req.get("host")}/api/drive/callback`;
  try {
    await drive.intercambiarCodigo(DB, code, redirect);
    guardar(DB);
    res.redirect(`${frontendUrl}?drive=conectado`);
  } catch (e) {
    res.redirect(`${frontendUrl}?drive=error&msg=${encodeURIComponent(e.message)}`);
  }
});

app.post("/api/usuarios/:id/documentos", requiereLogin, requierePermiso("gestionar_expedientes", resolverPermisosDeRol), async (req, res) => {
  try {
    if (!empleadoEnAlcance(req, res)) return;
    if (!DB.drive.cuenta) throw new Error("Conecta Google Drive primero");
    res.json(await subirDocumento(DB, req.params.id, req.body, req.usuarioToken.id, drive));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/usuarios/:id/documentos", requiereLogin, requierePermiso("gestionar_expedientes", resolverPermisosDeRol), (req, res) => {
  if (!empleadoEnAlcance(req, res)) return;
  res.json(listarDocumentos(DB, req.params.id));
});

app.delete("/api/usuarios/:id/documentos/:documentoId", requiereLogin, requierePermiso("gestionar_expedientes", resolverPermisosDeRol), async (req, res) => {
  try {
    if (!empleadoEnAlcance(req, res)) return;
    if (!DB.drive.cuenta) throw new Error("Conecta Google Drive primero");
    res.json(await eliminarDocumento(DB, req.params.id, req.params.documentoId, drive));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Clientes ----------
app.get("/api/clientes", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarClientes(DB, alcance));
});
app.get("/api/clientes/:id", requiereLogin, (req, res) => {
  try {
    const cliente = obtenerCliente(DB, req.params.id);
    const alcance = resolverAlcance(req);
    // "Público en General" (id 0) es compartido: visible en toda sucursal.
    if (cliente.id !== 0 && !dentroDeAlcance(cliente.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    res.json(cliente);
  } catch (e) { res.status(404).json({ error: e.message }); }
});
app.post("/api/clientes", requiereLogin, requierePermiso("crear_cliente", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    // El alta de cliente llega desde dos pantallas distintas:
    //  - CRM, que tiene su propio <select> de Sucursal (opcional) y llama con
    //    ?sucursal_id=todas cuando viene lleno, para que gane el formulario.
    //  - Punto de Venta, que no pregunta nada y depende del encabezado.
    // Por eso vale cualquiera de las dos: la del formulario o la del
    // encabezado. Solo se rechaza cuando no hay NINGUNA, que es justo el caso
    // que antes se iba en silencio a la sucursal 1.
    const sucursal_id = sucursalDeEscritura(alcance, req.body.sucursal_id);
    if (!sucursal_id) {
      return res.status(400).json({ error: "Elige la sucursal del cliente (en el formulario) o una sucursal en el encabezado antes de darlo de alta." });
    }
    res.json(crearCliente(DB, { ...req.body, sucursal_id }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put("/api/clientes/:id", requiereLogin, requierePermiso("editar_cliente", resolverPermisosDeRol), (req, res) => {
  try {
    const existente = obtenerCliente(DB, req.params.id);
    const alcance = resolverAlcance(req);
    // Mismo criterio que el GET: "Público en General" (id 0) es compartido
    // y se puede editar desde cualquier sucursal; el resto, no.
    if (existente.id !== 0 && !dentroDeAlcance(existente.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    res.json(actualizarCliente(DB, req.params.id, req.body));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Vendedores y Sucursales (catálogo compartido) ----------
/**
 * Catálogo de vendedores. Lo consumen varias pantallas (Punto de Venta, CRM,
 * Reportes, alta de personal) que solo necesitan id y nombre para un selector.
 *
 * `meta_mensual` NO sale por aquí salvo para jefatura, y solo de su alcance.
 * Con Gerencia de Ventas ese campo dejó de ser un número sembrado sin uso y
 * pasó a ser el objetivo real de cada persona: un dato de desempeño.
 *
 * Ponerle `requiereLogin` cerró "cualquiera en internet" pero NO cerró
 * "cualquier cajera de la cadena" — y eso rodeaba entero el guard
 * `vendedorPermitido`, que existe justo para que nadie vea la meta de otra
 * persona. Una cajera de Ocosingo leía las metas de Palenque abriendo la
 * pestaña de Red del navegador en cualquier pantalla que use esta ruta.
 * Lo encontró la revisión independiente ejecutándolo contra el servidor real.
 */
app.get("/api/vendedores", requiereLogin, (req, res) => {
  const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
  const esJefatura = permisos.includes("editar_objetivos_venta");
  const verTodas = permisos.includes("ver_todas_las_sucursales");

  // Recortado a la sucursal de quien pregunta. Antes salía la cadena completa:
  // la caja de Ocosingo ofrecía a la vendedora de Palenque en el mismo
  // desplegable, sin decir de qué tienda era cada quien ("Ana López" de la 1 y
  // "Ana G." de la 4, una debajo de la otra). Elegir a la de otra tienda no
  // fallaba —la venta se aceptaba con 200— pero `esVentaDeSuTienda` la
  // descartaba: no le contaba a ella NI a quien de verdad vendió.
  const suyos = DB.pos.vendedores.filter(
    (v) => verTodas || Number(v.sucursal_id) === Number(req.usuarioToken.sucursal_id)
  );

  res.json(suyos.map((v) => {
    // El alcance sale SOLO de quien pregunta (permiso + sucursal del token),
    // nunca de `?sucursal_id=` — la trampa que ya mordió tres veces en el repo.
    const puedeVerLaMeta =
      esJefatura && (verTodas || Number(v.sucursal_id) === Number(req.usuarioToken.sucursal_id));
    // Aquí NO se filtran los inactivos, y `activo` viaja siempre. Los dos tipos
    // de pantalla que consumen esta ruta quieren cosas opuestas: la caja y el
    // alta de personal solo deben ofrecer a quien sigue trabajando, mientras
    // que el filtro de Reportes tiene que poder consultar las ventas de quien
    // ya se fue. Filtrar aquí rompería a los segundos; que decida cada una.
    // El campo tiene que ir también en la proyección recortada: sin él, el
    // filtro del Punto de Venta comparaba contra `undefined` y no filtraba nada.
    const base = { id: v.id, nombre: v.nombre, sucursal_id: v.sucursal_id, activo: estaActivo(v) };
    return puedeVerLaMeta ? { ...v, activo: estaActivo(v) } : base;
  }));
});
app.get("/api/sucursales", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  let puedeVerUbicacion = false;
  if (token) {
    try {
      const payload = verificarToken(token);
      puedeVerUbicacion = resolverPermisosDeRol(payload.rol_id).includes("administrar_roles");
    } catch { /* token inválido o ausente: se trata como no autenticado */ }
  }
  if (puedeVerUbicacion) return res.json(DB.pos.sucursales);
  res.json(DB.pos.sucursales.map(({ lat, lng, ...resto }) => resto));
});

// Las cajas de la sucursal en la que está parada la sesión, para el selector de
// la barra superior.
//
// Se resuelve con el alcance directo, y a propósito NO con el ayudante de
// escritura: ese es para rutas que CREAN algo y viene con la obligación de
// responder 400 cuando no hay sucursal elegida. Hay una prueba que cuenta sus
// usos justamente para que nadie meta uno sin esa obligación
// (rutasEscrituraSucursal.test.js). Aquí no se escribe nada: sin sucursal
// concreta simplemente no hay cajas que ofrecer.
//
// Ojo si vas a nombrar ese ayudante aquí: esa prueba cuenta apariciones de texto
// en el archivo, así que mencionarlo con su paréntesis —hasta en un comentario—
// la pone en rojo.
app.get("/api/cajas", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  // Vista global sin tienda elegida: no hay una caja concreta donde cobrar.
  if (alcance.verTodas || !alcance.sucursalId) return res.json([]);
  res.json((DB.pos.cajas || []).filter((caja) => caja.sucursal_id === Number(alcance.sucursalId)));
});

// Mover las coordenadas de una sucursal decide quién puede entrar a ella:
// validarUbicacionLogin() las usa como centro del radio de tolerancia. Quien
// las cambia puede abrirle el acceso a cualquiera desde cualquier lado, o
// dejar fuera a una tienda entera — y siempre sobre una sucursal que puede no
// ser la suya. Alcance global, no solo el permiso.
app.put("/api/sucursales/:id/ubicacion", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), (req, res) => {
  try {
    const sucursal = DB.pos.sucursales.find((s) => s.id === Number(req.params.id));
    if (!sucursal) throw new Error("Sucursal no encontrada");
    if (sucursal.sin_ubicacion) throw new Error("Esta sucursal no usa ubicación GPS");
    const { lat, lng } = req.body;
    sucursal.lat = lat !== undefined && lat !== null && lat !== "" ? Number(lat) : null;
    sucursal.lng = lng !== undefined && lng !== null && lng !== "" ? Number(lng) : null;
    res.json(sucursal);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/intentos-bloqueados", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  const lista = [...DB.admin.intentos_bloqueados_ubicacion].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  res.json(lista);
});

// ---------- CRM (clientes enriquecidos con ventas reales del POS) ----------
app.get("/api/crm/clientes", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarClientesCRM(DB, alcance));
});
app.get("/api/crm/clientes/:id", requiereLogin, (req, res) => {
  try {
    const cliente = obtenerClienteCRM(DB, req.params.id);
    const alcance = resolverAlcance(req);
    // "Público en General" (id 0) es compartido: visible en toda sucursal.
    if (cliente.id !== 0 && !dentroDeAlcance(cliente.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    res.json(cliente);
  } catch (e) { res.status(404).json({ error: e.message }); }
});
app.put("/api/crm/clientes/:id/estado", requiereLogin, requierePermiso("cambiar_estado_cliente", resolverPermisosDeRol), (req, res) => {
  try {
    const cliente = DB.crm.clientes.find((c) => c.id === Number(req.params.id));
    const alcance = resolverAlcance(req);
    if (cliente && cliente.id !== 0 && !dentroDeAlcance(cliente.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    res.json(cambiarEstadoCliente(DB, req.params.id, req.body.estado));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/crm/clientes/:id/contactos", requiereLogin, (req, res) => {
  const cliente = DB.crm.clientes.find((c) => c.id === Number(req.params.id));
  const alcance = resolverAlcance(req);
  if (cliente && cliente.id !== 0 && !dentroDeAlcance(cliente.sucursal_id, alcance)) {
    return res.status(404).json({ error: "Cliente no encontrado" });
  }
  res.json(listarContactos(DB, req.params.id));
});
app.post("/api/crm/clientes/:id/contactos", requiereLogin, requierePermiso("registrar_contacto_cliente", resolverPermisosDeRol), (req, res) => {
  try {
    const cliente = DB.crm.clientes.find((c) => c.id === Number(req.params.id));
    const alcance = resolverAlcance(req);
    if (cliente && cliente.id !== 0 && !dentroDeAlcance(cliente.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    res.json(registrarContacto(DB, req.params.id, req.body));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/crm/resumen-sucursales", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(resumenPorSucursal(DB, alcance));
});
app.get("/api/crm/postventa-pendientes", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const config = obtenerConfiguracion(DB);
  res.json(obtenerSeguimientosPostventaPendientes(DB, config.dias_seguimiento_postventa, alcance));
});
app.get("/api/crm/apartados-por-vencer", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(obtenerApartadosProximosAVencer(DB, alcance));
});
app.get("/api/crm/ranking-vendedores", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(rankingVendedores(DB, alcance));
});

// ---------- Ventas (registro real, alimenta Consultas de Ventas y el CRM) ----------
app.get("/api/ventas", requiereLogin, requierePermiso("ver_lista_ventas", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const filtros = { ...req.query };
  if (alcance.verTodas) delete filtros.sucursal_id;
  else filtros.sucursal_id = alcance.sucursalId;
  res.json(listarVentas(DB, filtros));
});
app.get("/api/ventas/:id", requiereLogin, requierePermiso("mostrar_detalle_venta", resolverPermisosDeRol), (req, res) => {
  try {
    const venta = obtenerVentaDetalle(DB, req.params.id);
    const alcance = resolverAlcance(req);
    if (!dentroDeAlcance(venta.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }
    res.json(venta);
  } catch (e) { res.status(404).json({ error: e.message }); }
});
app.post("/api/ventas", requiereLogin, requierePermiso("cerrar_venta", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    // Amarrado: su sucursal del token, sin importar el body. Global: la del encabezado.
    const sucursal_id = sucursalDeEscritura(alcance, req.body.sucursal_id);
    if (!sucursal_id) {
      return res.status(400).json({ error: "Elige una sucursal en el encabezado para poder vender — la venta descuenta el inventario de una tienda." });
    }
    // Los permisos de quien vende viajan a crearVenta: el descuento se autoriza
    // en el SERVIDOR. El boton de la pantalla ya estaba gateado, pero la ruta
    // solo pedia `cerrar_venta`, asi que un descuento del 99.99% entraba por
    // peticion directa sin dejar ninguna senal.
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    res.json(crearVenta(DB, { ...req.body, sucursal_id }, { permisos }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put("/api/ventas/:id/cancelar", requiereLogin, requierePermiso("cancelar_ventas", resolverPermisosDeRol), (req, res) => {
  try {
    const venta = DB.pos.ventas.find((v) => v.id === Number(req.params.id));
    const alcance = resolverAlcance(req);
    // Sin esto, un Gerente de sucursal podía cancelar la venta de OTRA
    // sucursal por folio y el reintegro de inventario acreditaba stock
    // a la sucursal real de esa venta — un efecto cruzado real.
    if (venta && !dentroDeAlcance(venta.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }
    if (venta && venta.tipo_documento === "Apartado") {
      return res.json(cancelarApartado(DB, req.params.id, req.body.motivo));
    }
    res.json(cancelarVenta(DB, req.params.id, req.body.motivo, req.usuarioToken));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put("/api/ventas/:id/caja", requiereLogin, requierePermiso("cambiar_caja_venta", resolverPermisosDeRol), (req, res) => {
  try {
    const venta = DB.pos.ventas.find((v) => v.id === Number(req.params.id));
    const alcance = resolverAlcance(req);
    if (venta && !dentroDeAlcance(venta.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(cambiarCajaVenta(DB, req.params.id, req.body.caja_id, usuario));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Apartados ----------
app.get("/api/apartados", requiereLogin, requierePermiso("gestionar_apartados", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarApartados(DB, alcance));
});
app.post("/api/apartados", requiereLogin, requierePermiso("gestionar_apartados", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = sucursalDeEscritura(alcance, req.body.sucursal_id);
    if (!sucursal_id) {
      return res.status(400).json({ error: "Elige una sucursal en el encabezado antes de crear un apartado — el producto se reserva en una tienda." });
    }
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(crearApartado(DB, req.body, sucursal_id, usuario, req.query.caja_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/apartados/:id/abonos", requiereLogin, requierePermiso("gestionar_apartados", resolverPermisosDeRol), (req, res) => {
  try {
    const venta = DB.pos.ventas.find((v) => v.id === Number(req.params.id));
    const alcance = resolverAlcance(req);
    if (venta && !dentroDeAlcance(venta.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Apartado no encontrado" });
    }
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(registrarAbono(DB, req.params.id, req.body, usuario, req.query.caja_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put("/api/apartados/:id/cancelar", requiereLogin, requierePermiso("gestionar_apartados", resolverPermisosDeRol), (req, res) => {
  try {
    const venta = DB.pos.ventas.find((v) => v.id === Number(req.params.id));
    const alcance = resolverAlcance(req);
    if (venta && !dentroDeAlcance(venta.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Apartado no encontrado" });
    }
    res.json(cancelarApartado(DB, req.params.id, req.body.motivo));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Garantías ----------
app.get("/api/garantias", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  const alcance = resolverAlcance(req);
  res.json(listarGarantias(DB, alcance));
});

app.post("/api/garantias", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    // Esta pantalla manda la sucursal de origen en el cuerpo y llama con
    // ?sucursal_id=todas justo para que gane la del formulario.
    const sucursal_origen_id = sucursalDeEscritura(alcance, req.body.sucursal_origen_id);
    if (!sucursal_origen_id) {
      return res.status(400).json({ error: "Elige la sucursal de origen de la garantía — es la tienda de donde sale el producto." });
    }
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(crearGarantia(DB, req.body, sucursal_origen_id, usuario));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/enviar", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(marcarEnviada(DB, req.params.id, req.body, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/ubicacion", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(actualizarUbicacion(DB, req.params.id, req.body, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/resolucion", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(registrarResolucion(DB, req.params.id, req.body, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/recibir", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(recibirEnTienda(DB, req.params.id, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/garantias/:id/entregar-cliente", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(entregarACliente(DB, req.params.id, usuario, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Gastos de Garantía ----------
app.get("/api/garantias/:id/gastos", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    res.json(listarGastos(DB, req.params.id, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/garantias/:id/gastos", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), async (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    const { tipo, monto, descripcion, nombre_archivo, tipo_mime, contenido_base64 } = req.body;
    const archivo = contenido_base64 ? { nombre_archivo, tipo_mime, contenido_base64 } : undefined;
    res.json(await agregarGasto(DB, req.params.id, { tipo, monto, descripcion, archivo }, usuario, alcance, drive));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/garantias/:id/gastos/:gastoId", requiereLogin, requierePermiso("gestionar_garantias", resolverPermisosDeRol), async (req, res) => {
  try {
    const alcance = resolverAlcance(req);
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(await eliminarGasto(DB, req.params.id, req.params.gastoId, usuario, alcance, drive));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Configuración general del POS ----------
app.get("/api/configuracion", requiereLogin, (req, res) => res.json(obtenerConfiguracion(DB)));
app.put("/api/configuracion", requiereLogin, requierePermiso("editar_configuracion_pos", resolverPermisosDeRol), (req, res) => {
  try { res.json(actualizarConfiguracion(DB, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Corte de Caja ----------
app.get("/api/cortes/en-curso", requiereLogin, (req, res) => {
  const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
  const alcance = alcanceSucursal(req, permisos);
  // El corte en curso es siempre de UNA sucursal concreta. Con "Todas" no se
  // devuelve un corte cualquiera: mostrar el de la sucursal 1 mientras el
  // cajero cuenta el efectivo de otra tienda inventa un faltante y le cierra
  // el turno a quien no lo cortó.
  // Sin segundo argumento: esta ruta no tiene formulario propio, la sucursal
  // sale del encabezado (que alcanceSucursal ya leyó del query) o del token.
  const sucursal_id = sucursalDeEscritura(alcance);
  if (!sucursal_id) {
    return res.status(400).json({ error: "Elige una sucursal en el encabezado para ver el corte — el corte es de una sola caja." });
  }
  const resultado = calcularCorteEnCurso(DB, sucursal_id, req.query.caja_id);
  res.json(filtrarCorteEnCursoPorPermiso(resultado, permisos));
});
app.get("/api/cortes", requiereLogin, requierePermiso("ver_historial_cortes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarCortes(DB, alcance.verTodas ? undefined : alcance.sucursalId));
});
app.post("/api/cortes", requiereLogin, requierePermiso("realizar_corte_caja", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = sucursalDeEscritura(alcance, req.body.sucursal_id);
    if (!sucursal_id) {
      return res.status(400).json({ error: "Elige una sucursal en el encabezado antes de guardar el corte — el corte cierra el turno de una sola tienda." });
    }
    res.json(crearCorte(DB, {
      ...req.body,
      sucursal_id,
      usuario_id: req.usuarioToken?.id ?? null,
      usuario_nombre: req.usuarioToken?.nombre || req.body.usuario_nombre || "—",
    }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});


// ─────────────────────────── Gastos ───────────────────────────

app.get("/api/gastos", requiereLogin, requierePermiso("ver_gastos", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, categoria_id, forma_pago, estatus } = req.query;
  res.json(listarGastosGasto(DB, { fecha_inicio, fecha_fin, categoria_id, forma_pago, estatus }, alcance));
});

app.post("/api/gastos", requiereLogin, requierePermiso("registrar_gastos", resolverPermisosDeRol), async (req, res) => {
  try {
    // La sucursal sale del TOKEN, nunca del body: si viniera del cliente,
    // cualquiera podría cargarle un gasto a otra tienda.
    const gasto = await crearGasto(DB, req.body, req.usuarioToken.sucursal_id, req.usuarioToken, drive, req.query.caja_id);
    res.json(gasto);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/gastos/:id/cancelar", requiereLogin, requierePermiso("cancelar_gastos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    res.json(cancelarGasto(DB, req.params.id, req.body.motivo, req.usuarioToken, alcance));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Catálogo de solo lectura (solo nombres de categorías; sin montos ni datos
// de ninguna sucursal), así que además de quien captura gastos (ver_gastos)
// se deja entrar a quien solo consulta el Reporte de Gastos (ver_reportes) —
// su filtro de Categoría necesita este mismo catálogo. Es la ÚNICA ruta de
// gastos con este permiso doble: no repetir el patrón en las demás (listar,
// crear, cancelar, administrar categorías) siguen exigiendo solo su permiso.
app.get("/api/gastos/categorias", requiereLogin, (req, res, next) => {
  const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
  if (permisos.includes("ver_gastos") || permisos.includes("ver_reportes")) return next();
  res.status(403).json({ error: "No tienes el permiso requerido: ver_gastos" });
}, (req, res) => {
  res.json(listarCategoriasGasto(DB, { soloActivas: req.query.solo_activas === "1" }));
});

app.post("/api/gastos/categorias", requiereLogin, requierePermiso("administrar_categorias_gastos", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearCategoriaGasto(DB, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/gastos/categorias/:id", requiereLogin, requierePermiso("administrar_categorias_gastos", resolverPermisosDeRol), (req, res) => {
  try {
    if (req.body.activa === false) return res.json(desactivarCategoriaGasto(DB, req.params.id));
    res.json(renombrarCategoriaGasto(DB, req.params.id, req.body.nombre));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/gastos/:id/movimientos", requiereLogin, requierePermiso("ver_gastos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    res.json(movimientosDeGasto(DB, req.params.id, alcance));
  } catch (e) { res.status(404).json({ error: e.message }); }
});


// ---------- Estado de Cuenta (cuenta común entre sucursales) ----------
app.get("/api/estado-cuenta", requiereLogin, requierePermiso("ver_estado_cuenta", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(estadoCuenta(DB, req.query, alcance));
});

app.get("/api/depositos", requiereLogin, requierePermiso("ver_estado_cuenta", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarDepositos(DB, req.query, alcance));
});

app.post("/api/depositos", requiereLogin, requierePermiso("registrar_depositos", resolverPermisosDeRol), async (req, res) => {
  try {
    // La sucursal sale del TOKEN, nunca del body.
    const d = await crearDeposito(DB, req.body, req.usuarioToken.sucursal_id, req.usuarioToken, drive);
    res.json(d);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Adjuntar la ficha a un depósito ya capturado que no la trae. Es la MISMA
// acción de capturar (por eso "registrar_depositos", no un permiso nuevo):
// antes había que cancelar y recapturar solo para agregar el comprobante.
app.post("/api/depositos/:id/comprobante", requiereLogin, requierePermiso("registrar_depositos", resolverPermisosDeRol), async (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    res.json(await adjuntarComprobante(DB, req.params.id, req.body.archivo, req.usuarioToken, alcance, drive));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/depositos/:id/cancelar", requiereLogin, requierePermiso("cancelar_depositos", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    res.json(cancelarDeposito(DB, req.params.id, req.body.motivo, req.usuarioToken, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Catálogo de vendedores (quién vende en cada tienda) ----------
//
// El alcance sale del token de quien pregunta, nunca de `?sucursal_id=`.

app.get("/api/vendedores/catalogo", requiereLogin, requierePermiso("administrar_vendedores", resolverPermisosDeRol), (req, res) => {
  const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
  const alcance = {
    verTodas: permisos.includes("ver_todas_las_sucursales"),
    sucursalId: Number(req.usuarioToken.sucursal_id),
  };
  res.json(listarVendedores(DB, alcance, { incluirInactivos: req.query.incluir_inactivos === "1" }));
});

app.post("/api/vendedores", requiereLogin, requierePermiso("administrar_vendedores", resolverPermisosDeRol), (req, res) => {
  try {
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    const alcance = {
      verTodas: permisos.includes("ver_todas_las_sucursales"),
      sucursalId: Number(req.usuarioToken.sucursal_id),
    };
    res.json(crearVendedor(DB, req.body, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/vendedores/:id", requiereLogin, requierePermiso("administrar_vendedores", resolverPermisosDeRol), (req, res) => {
  try {
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    const alcance = {
      verTodas: permisos.includes("ver_todas_las_sucursales"),
      sucursalId: Number(req.usuarioToken.sucursal_id),
    };
    res.json(actualizarVendedor(DB, req.params.id, req.body, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Desactivar, NO borrar: las ventas historicas resuelven el nombre por id.
app.put("/api/vendedores/:id/desactivar", requiereLogin, requierePermiso("administrar_vendedores", resolverPermisosDeRol), (req, res) => {
  try {
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    const alcance = {
      verTodas: permisos.includes("ver_todas_las_sucursales"),
      sucursalId: Number(req.usuarioToken.sucursal_id),
    };
    res.json(desactivarVendedor(DB, req.params.id, alcance));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Gerencia de Ventas: objetivo y tareas del vendedor ----------

/**
 * Resuelve DE QUIÉN es el tablero que se está pidiendo, y si quien pregunta
 * tiene derecho a verlo.
 *
 * La regla: una vendedora ve SU tablero y nadie más. Quien tiene
 * `editar_objetivos_venta` (jefatura) puede ver el de cualquiera dentro de su
 * alcance de sucursal.
 *
 * OJO — la trampa que ya mordió tres veces en este repo (Estado de Cuenta,
 * "Venta no encontrada", expedientes): el alcance de "¿tengo derecho a ESTE
 * registro?" se resuelve SOLO desde quien pregunta (su permiso y la sucursal de
 * su token), NUNCA desde `?sucursal_id=`, que `apiFetch` inyecta desde el
 * selector del encabezado. Ver [[feedback-workflow]].
 */
function vendedorPermitido(req, vendedorIdPedido) {
  const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
  const esJefatura = permisos.includes("editar_objetivos_venta");
  const pedido = Number(vendedorIdPedido);

  const cuenta = DB.admin.usuarios.find((u) => u.id === req.usuarioToken.id);
  const propio = cuenta?.vendedor_id != null ? Number(cuenta.vendedor_id) : null;

  if (!esJefatura) {
    // No es jefatura: solo el suyo, y solo si su cuenta está ligada a un vendedor.
    if (propio == null || pedido !== propio) return null;
    return pedido;
  }

  // Jefatura: puede ver a cualquiera de su alcance de sucursal.
  const vendedor = DB.pos.vendedores.find((v) => v.id === pedido);
  if (!vendedor) return null;
  const verTodas = permisos.includes("ver_todas_las_sucursales");
  if (!verTodas && Number(vendedor.sucursal_id) !== Number(req.usuarioToken.sucursal_id)) return null;
  return pedido;
}

/** Mi tablero (o el de alguien más, si soy jefatura). */
app.get("/api/gerente-ventas/:vendedorId", requiereLogin, requierePermiso("usar_gerente_ventas", resolverPermisosDeRol), (req, res) => {
  try {
    const vendedorId = vendedorPermitido(req, req.params.vendedorId);
    // 404 y no 403: no se confirma que el tablero de otra persona exista.
    if (vendedorId == null) return res.status(404).json({ error: "Tablero no encontrado" });
    const t = tablero(DB, vendedorId);
    // Este GET genera tareas, y la auto-persistencia solo cubre POST/PUT/DELETE.
    // Se guarda solo cuando de verdad hubo tareas nuevas, para no reescribir la
    // base entera cada vez que alguien abre su pantalla.
    if (t.tareas_nuevas > 0) guardar(DB);
    res.json(t);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/** ¿Con qué vendedor está ligada MI cuenta? La pantalla lo necesita para saber
 *  si mostrar el módulo, sin tener que adivinar un id. */
app.get("/api/gerente-ventas/mi/vendedor", requiereLogin, requierePermiso("usar_gerente_ventas", resolverPermisosDeRol), (req, res) => {
  const cuenta = DB.admin.usuarios.find((u) => u.id === req.usuarioToken.id);
  res.json({ vendedor_id: cuenta?.vendedor_id ?? null });
});

/** Marcar una tarea como hecha o descartada. El guard de "es mía" vive DENTRO
 *  del módulo (gerenteVentas.js), no solo aquí. */
app.put("/api/gerente-ventas/:vendedorId/tareas/:tareaId", requiereLogin, requierePermiso("usar_gerente_ventas", resolverPermisosDeRol), (req, res) => {
  try {
    const vendedorId = vendedorPermitido(req, req.params.vendedorId);
    if (vendedorId == null) return res.status(404).json({ error: "Tarea no encontrada" });
    res.json(cambiarEstadoTarea(DB, vendedorId, req.params.tareaId, req.body?.estado));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/** Fijar la meta mensual de un vendedor. Solo jefatura — nunca el propio
 *  vendedor sobre sí mismo: no se pone su propia calificación. */
app.put("/api/gerente-ventas/:vendedorId/meta", requiereLogin, requierePermiso("editar_objetivos_venta", resolverPermisosDeRol), (req, res) => {
  try {
    const vendedor = DB.pos.vendedores.find((v) => v.id === Number(req.params.vendedorId));
    if (!vendedor) return res.status(404).json({ error: "Vendedor no encontrado" });
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    if (!permisos.includes("ver_todas_las_sucursales") &&
        Number(vendedor.sucursal_id) !== Number(req.usuarioToken.sucursal_id)) {
      return res.status(404).json({ error: "Vendedor no encontrado" });
    }
    res.json(fijarMeta(DB, req.params.vendedorId, req.body?.meta));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/**
 * Sugerencia de meta para un vendedor, con explicación redactada.
 *
 * La CIFRA sale del historial real (gerenteVentas.sugerirMeta); la IA solo la
 * explica, y si falla la sugerencia se entrega igual con el texto calculado.
 */
app.get("/api/gerente-ventas/:vendedorId/sugerencia-meta", requiereLogin, requierePermiso("editar_objetivos_venta", resolverPermisosDeRol), async (req, res) => {
  try {
    const vendedor = DB.pos.vendedores.find((v) => v.id === Number(req.params.vendedorId));
    if (!vendedor) return res.status(404).json({ error: "Vendedor no encontrado" });
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    if (!permisos.includes("ver_todas_las_sucursales") &&
        Number(vendedor.sucursal_id) !== Number(req.usuarioToken.sucursal_id)) {
      return res.status(404).json({ error: "Vendedor no encontrado" });
    }
    res.json(await sugerirMetaConExplicacion(DB, anthropic, req.params.vendedorId));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/** Lista de vendedores con su meta y progreso, para la pantalla de jefatura. */
app.get("/api/gerente-ventas", requiereLogin, requierePermiso("editar_objetivos_venta", resolverPermisosDeRol), (req, res) => {
  const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
  const verTodas = permisos.includes("ver_todas_las_sucursales");
  // Los desactivados no salen: el tablero es para dirigir a quien está
  // trabajando hoy, y un renglón con meta y avance de alguien que ya se fue
  // solo ensucia el promedio del equipo.
  const visibles = DB.pos.vendedores.filter(
    (v) => estaActivo(v) && (verTodas || Number(v.sucursal_id) === Number(req.usuarioToken.sucursal_id))
  );
  res.json(visibles.map((v) => calcularProgreso(DB, v.id)));
});

// ---------- Respaldos y punto de restauración ----------

app.get("/api/respaldos", requiereLogin, requierePermiso("ver_respaldos", resolverPermisosDeRol), (req, res) => {
  // Sin alcance de sucursal: un respaldo es de toda la empresa.
  res.json(
    [...DB.respaldos.copias]
      .sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora))
      .map(({ drive_file_id, ...resto }) => resto) // el id de Drive no sale al frontend
  );
});

app.get("/api/respaldos/estado", requiereLogin, requierePermiso("ver_respaldos", resolverPermisosDeRol), (req, res) => {
  res.json({
    ...estadoRespaldos(DB),
    respaldo_configurado: !!LLAVE_RESPALDO,
    restauracion_habilitada: claveRestauracionConfigurada(),
    mantenimiento: mantenimiento.estado(),
  });
});

app.post("/api/respaldos/ahora", requiereLogin, requierePermiso("crear_respaldo", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), async (req, res) => {
  try {
    if (!LLAVE_RESPALDO) throw new Error("RESPALDO_LLAVE no está configurada en el servidor");
    // tipo "dia" y no "hora": el caso de uso del botón es "voy a hacer algo
    // riesgoso, déjame respaldar antes". Como "hora" vivía 7 días, salía en la
    // tabla equivocada, nunca se verificaba contra Drive y el script jamás lo
    // bajaba a la PC — las cuatro propiedades que uno esperaría al revés.
    const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE_RESPALDO, usuario: req.usuarioToken });
    res.json(copia);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/respaldos/:id/comparar", requiereLogin, requierePermiso("restaurar_respaldo", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), (req, res) => {
  try {
    const copia = DB.respaldos.copias.find((c) => c.id === Number(req.params.id));
    if (!copia) throw new Error("Respaldo no encontrado");
    res.json({ copia: { ...copia, drive_file_id: undefined }, ...compararConEstadoActual(DB, copia) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/respaldos/:id/restaurar", requiereLogin, requierePermiso("restaurar_respaldo", resolverPermisosDeRol), requiereAlcanceGlobal(resolverPermisosDeRol), async (req, res) => {
  const usuario = req.usuarioToken?.usuario || `id:${req.usuarioToken?.id}`;
  try {
    // El bloqueo se consulta ANTES de tocar la clave, igual que en el login.
    const bloqueo = estaBloqueado(intentosRestauracion, usuario);
    if (bloqueo.bloqueado) {
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Vuelve a intentar en ${Math.ceil(bloqueo.restanteMs / 60000)} minutos.`,
      });
    }
    if (!LLAVE_RESPALDO) throw new Error("RESPALDO_LLAVE no está configurada en el servidor");

    const resultado = await restaurar(DB, drive, {
      copiaId: req.params.id,
      llave: LLAVE_RESPALDO,
      clave: req.body?.clave,
      confirmacion: req.body?.confirmacion,
      usuario: req.usuarioToken,
      // El alcance global se decide por PERMISO, no por la sucursal del token.
      // Ver el candado 0 de restaurar(): exigir sucursal_id null volvía la
      // restauración imposible para cualquier cuenta que el sistema pueda crear.
      permisos: resolverPermisosDeRol(req.usuarioToken?.rol_id),
      // Reconciliaciones de arranque, después de reemplazar los datos: una foto
      // anterior a este módulo no trae el rol Administrador con los permisos de
      // respaldos, y sin esto restaurar dejaba a Victor sin el propio botón de
      // restaurar (y sin CEDIS).
      // Todo lo que hay que rehacer tras reemplazar los datos vive en
      // reconciliarRestauracion.js, con sus pruebas. Aquí solo se engancha.
      alTerminar: reconciliarTrasRestaurar,
    });
    registrarExito(intentosRestauracion, usuario);
    // Corte REAL de las sesiones abiertas. Antes esto era solo una frase en la
    // respuesta: los tokens siguen siendo válidos 12 h y `requierePermiso`
    // resuelve los permisos con el `rol_id` que trae el token, contra el DB YA
    // restaurado. Como los ids de rol se reciclan, una cajera con sesión abierta
    // podía despertar con los permisos de otro rol; y una cuenta borrada revivía
    // con su token todavía bueno. Ahora todo token emitido antes de este instante
    // queda inválido (ver requiereLogin en auth.js).
    invalidarSesionesAnterioresA(Date.now());
    res.json({
      ok: true,
      restaurado_a: `${resultado.copia.fecha} ${resultado.copia.hora_local}`,
      respaldo_previo: resultado.pre_restauracion.nombre_archivo,
      aviso: "Todos los usuarios conectados tienen que volver a iniciar sesión.",
    });
  } catch (e) {
    // Solo un fallo de CLAVE cuenta para el bloqueo. Un archivo corrupto o un
    // Drive caído no son un ataque, y contarlos dejaría a Victor fuera de su
    // propio botón justo el día que lo necesita.
    if (/clave de restauración/i.test(e.message)) registrarFallo(intentosRestauracion, usuario);
    res.status(400).json({ error: e.message });
  }
});

/**
 * Puerta de las dos rutas SIN SESIÓN de respaldos (índice y descarga), que corre
 * la tarea programada de la PC de Victor sin nadie enfrente.
 *
 * Devuelve true solo si el token cuadra. Además pone un freno de fuerza bruta:
 * son las únicas rutas del sistema sin sesión que tocan datos del negocio, y no
 * hay rate limiting a nivel de red. Sin freno se podían probar tokens sin
 * límite, y cada acierto dispara una descarga de Google Drive con el OAuth del
 * negocio (cuota y costo). El login y el botón de restaurar ya tienen su propio
 * freno; estas eran las que faltaban.
 *
 * Los nombres llevan "token" a propósito: el depurador de Sentry
 * (instrument.js) filtra por nombre además de por valor, y con
 * `includeLocalVariables` estas locales viajan en el stack trace de cualquier
 * excepción que ocurra dentro del handler.
 */
const intentosDescarga = crearRegistroIntentos();

function tokenDeDescargaValido(req) {
  // Una sola cubeta para las dos rutas: la IP detrás del proxy de Render no es
  // confiable, así que se frena el conjunto. El script legítimo corre una vez al
  // día y nunca se acerca al límite.
  if (estaBloqueado(intentosDescarga, "descarga-respaldos").bloqueado) return false;

  const tokenEsperado = process.env.TOKEN_DESCARGA_RESPALDOS;
  const tokenDado = req.get("X-Token-Respaldo") || "";
  if (!tokenEsperado || !tokenDado) return false;

  const a = crypto.createHash("sha256").update(tokenDado).digest();
  const b = crypto.createHash("sha256").update(tokenEsperado).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    registrarFallo(intentosDescarga, "descarga-respaldos");
    return false;
  }
  registrarExito(intentosDescarga, "descarga-respaldos");
  return true;
}

/** Índice para el script de la PC. Mismo token y mismo 404-si-no-cuadra que la
 *  ruta de descarga. Devuelve solo lo que el script necesita para decidir qué
 *  bajar — ningún dato del negocio. */
app.get("/api/respaldos/indice", (req, res) => {
  // 404 y no 429 ni 401: desde fuera, "token malo", "sin token", "bloqueado" y
  // "no existe" son indistinguibles. No se confirma ni que la ruta exista.
  if (!tokenDeDescargaValido(req)) return res.status(404).json({ error: "No encontrado" });

  res.json(DB.respaldos.copias.map((c) => ({
    id: c.id, tipo: c.tipo, fecha: c.fecha, hora_local: c.hora_local,
    nombre_archivo: c.nombre_archivo, bytes: c.bytes, estado: c.estado,
  })));
});

/**
 * Descarga cruda para el script de la PC de Victor. Sin sesión, porque la corre
 * una tarea programada de Windows sin nadie enfrente.
 *
 * Es segura porque: (a) devuelve SOLO bytes cifrados — sin RESPALDO_LLAVE son
 * ruido; (b) el token se compara en tiempo constante; (c) sin la variable
 * configurada responde 404, no 401: no confirma ni que la ruta exista.
 */
app.get("/api/respaldos/:id/descargar", async (req, res) => {
  if (!tokenDeDescargaValido(req)) return res.status(404).json({ error: "No encontrado" });

  try {
    const copia = DB.respaldos.copias.find((c) => c.id === Number(req.params.id));
    if (!copia || !copia.drive_file_id) return res.status(404).json({ error: "No encontrado" });
    const bytes = await drive.descargarArchivoDeDrive(DB, copia.drive_file_id);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${copia.nombre_archivo}"`);
    res.send(bytes);
  } catch (e) { res.status(500).json({ error: "No se pudo descargar" }); }
});

// ---------- Condiciones por forma de pago (configurable por sucursal) ----------
// El alcance sale del TOKEN, no del `?sucursal_id=`. Antes se leía del query:
// src/api.js inyecta ese parámetro desde localStorage en TODA llamada, así que
// ese valor ERA la autorización — una cajera de Ocosingo listaba las formas de
// pago de Yajalón con solo cambiar el número en la barra de direcciones. Era la
// única ruta del sistema que caía en esa trampa.
app.get("/api/condiciones-pago", requiereLogin, (req, res) => {
  const alcance = resolverAlcance(req);
  // Sin sucursal elegida no se inventa la 1: antes el `else 1` le enseñaba
  // Ocosingo a cualquiera que mandara un valor inválido.
  const sucursal_id = alcance.verTodas
    ? (req.query.sucursal_id ? Number(req.query.sucursal_id) : null)
    : alcance.sucursalId;
  if (!Number.isInteger(sucursal_id) || sucursal_id <= 0) {
    return res.json([]);
  }
  res.json(listarCondiciones(DB, sucursal_id));
});
app.put("/api/condiciones-pago/:id", requiereLogin, requierePermiso("editar_configuracion_pos", resolverPermisosDeRol), (req, res) => {
  try { res.json(actualizarCondicion(DB, req.params.id, req.body, resolverAlcance(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/chat", requiereLogin, requierePermiso("usar_asistente_ia", resolverPermisosDeRol), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Falta configurar ANTHROPIC_API_KEY en el archivo .env del backend" });
    }

    const { mensajes } = req.body; // [{ role: 'user'|'assistant', content: 'texto' }]
    // Se guardan en una variable porque más abajo `consultarModulo` los necesita
    // para filtrar lo que este usuario tiene permitido ver. Antes se calculaban
    // en línea aquí y allá se leía una variable que no existía en este ámbito.
    const permisosDeQuienPregunta = resolverPermisosDeRol(req.usuarioToken.rol_id);
    const alcance = alcanceSucursal(req, permisosDeQuienPregunta);
    let historial = (mensajes || []).map((m) => ({ role: m.role, content: m.content }));
    const consultas = [];
    let respuestaFinal = null;
    let vueltas = 0;

    while (!respuestaFinal && vueltas < 5) {
      vueltas++;
      const respuesta = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: construirSystemPrompt(alcance, DB),
        tools: [TOOL, TOOL_PREDICCION],
        messages: historial
      });

      const bloquesHerramienta = respuesta.content.filter((b) => b.type === "tool_use");
      if (bloquesHerramienta.length === 0) {
        respuestaFinal = respuesta.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        break;
      }

      // Claude puede pedir varias consultas a la vez (ej. cruzar ventas + clientes) —
      // hay que resolver TODAS y devolver un tool_result por cada una, o la API
      // de Anthropic rechaza el siguiente turno con un error de formato.
      const resultadosHerramientas = bloquesHerramienta.map((bloque) => {
        let resultado;
        try {
          if (bloque.name === "predecir_demanda") {
            resultado = predecirDemanda(DB, bloque.input);
          } else {
            resultado = consultarModulo(bloque.input, alcance, DB, permisosDeQuienPregunta);
          }
        } catch (e) {
          resultado = { error: e.message };
        }
        consultas.push({ input: bloque.input, resultado, herramienta: bloque.name });
        return { type: "tool_result", tool_use_id: bloque.id, content: JSON.stringify(resultado) };
      });

      historial.push({ role: "assistant", content: respuesta.content });
      historial.push({ role: "user", content: resultadosHerramientas });
    }

    res.json({ respuesta: respuestaFinal, consultas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── MercadoLibre ──────────────────────────────────────────────────────────────

app.get("/api/ml/estado", requiereLogin, (req, res) => {
  const c = DB.ml.cuenta;
  res.json({
    conectado:      !!c?.access_token,
    configurado:    !!(process.env.ML_CLIENT_ID && process.env.ML_CLIENT_SECRET),
    user_id:        c?.user_id || null,
    conectado_en:   c?.conectado_en || null,
  });
});

app.get("/api/ml/auth-url", requiereLogin, requierePermiso("conectar_cuenta_ml", resolverPermisosDeRol), (req, res) => {
  try {
    const redirect = process.env.ML_REDIRECT_URI ||
      `${req.protocol}://${req.get("host")}/api/ml/callback`;
    res.json({ url: urlAutorizacion(redirect) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/ml/callback", async (req, res) => {
  const { code } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  if (!code) return res.redirect(`${frontendUrl}?ml=error&msg=sin_codigo`);
  const redirect = process.env.ML_REDIRECT_URI ||
    `${req.protocol}://${req.get("host")}/api/ml/callback`;
  try {
    await intercambiarCodigo(DB, code, redirect);
    guardar(DB);
    res.redirect(`${frontendUrl}?ml=conectado`);
  } catch (e) {
    res.redirect(`${frontendUrl}?ml=error&msg=${encodeURIComponent(e.message)}`);
  }
});

app.delete("/api/ml/desconectar", requiereLogin, requierePermiso("conectar_cuenta_ml", resolverPermisosDeRol), (req, res) => {
  DB.ml.cuenta = null;
  guardar(DB);
  res.json({ ok: true });
});

app.get("/api/ml/publicaciones", requiereLogin, async (req, res) => {
  try { res.json(await listarPublicaciones(DB)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/ml/publicaciones/locales", requiereLogin, (req, res) => {
  res.json(DB.ml.publicaciones);
});

app.post("/api/ml/publicar", requiereLogin, requierePermiso("gestionar_publicaciones_ml", resolverPermisosDeRol), async (req, res) => {
  try { res.json(await publicarProducto(DB, req.body.producto_id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/ml/publicaciones/:itemId/stock", requiereLogin, requierePermiso("gestionar_publicaciones_ml", resolverPermisosDeRol), async (req, res) => {
  try { res.json(await actualizarStockML(DB, req.params.itemId, Number(req.body.cantidad))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/ml/publicaciones/:itemId", requiereLogin, requierePermiso("gestionar_publicaciones_ml", resolverPermisosDeRol), async (req, res) => {
  try { res.json(await actualizarPublicacion(DB, req.params.itemId, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/ml/ordenes", requiereLogin, async (req, res) => {
  try { res.json(await listarOrdenes(DB, Number(req.query.limite) || 50)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/ml/ordenes/:ordenId/importar", requiereLogin, requierePermiso("importar_ordenes_ml", resolverPermisosDeRol), async (req, res) => {
  try { res.json(await importarOrdenComoVenta(DB, req.params.ordenId)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Obtiene thumbnail/imágenes de cualquier ítem público de ML (sin necesitar token de vendedor)
app.get("/api/ml/item-imagen/:itemId", requiereLogin, async (req, res) => {
  try {
    const r = await fetch(
      `https://api.mercadolibre.com/items/${req.params.itemId}?attributes=id,thumbnail,pictures`,
      { headers: { Accept: "application/json" } }
    );
    if (!r.ok) return res.status(r.status).json({ error: "Ítem de ML no encontrado" });
    const d = await r.json();
    res.json({
      thumbnail: d.thumbnail || null,
      pictures:  (d.pictures || []).map((p) => p.secure_url || p.url || "").filter(Boolean),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/reportes/ventas", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, vendedor_id, cliente_id, tipo_documento } = req.query;
  res.json(reporteVentas(DB, { fecha_inicio, fecha_fin, vendedor_id, cliente_id, tipo_documento }, alcance));
});

app.get("/api/reportes/utilidad", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, vendedor_id } = req.query;
  res.json(reporteUtilidad(DB, { fecha_inicio, fecha_fin, vendedor_id }, alcance));
});

app.get("/api/reportes/compras", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, proveedor_id } = req.query;
  res.json(reporteCompras(DB, { fecha_inicio, fecha_fin, proveedor_id }, alcance));
});

app.get("/api/reportes/cortes-caja", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin } = req.query;
  res.json(reporteCortesCaja(DB, { fecha_inicio, fecha_fin }, alcance));
});

app.get("/api/reportes/existencias", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { departamento_id, estado } = req.query;
  res.json(reporteExistencias(DB, { departamento_id, estado }, alcance));
});

app.get("/api/reportes/clientes", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { cliente_id } = req.query;
  res.json(reporteEstadoCuentaClientes(DB, { cliente_id }, alcance));
});

app.get("/api/reportes/movimientos-caja", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin } = req.query;
  res.json(reporteMovimientosCaja(DB, { fecha_inicio, fecha_fin }, alcance));
});

app.get("/api/reportes/gastos-garantias", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, tipo, proveedor_id, sin_comprobante } = req.query;
  res.json(reporteGastosGarantias(DB, { fecha_inicio, fecha_fin, tipo, proveedor_id, sin_comprobante }, alcance));
});

app.get("/api/reportes/gastos", requiereLogin, requierePermiso("ver_reportes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { fecha_inicio, fecha_fin, categoria_id, forma_pago, proveedor_id, estatus } = req.query;
  res.json(reporteGastos(DB, { fecha_inicio, fecha_fin, categoria_id, forma_pago, proveedor_id, estatus }, alcance));
});

// ─────────────────────────────────────────────────────────────────────────────

// Sentry: captura en el monitoreo los errores que revientan dentro de una ruta
// de Express. DEBE ir DESPUÉS de definir todas las rutas. Si no hay SENTRY_DSN
// configurado, no hace nada.
Sentry.setupExpressErrorHandler(app);

// Antes de que Render apague el proceso (SIGTERM), da 2s para que Sentry
// alcance a enviar los eventos pendientes.
process.on("SIGTERM", async () => {
  await Sentry.close(2000);
  process.exit(0);
});

/**
 * Aviso de arranque (no bloquea nada): cuentas ya guardadas que se pisan al
 * normalizar el nombre de usuario. Hoy no se pueden crear —crearUsuario las
 * rechaza y actualizarUsuario no deja renombrar—, pero una base vieja podría
 * traer "Maria" y "maria" desde antes: la segunda no podría iniciar sesión
 * nunca, y el mensaje que ve es el genérico de contraseña incorrecta.
 * Ver usuariosQueChocanAlNormalizar en backend/usuarios.js.
 */
function avisarUsuariosQueChocan() {
  for (const { clave, usuarios } of usuariosQueChocanAlNormalizar(DB)) {
    const lista = usuarios.map((u) => `"${u}"`).join(", ");
    console.warn(
      `🚨 Hay ${usuarios.length} cuentas que son el MISMO usuario al iniciar sesión ("${clave}"): ${lista}. ` +
      "Solo la primera puede entrar; a las demás el login les responde \"Usuario o contraseña incorrectos\" sin más explicación. " +
      "Bórralas y vuelve a darlas de alta con un nombre de usuario distinto (editar no permite renombrar la cuenta)."
    );
  }
}

const PUERTO = process.env.PORT || 4000;

// Guardia obligatorio: si algún módulo/permiso no está bien registrado para
// Roles y Personal, esto lanza un error y el backend NO levanta.
validarSistemaDePermisos();

if (ESTE_PROCESO_ES_EL_SERVIDOR) {
  app.listen(PUERTO, () => {
    console.log(`Backend corriendo en http://localhost:${PUERTO}`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("⚠️  No hay ANTHROPIC_API_KEY configurada — copia .env.example a .env y pega tu key");
    }
    if (!process.env.JWT_SECRET) {
      console.log("🚨 JWT_SECRET no configurado — usando una clave ALEATORIA por arranque. Es seguro (nadie puede falsificar tokens), pero las sesiones se invalidan cada vez que el servidor reinicia. Configura JWT_SECRET en las variables de entorno de Render para que las sesiones persistan.");
    }
    avisarUsuariosQueChocan();
  });
}

// Se exporta la app para que las pruebas puedan levantarla en un puerto
// efímero y pegarle a las rutas REALES (con sus middlewares y sus guardas),
// en vez de reimplementar a mano lo que hace cada ruta.
// El DB se expone para las PRUEBAS, que necesitan sembrar cuentas reales: desde
// que la sesión comprueba que la cuenta siga activa, un token firmado a mano
// para un usuario inexistente ya no sirve — que es justo lo que se quería.
app.DB = DB;

module.exports = app;
