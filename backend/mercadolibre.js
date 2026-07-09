/**
 * mercadolibre.js — Integración con la API de MercadoLibre México.
 * MercadoLibre se trata como una sucursal virtual (id=5) dentro del sistema.
 *
 * Variables de entorno requeridas:
 *   ML_CLIENT_ID     — App ID de tu aplicación en developers.mercadolibre.com.mx
 *   ML_CLIENT_SECRET — Secret Key de tu aplicación
 *   ML_REDIRECT_URI  — URL de callback registrada en tu app de ML
 *                      (ej: https://punto-de-venta-backend.onrender.com/api/ml/callback)
 */

const ML_API  = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolibre.com.mx/authorization";

function mlHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ── Token helpers ──────────────────────────────────────────────────────────────

async function intercambiarCodigo(DB, codigo, redirectUri) {
  const params = new URLSearchParams({
    grant_type:    "authorization_code",
    client_id:     process.env.ML_CLIENT_ID,
    client_secret: process.env.ML_CLIENT_SECRET,
    code:          codigo,
    redirect_uri:  redirectUri,
  });
  const r = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params,
  });
  if (!r.ok) throw new Error("ML OAuth error: " + (await r.text()));
  const d = await r.json();
  DB.ml.cuenta = {
    access_token:  d.access_token,
    refresh_token: d.refresh_token,
    user_id:       d.user_id,
    expires_at:    Date.now() + d.expires_in * 1000,
    conectado_en:  new Date().toISOString(),
  };
  return DB.ml.cuenta;
}

async function refrescarToken(DB) {
  if (!DB.ml.cuenta?.refresh_token) throw new Error("Sin cuenta ML conectada");
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.ML_CLIENT_ID,
    client_secret: process.env.ML_CLIENT_SECRET,
    refresh_token: DB.ml.cuenta.refresh_token,
  });
  const r = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!r.ok) throw new Error("Error al refrescar token ML");
  const d = await r.json();
  DB.ml.cuenta.access_token = d.access_token;
  DB.ml.cuenta.expires_at   = Date.now() + d.expires_in * 1000;
  if (d.refresh_token) DB.ml.cuenta.refresh_token = d.refresh_token;
  return DB.ml.cuenta.access_token;
}

async function tokenActivo(DB) {
  if (!DB.ml?.cuenta?.access_token) throw new Error("No hay cuenta de MercadoLibre conectada");
  if (Date.now() > DB.ml.cuenta.expires_at - 120_000) await refrescarToken(DB);
  return DB.ml.cuenta.access_token;
}

function urlAutorizacion(redirectUri) {
  if (!process.env.ML_CLIENT_ID) throw new Error("ML_CLIENT_ID no configurado en variables de entorno");
  return `${ML_AUTH}?response_type=code&client_id=${process.env.ML_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

// ── Publicaciones ──────────────────────────────────────────────────────────────

async function listarPublicaciones(DB) {
  const token  = await tokenActivo(DB);
  const userId = DB.ml.cuenta.user_id;
  // Buscar ítems activos y pausados
  const [rAct, rPau] = await Promise.all([
    fetch(`${ML_API}/users/${userId}/items/search?status=active&limit=50`, { headers: mlHeaders(token) }),
    fetch(`${ML_API}/users/${userId}/items/search?status=paused&limit=50`, { headers: mlHeaders(token) }),
  ]);
  const ids = [
    ...((await rAct.json()).results || []),
    ...((await rPau.json()).results || []),
  ];
  if (!ids.length) return [];
  // ML permite pedir hasta 20 ítems por batch
  const lotes  = [];
  for (let i = 0; i < ids.length; i += 20) lotes.push(ids.slice(i, i + 20));
  const items  = [];
  for (const lote of lotes) {
    const r = await fetch(
      `${ML_API}/items?ids=${lote.join(",")}&attributes=id,title,price,available_quantity,status,thumbnail,permalink,seller_sku,pictures`,
      { headers: mlHeaders(token) }
    );
    const data = await r.json();
    items.push(...data.map((x) => x.body).filter(Boolean));
  }
  return items;
}

async function publicarProducto(DB, productoId, datos) {
  const token   = await tokenActivo(DB);
  const prod    = DB["catalogo-productos"].productos.find((p) => p.id === Number(productoId));
  if (!prod) throw new Error("Producto no encontrado en el catálogo");

  const body = {
    title:              datos.titulo      || prod.nombre,
    category_id:        datos.categoria_ml,
    price:              Number(datos.precio) || prod.precio_venta,
    currency_id:        "MXN",
    available_quantity: Number(datos.cantidad) || 1,
    buying_mode:        "buy_it_now",
    listing_type_id:    datos.tipo_publicacion || "gold_special",
    condition:          "new",
    seller_sku:         prod.sku || String(prod.id),
    description:        { plain_text: datos.descripcion || prod.nombre },
    pictures:           datos.foto_url ? [{ source: datos.foto_url }] : [],
  };

  const r = await fetch(`${ML_API}/items`, {
    method:  "POST",
    headers: mlHeaders(token),
    body:    JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || `Error ML ${r.status}`);
  }
  const item = await r.json();

  // Registrar en DB local
  const existente = DB.ml.publicaciones.findIndex((p) => p.producto_id === prod.id);
  const registro  = {
    ml_item_id:  item.id,
    producto_id: prod.id,
    titulo:      item.title,
    precio:      item.price,
    cantidad:    item.available_quantity,
    estado:      item.status,
    permalink:   item.permalink,
    sincronizado: new Date().toISOString(),
  };
  if (existente >= 0) DB.ml.publicaciones[existente] = registro;
  else DB.ml.publicaciones.push(registro);

  // Descontar del inventario ML (sucursal 5)
  const exML = DB.inventario.existencias.find(
    (e) => e.producto_id === prod.id && e.sucursal_id === 5
  );
  if (exML) exML.cantidad_actual = item.available_quantity;
  else DB.inventario.existencias.push({
    producto_id: prod.id, sucursal_id: 5,
    cantidad_actual: item.available_quantity, cantidad_minima: 0, cantidad_maxima: 9999,
  });

  return item;
}

async function actualizarStockML(DB, mlItemId, cantidad) {
  const token = await tokenActivo(DB);
  const r = await fetch(`${ML_API}/items/${mlItemId}`, {
    method:  "PUT",
    headers: mlHeaders(token),
    body:    JSON.stringify({ available_quantity: cantidad }),
  });
  if (!r.ok) throw new Error("Error al actualizar stock en ML");
  const pub = DB.ml.publicaciones.find((p) => p.ml_item_id === mlItemId);
  if (pub) { pub.cantidad = cantidad; pub.sincronizado = new Date().toISOString(); }
  return await r.json();
}

async function actualizarPublicacion(DB, mlItemId, cambios) {
  const token = await tokenActivo(DB);
  const { descripcion, imagenes, ...campos } = cambios;

  const body = {};
  if (campos.title              !== undefined) body.title              = campos.title;
  if (campos.price              !== undefined) body.price              = Number(campos.price);
  if (campos.available_quantity !== undefined) body.available_quantity = Number(campos.available_quantity);
  if (campos.status             !== undefined) body.status             = campos.status;
  if (Array.isArray(imagenes)) {
    body.pictures = imagenes.filter(Boolean).map((u) => ({ source: u }));
  }

  if (Object.keys(body).length > 0) {
    const r = await fetch(`${ML_API}/items/${mlItemId}`, {
      method: "PUT", headers: mlHeaders(token), body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || `Error ML ${r.status}`);
    }
  }

  // Descripción va en endpoint separado
  if (descripcion !== undefined) {
    await fetch(`${ML_API}/items/${mlItemId}/description`, {
      method: "PUT", headers: mlHeaders(token),
      body: JSON.stringify({ plain_text: descripcion }),
    });
  }

  // Sincronizar registro local
  const pub = DB.ml.publicaciones.find((p) => p.ml_item_id === mlItemId);
  if (pub) {
    if (body.title)              pub.titulo   = body.title;
    if (body.price)              pub.precio   = body.price;
    if (body.available_quantity !== undefined) pub.cantidad = body.available_quantity;
    if (body.status)             pub.estado   = body.status;
    pub.sincronizado = new Date().toISOString();
  }
  return { ok: true };
}

// ── Órdenes ───────────────────────────────────────────────────────────────────

async function listarOrdenes(DB, limite = 50) {
  const token  = await tokenActivo(DB);
  const userId = DB.ml.cuenta.user_id;
  const r = await fetch(
    `${ML_API}/orders/search?seller=${userId}&sort=date_desc&limit=${limite}`,
    { headers: mlHeaders(token) }
  );
  if (!r.ok) throw new Error("Error al obtener órdenes de ML");
  const data = await r.json();
  return data.results || [];
}

async function importarOrdenComoVenta(DB, ordenId) {
  const token = await tokenActivo(DB);
  const r = await fetch(`${ML_API}/orders/${ordenId}`, { headers: mlHeaders(token) });
  if (!r.ok) throw new Error("Error al obtener orden de ML");
  const orden = await r.json();

  // Verificar que no esté ya importada
  if (DB.ml.ordenes_importadas.includes(ordenId)) {
    throw new Error("Esta orden ya fue importada");
  }

  // Mapear ítems ML → productos locales por SKU
  const lineas = [];
  for (const item of orden.order_items) {
    const sku   = item.item?.seller_sku || item.item?.id;
    const prod  = DB["catalogo-productos"].productos.find(
      (p) => p.sku === sku || String(p.id) === sku
    );
    lineas.push({
      producto_id:     prod ? prod.id : null,
      ml_item_id:      item.item?.id,
      nombre:          item.item?.title,
      cantidad:        item.quantity,
      precio_unitario: item.unit_price,
      subtotal:        item.quantity * item.unit_price,
    });
  }

  // Crear venta en sucursal ML (id=5)
  const sigId = DB.pos.ventas.length
    ? Math.max(...DB.pos.ventas.map((v) => v.id)) + 1 : 1;
  const venta = {
    id:          sigId,
    fecha:       orden.date_created?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    sucursal_id: 5,
    vendedor_id: null,
    cliente_id:  0,
    total:       orden.total_amount,
    metodo_pago: "mercadolibre",
    estatus:     "cerrada",
    referencia:  `ML-${orden.id}`,
  };
  DB.pos.ventas.push(venta);

  // Detalles
  let sigDetId = DB.pos.venta_detalle.length
    ? Math.max(...DB.pos.venta_detalle.map((d) => d.id)) + 1 : 1;
  for (const l of lineas) {
    DB.pos.venta_detalle.push({
      id: sigDetId++, venta_id: sigId,
      producto_id: l.producto_id, cantidad: l.cantidad,
      precio_unitario: l.precio_unitario, descuento: 0, subtotal: l.subtotal,
    });
    // Descontar inventario ML
    if (l.producto_id) {
      const ex = DB.inventario.existencias.find(
        (e) => e.producto_id === l.producto_id && e.sucursal_id === 5
      );
      if (ex) ex.cantidad_actual = Math.max(0, ex.cantidad_actual - l.cantidad);
    }
  }
  DB.ml.ordenes_importadas.push(ordenId);
  return venta;
}

module.exports = {
  intercambiarCodigo, urlAutorizacion, tokenActivo,
  listarPublicaciones, publicarProducto, actualizarStockML, actualizarPublicacion,
  listarOrdenes, importarOrdenComoVenta,
};
