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
const {
  listarProductos, crearProducto, actualizarProducto, eliminarProducto,
  clonarProducto, ajustarExistencia, listarCategorias, crearCategoria, generarClave
} = require("./productos");
const { listarClientes, obtenerCliente, crearCliente, actualizarCliente } = require("./clientes");
const {
  listarClientesCRM, obtenerClienteCRM, cambiarEstadoCliente,
  registrarContacto, listarContactos, resumenPorSucursal, rankingVendedores,
  obtenerSeguimientosPostventaPendientes
} = require("./crm");
const { crearVenta, listarVentas, obtenerVentaDetalle, cancelarVenta } = require("./ventas");
const { obtenerConfiguracion, actualizarConfiguracion } = require("./configuracion");
const { calcularCorteEnCurso, crearCorte, listarCortes } = require("./cortes");
const { listarCondiciones, actualizarCondicion } = require("./condicionesPago");
const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");
const { validarSistemaDePermisos } = require("./validarPermisos");
const { requiereLogin, requierePermiso, firmarToken, alcanceSucursal } = require("./auth");
const { consultarModulo } = require("./consultarModulo");
const { listarRoles, obtenerRol, permisosDeRol, crearRol, actualizarRol, eliminarRol, clonarRol, sembrarRolesIniciales } = require("./roles");
const { listarUsuarios, crearUsuario, actualizarUsuario, iniciarSesion } = require("./usuarios");

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic(); // lee ANTHROPIC_API_KEY de .env

// ============================================================
// DATOS DE PRUEBA (mismos que ya validamos en el kit anterior)
// ============================================================
const DB = {
  pos: {
    ventas: [
      { id: 1, fecha: "2026-05-10", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 1200, metodo_pago: "efectivo", estatus: "cerrada" },
      { id: 2, fecha: "2026-05-20", sucursal_id: 1, vendedor_id: 2, cliente_id: 2, total: 800, metodo_pago: "tarjeta", estatus: "cerrada" },
      { id: 3, fecha: "2026-06-05", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 2100, metodo_pago: "efectivo", estatus: "cerrada" },
      { id: 4, fecha: "2026-06-18", sucursal_id: 1, vendedor_id: 2, cliente_id: 2, total: 950, metodo_pago: "efectivo", estatus: "cerrada" },
      { id: 5, fecha: "2026-06-25", sucursal_id: 1, vendedor_id: 1, cliente_id: 2, total: 1750, metodo_pago: "tarjeta", estatus: "cerrada" }
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
      { id: 1, nombre: "Ocosingo", ciudad: "Chiapas" },
      { id: 2, nombre: "Yajalón", ciudad: "Chiapas" },
      { id: 3, nombre: "San Cristóbal", ciudad: "Chiapas" },
      { id: 4, nombre: "Palenque", ciudad: "Chiapas" }
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
        fecha_alta: "2025-06-15", vendedor_asignado_id: 2, sucursal_id: 1,
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
      { producto_id: 4, sucursal_id: 1, cantidad_actual: 200, cantidad_minima: 50, cantidad_maxima: 500 }
    ],
    movimientos_inventario: [],
    compras: [],
    compra_detalle: []
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
    producto_proveedor: []
  },
  admin: {
    roles: [],
    usuarios: []
  }
};

sembrarRolesIniciales(DB);

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

app.get("/api/salud", (req, res) => res.json({ ok: true, modulos: listarModulosYTablas() }));

app.get("/api/predicciones", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const { producto_id, categoria_id, meses_adelante } = req.query;
  // Para el amarrado, se predice solo sobre las ventas de su sucursal.
  const DBScope = alcance.verTodas
    ? DB
    : { ...DB, pos: { ...DB.pos, ventas: DB.pos.ventas.filter((v) => Number(v.sucursal_id) === alcance.sucursalId) } };
  const resultado = predecirDemanda(DBScope, {
    producto_id: producto_id ? Number(producto_id) : undefined,
    categoria_id: categoria_id ? Number(categoria_id) : undefined,
    meses_adelante: meses_adelante ? Number(meses_adelante) : undefined
  });
  res.json(resultado);
});

// ---------- Catálogo de productos / inventario (CRUD real) ----------
app.get("/api/productos", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  // Amarrado o global-con-sucursal: existencia de esa sucursal. Global "todas": suma (null).
  const sucursalId = alcance.verTodas ? null : alcance.sucursalId;
  res.json(listarProductos(DB, sucursalId));
});

app.post("/api/productos", requiereLogin, requierePermiso("crear_producto", resolverPermisosDeRol), (req, res) => {
  try { res.json(crearProducto(DB, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/productos/:id", requiereLogin, requierePermiso("editar_producto", resolverPermisosDeRol), (req, res) => {
  try { res.json(actualizarProducto(DB, req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/productos/:id", requiereLogin, requierePermiso("eliminar_producto", resolverPermisosDeRol), (req, res) => {
  try { eliminarProducto(DB, req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/productos/:id/clonar", requiereLogin, requierePermiso("clonar_producto", resolverPermisosDeRol), (req, res) => {
  try { res.json(clonarProducto(DB, req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
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

app.get("/api/categorias", (req, res) => res.json(listarCategorias(DB)));
app.post("/api/categorias", (req, res) => {
  try { res.json(crearCategoria(DB, req.body.nombre)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/proveedores", (req, res) => res.json(DB["catalogo-productos"].proveedores));

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
    const { usuario, password } = req.body;
    const encontrado = await iniciarSesion(DB, usuario, password);
    const token = firmarToken(encontrado);
    const rol = obtenerRol(DB, encontrado.rol_id);
    res.json({ token, usuario: { id: encontrado.id, nombre: encontrado.nombre, rol: rol.nombre, rol_id: rol.id, permisos: rol.permisos, modulos: rol.modulos } });
  } catch (e) { res.status(401).json({ error: e.message }); }
});

app.get("/api/auth/yo", requiereLogin, (req, res) => {
  try {
    const usuario = DB.admin.usuarios.find((u) => u.id === req.usuarioToken.id);
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
    const rol = obtenerRol(DB, usuario.rol_id);
    res.json({ id: usuario.id, nombre: usuario.nombre, rol: rol.nombre, rol_id: rol.id, permisos: rol.permisos, modulos: rol.modulos });
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
app.post("/api/usuarios", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), async (req, res) => {
  try { res.json(await crearUsuario(DB, req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put("/api/usuarios/:id", requiereLogin, requierePermiso("administrar_roles", resolverPermisosDeRol), (req, res) => {
  try { res.json(actualizarUsuario(DB, req.params.id, req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Clientes ----------
app.get("/api/clientes", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarClientes(DB, alcance));
});
app.get("/api/clientes/:id", (req, res) => {
  try { res.json(obtenerCliente(DB, req.params.id)); }
  catch (e) { res.status(404).json({ error: e.message }); }
});
app.post("/api/clientes", requiereLogin, requierePermiso("crear_cliente", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    res.json(crearCliente(DB, { ...req.body, sucursal_id }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put("/api/clientes/:id", (req, res) => {
  try { res.json(actualizarCliente(DB, req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Vendedores y Sucursales (catálogo compartido) ----------
app.get("/api/vendedores", (req, res) => res.json(DB.pos.vendedores));
app.get("/api/sucursales", (req, res) => res.json(DB.pos.sucursales));

// ---------- CRM (clientes enriquecidos con ventas reales del POS) ----------
app.get("/api/crm/clientes", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarClientesCRM(DB, alcance));
});
app.get("/api/crm/clientes/:id", (req, res) => {
  try { res.json(obtenerClienteCRM(DB, req.params.id)); }
  catch (e) { res.status(404).json({ error: e.message }); }
});
app.put("/api/crm/clientes/:id/estado", requiereLogin, requierePermiso("cambiar_estado_cliente", resolverPermisosDeRol), (req, res) => {
  try { res.json(cambiarEstadoCliente(DB, req.params.id, req.body.estado)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/crm/clientes/:id/contactos", (req, res) => res.json(listarContactos(DB, req.params.id)));
app.post("/api/crm/clientes/:id/contactos", requiereLogin, requierePermiso("registrar_contacto_cliente", resolverPermisosDeRol), (req, res) => {
  try { res.json(registrarContacto(DB, req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
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
app.get("/api/ventas", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  const filtros = { ...req.query };
  if (alcance.verTodas) delete filtros.sucursal_id;
  else filtros.sucursal_id = alcance.sucursalId;
  res.json(listarVentas(DB, filtros));
});
app.get("/api/ventas/:id", (req, res) => {
  try { res.json(obtenerVentaDetalle(DB, req.params.id)); }
  catch (e) { res.status(404).json({ error: e.message }); }
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
  try { res.json(cancelarVenta(DB, req.params.id, req.body.motivo)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Configuración general del POS ----------
app.get("/api/configuracion", (req, res) => res.json(obtenerConfiguracion(DB)));
app.put("/api/configuracion", requiereLogin, requierePermiso("editar_configuracion_pos", resolverPermisosDeRol), (req, res) => {
  try { res.json(actualizarConfiguracion(DB, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Corte de Caja ----------
app.get("/api/cortes/en-curso", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  // El corte en curso es siempre de UNA sucursal concreta. Global sin elegir → default a la 1.
  const sucursal_id = alcance.verTodas ? (Number(req.query.sucursal_id) || 1) : alcance.sucursalId;
  res.json(calcularCorteEnCurso(DB, sucursal_id));
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
app.get("/api/condiciones-pago", (req, res) => {
  const sucursal_id = req.query.sucursal_id ? Number(req.query.sucursal_id) : 1;
  res.json(listarCondiciones(DB, sucursal_id));
});
app.put("/api/condiciones-pago/:id", (req, res) => {
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

const PUERTO = 4000;

// Guardia obligatorio: si algún módulo/permiso no está bien registrado para
// Roles y Personal, esto lanza un error y el backend NO levanta.
validarSistemaDePermisos();

app.listen(PUERTO, () => {
  console.log(`Backend corriendo en http://localhost:${PUERTO}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  No hay ANTHROPIC_API_KEY configurada — copia .env.example a .env y pega tu key");
  }
});
