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

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const { predecirDemanda } = require("./predicciones");
const { parsearReporteVentasSicar, previsualizarHistorialVentas, aplicarHistorialVentas } = require("./historialVentas");
const {
  listarProductos, crearProducto, actualizarProducto, eliminarProducto,
  clonarProducto, ajustarExistencia, listarCategorias, crearCategoria,
  listarDepartamentos, crearDepartamento, crearProveedor, generarClave
} = require("./productos");
const { listarClientes, obtenerCliente, crearCliente, actualizarCliente } = require("./clientes");
const {
  listarClientesCRM, obtenerClienteCRM, cambiarEstadoCliente,
  registrarContacto, listarContactos, resumenPorSucursal, rankingVendedores,
  obtenerSeguimientosPostventaPendientes
} = require("./crm");
const { crearVenta, listarVentas, obtenerVentaDetalle, cancelarVenta } = require("./ventas");
const { obtenerConfiguracion, actualizarConfiguracion } = require("./configuracion");
const { calcularCorteEnCurso, crearCorte, listarCortes, filtrarCorteEnCursoPorPermiso } = require("./cortes");
const { listarCondiciones, actualizarCondicion } = require("./condicionesPago");
const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");
const { requiereLogin, requierePermiso, firmarToken, verificarToken, alcanceSucursal, dentroDeAlcance, validarUbicacionLogin, mensajePorMotivoUbicacion } = require("./auth");
const { consultarModulo } = require("./consultarModulo");
const { listarRoles, obtenerRol, permisosDeRol, crearRol, actualizarRol, eliminarRol, clonarRol, sembrarRolesIniciales, reconciliarRoles } = require("./roles");
const { crearTraspaso, recibirTraspaso, listarTraspasos } = require("./traspasos");
const { crearRecepcion, listarRecepciones, historialCostoProducto } = require("./compras");
const { reconciliarSucursalesCedis } = require("./sucursales");
const { contarClavesSat, necesitaImportarClavesSat } = require("./clavesSat");
const { importarClavesSat } = require("./scripts/importarClavesSat");
const { parsearExcel, previsualizarImportacion, aplicarImportacion, exportarRespaldo } = require("./migracion");
const { listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, esAccionSobreSiMismo, iniciarSesion } = require("./usuarios");
const { armarSesion } = require("./sesion");
const { buscarClavesSat } = require("./clavesSat");
const { parsearFacturaXML } = require("./cfdi");
const {
  intercambiarCodigo, urlAutorizacion, listarPublicaciones,
  publicarProducto, actualizarStockML, actualizarPublicacion,
  listarOrdenes, importarOrdenComoVenta,
} = require("./mercadolibre");

let cargar = () => null, guardar = () => {};
try {
  const p = require("./persistencia");
  cargar = p.cargar; guardar = p.guardar;
  console.log("✅ Módulo de persistencia SQLite cargado");
} catch (e) {
  console.warn("⚠️  Persistencia SQLite no disponible — los datos solo vivirán en memoria:", e.message);
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
    cortes_caja: []
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
    traspasos: []
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
    intentos_bloqueados_ubicacion: []
  },
  ml: {
    cuenta: null,
    publicaciones: [],
    ordenes_importadas: [],
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

// Garantiza que CEDIS (sucursal 6) exista y que 5/6 tengan sin_ubicacion=true,
// tanto si el DB viene del seed fresco como si viene de datos persistidos
// anteriores a esta feature. Ver backend/sucursales.js.
DB.pos.sucursales = reconciliarSucursalesCedis(DB.pos.sucursales);

// Garantiza que el rol "Administrador" tenga TODOS los módulos y permisos del
// catálogo actual, aunque venga de un snapshot persistido anterior a módulos
// o permisos nuevos (ml, traspasos, compras...). Los demás roles no se tocan.
// Ver backend/roles.js -> reconciliarRoles.
reconciliarRoles(DB);

// Garantiza el catálogo de Claves SAT (búsqueda en pantalla Artículo de Compras).
// En Render, datos.sqlite no viaja con el deploy (está en .gitignore), así que
// el catálogo se pierde en cada reinicio del dyno. Se reimporta solo, en
// segundo plano, sin bloquear el arranque del servidor: mientras tanto la
// búsqueda de Clave SAT simplemente devuelve vacío (ver clavesSat.js).
if (necesitaImportarClavesSat(contarClavesSat())) {
  console.log("📦 Catálogo de Claves SAT ausente o incompleto — importando en segundo plano...");
  importarClavesSat().then(
    (total) => console.log(`✅ Catálogo de Claves SAT importado: ${total} claves`),
    (e) => console.error("⚠️  No se pudo importar el catálogo de Claves SAT (la búsqueda seguirá vacía hasta el próximo arranque):", e.message)
  );
}

function listarModulosYTablas() {
  return Object.entries(DB).map(([id, tablas]) => ({ id, tablas: Object.keys(tablas) }));
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
  const fechaISO = hoy.toISOString().slice(0, 10);
  const diaSemana = hoy.toLocaleDateString("es-MX", { weekday: "long" });

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

app.get("/api/salud", (req, res) => res.json({ ok: true, modulos: listarModulosYTablas() }));

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
    // OJO: no usar alcanceSucursal()/req.query aquí. apiFetch agrega
    // automáticamente ?sucursal_id=<seleccion del encabezado> a TODA
    // request, así que un admin con "ver_todas_las_sucursales" pero con
    // una sucursal específica elegida arriba en el encabezado global haría
    // que alcance.verTodas diera false y pisara la sucursal que el usuario
    // eligió explícitamente en ESTE formulario (req.body.sucursal_id).
    // Aquí se resuelve directo con el permiso real del usuario.
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    const puedeVerTodas = Array.isArray(permisos) && permisos.includes("ver_todas_las_sucursales");
    const sucursal_id = puedeVerTodas ? Number(req.body.sucursal_id) : req.usuarioToken.sucursal_id;
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
  res.json(listarProductos(DB, sucursalId));
});

app.post("/api/productos", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(crearProducto(DB, req.body, sucursal_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/productos/:id", requiereLogin, requierePermiso("editar_producto", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(actualizarProducto(DB, req.params.id, req.body, sucursal_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/productos/:id", requiereLogin, requierePermiso("eliminar_producto", resolverPermisosDeRol), (req, res) => {
  try { eliminarProducto(DB, req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/productos/:id/clonar", requiereLogin, requierePermiso("clonar_producto", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(clonarProducto(DB, req.params.id, sucursal_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/productos/:id/ajustar", requiereLogin, requierePermiso("ajustar_existencia", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    // Amarrado: su sucursal del token, sin importar el body. Global: la que venga en el body (o 1).
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
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
    const sucursal_origen_id = alcance.verTodas ? (Number(req.body.sucursal_origen_id) || 1) : alcance.sucursalId;
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
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
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

app.post("/api/migracion/previsualizar", requiereLogin, requierePermiso("migrar_datos", resolverPermisosDeRol), (req, res) => {
  try {
    const { tipo, archivo_base64 } = req.body;
    // Mismo cálculo de sucursal_id que /api/migracion/aplicar (ver más abajo):
    // la previsualización debe reflejar EXACTAMENTE el mismo matching que
    // hará aplicar, o podrían mostrarle a Victor "actualización" y terminar
    // aplicando una "alta" (o viceversa) — ver hallazgo de revisión de rama
    // completa sobre matching de clientes por clave+sucursal.
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    let sucursal_id = null;
    if (tipo === "articulos" || tipo === "clientes") {
      sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || null) : alcance.sucursalId;
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
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    let sucursal_id = null;
    if (tipo === "articulos" || tipo === "clientes") {
      sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || null) : alcance.sucursalId;
      if (!sucursal_id) return res.status(400).json({ error: "Selecciona la sucursal de origen del archivo" });
    }
    const resumen = aplicarImportacion(DB, tipo, filas, sucursal_id, defaults, nombre_archivo);
    res.json(resumen);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/migracion/exportar", requiereLogin, requierePermiso("migrar_datos", resolverPermisosDeRol), (req, res) => {
  try {
    const { tipo } = req.query;
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    let sucursal_id = null;
    if (tipo === "articulos" || tipo === "clientes") {
      sucursal_id = alcance.verTodas ? (Number(req.query.sucursal_id) || null) : alcance.sucursalId;
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

app.post("/api/auth/login", async (req, res) => {
  try {
    const { usuario, password, sucursal_id_seleccionada, lat, lng } = req.body;
    const encontrado = await iniciarSesion(DB, usuario, password);
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
app.put("/api/roles/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  try { res.json(actualizarRol(DB, req.params.id, req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/roles/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  try { eliminarRol(DB, req.params.id); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/roles/:id/clonar", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  try { res.json(clonarRol(DB, req.params.id, req.body.nombre)); } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Usuarios / personal ----------
app.get("/api/usuarios", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => res.json(listarUsuarios(DB)));
// El botón "Dar de alta personal" está gateado con dar_alta_personal en el
// frontend (AdminRoles.jsx); la ruta debe exigir la MISMA clave que el botón.
app.post("/api/usuarios", requiereLogin, requierePermiso("dar_alta_personal", resolverPermisosDeRol), async (req, res) => {
  try { res.json(await crearUsuario(DB, req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put("/api/usuarios/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), async (req, res) => {
  try {
    if (req.body.activo === false && esAccionSobreSiMismo(req.params.id, req.usuarioToken.id)) {
      throw new Error("No puedes desactivarte a ti mismo mientras tienes la sesión abierta");
    }
    res.json(await actualizarUsuario(DB, req.params.id, req.body));
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
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
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
app.get("/api/vendedores", (req, res) => res.json(DB.pos.vendedores));
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

app.put("/api/sucursales/:id/ubicacion", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
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
    // Amarrado: su sucursal del token, sin importar el body. Global: la que venga en el body (o 1).
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(crearVenta(DB, { ...req.body, sucursal_id }));
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
    res.json(cancelarVenta(DB, req.params.id, req.body.motivo));
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
  // El corte en curso es siempre de UNA sucursal concreta. Global sin elegir → default a la 1.
  const sucursal_id = alcance.verTodas ? (Number(req.query.sucursal_id) || 1) : alcance.sucursalId;
  const resultado = calcularCorteEnCurso(DB, sucursal_id);
  res.json(filtrarCorteEnCursoPorPermiso(resultado, permisos));
});
app.get("/api/cortes", requiereLogin, requierePermiso("ver_historial_cortes", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarCortes(DB, alcance.verTodas ? undefined : alcance.sucursalId));
});
app.post("/api/cortes", requiereLogin, requierePermiso("realizar_corte_caja", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(crearCorte(DB, {
      ...req.body,
      sucursal_id,
      usuario_id: req.usuarioToken?.id ?? null,
      usuario_nombre: req.usuarioToken?.nombre || req.body.usuario_nombre || "—",
    }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});


// ---------- Condiciones por forma de pago (configurable por sucursal) ----------
app.get("/api/condiciones-pago", requiereLogin, (req, res) => {
  const sucursal_id = req.query.sucursal_id ? Number(req.query.sucursal_id) : 1;
  res.json(listarCondiciones(DB, sucursal_id));
});
app.put("/api/condiciones-pago/:id", requiereLogin, requierePermiso("editar_configuracion_pos", resolverPermisosDeRol), (req, res) => {
  try { res.json(actualizarCondicion(DB, req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/chat", requiereLogin, requierePermiso("usar_asistente_ia", resolverPermisosDeRol), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Falta configurar ANTHROPIC_API_KEY en el archivo .env del backend" });
    }

    const { mensajes } = req.body; // [{ role: 'user'|'assistant', content: 'texto' }]
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
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
            resultado = consultarModulo(bloque.input, alcance, DB);
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

// ─────────────────────────────────────────────────────────────────────────────

const PUERTO = process.env.PORT || 4000;

// Guardia obligatorio: si algún módulo/permiso no está bien registrado para
// Roles y Personal, esto lanza un error y el backend NO levanta.
validarSistemaDePermisos();

app.listen(PUERTO, () => {
  console.log(`Backend corriendo en http://localhost:${PUERTO}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  No hay ANTHROPIC_API_KEY configurada — copia .env.example a .env y pega tu key");
  }
  if (!process.env.JWT_SECRET) {
    console.log("🚨 JWT_SECRET no configurado — usando clave temporal. Los tokens se invalidan al reiniciar el servidor. Configura JWT_SECRET en las variables de entorno de Render.");
  }
});
