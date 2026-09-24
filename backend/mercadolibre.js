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

const { fechaLocal } = require("./fechas");
const { cajaPredeterminadaDeSucursal } = require("./cajas");

const { ajustarExistencia } = require("./productos");
const { exigirCantidad, exigirImporte } = require("./importes");

const ML_API  = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolibre.com.mx/authorization";
const SUCURSAL_ML = 5;

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

/**
 * Una orden solo se importa si esta PAGADA.
 *
 * `importarOrdenComoVenta` nunca miraba `orden.status` ni los pagos: traia la
 * orden y la creaba como venta `cerrada`, descontando inventario. Una orden
 * cancelada o pendiente de pago entraba igual, y con ella salia mercancia del
 * inventario por dinero que nunca llego. No inventa efectivo en el cajon
 * —`metodo_pago: "mercadolibre"` cae en transferencias— pero si falsea el
 * inventario y la utilidad.
 *
 * Se deja como funcion pura y aparte para poder probarla sin red.
 */
function validarOrdenImportable(orden) {
  const estado = String(orden?.status || "").toLowerCase();
  if (estado !== "paid") {
    throw new Error(`La orden de MercadoLibre no está pagada (estado: ${estado || "desconocido"}) — no se importa hasta que el pago se confirme`);
  }
  return orden;
}

/**
 * Mapea los items de una orden de ML a lineas de venta, y REPORTA cuales no
 * encontraron producto en el catalogo.
 *
 * Antes esto vivia dentro de `importarOrdenComoVenta` y hacia
 * `producto_id: prod ? prod.id : null` sin decirselo a nadie. Un SKU sin
 * vincular quedaba en null, y mas abajo `if (l.producto_id)` es lo que dispara
 * el descuento: la mercancia salia y la existencia no bajaba. Sacarlo aqui
 * permite probarlo sin tocar la red y, sobre todo, DEVOLVER los que fallaron.
 */
function mapearLineasDeOrden(DB, orden) {
  const lineas = [];
  const sinVincular = [];
  for (const item of orden.order_items || []) {
    const sku = item.item?.seller_sku || item.item?.id;
    const prod = DB["catalogo-productos"].productos.find(
      (p) => p.sku === sku || String(p.id) === sku
    );
    if (!prod) {
      sinVincular.push({ sku, ml_item_id: item.item?.id, nombre: item.item?.title, cantidad: item.quantity });
    }
    // La orden viene de fuera: cantidad, precio y su producto se validan igual
    // que en una venta de mostrador. Se rechaza ANTES de escribir nada y sin
    // marcar la orden como importada, así que se puede reintentar cuando el
    // dato venga bien. Lo que no se valida aquí llegaría al corte de la
    // sucursal de MercadoLibre convertido en una cifra que no es un número.
    const nombreItem = item.item?.title || sku;
    const cantidad = exigirCantidad(item.quantity, nombreItem);
    const precio = Number(item.unit_price);
    if (item.unit_price === null || item.unit_price === "" || !Number.isFinite(precio) || precio < 0) {
      throw new Error(`El precio que mandó MercadoLibre para "${nombreItem}" no es un número válido`);
    }
    exigirImporte(cantidad * precio, nombreItem);
    lineas.push({
      producto_id:     prod ? prod.id : null,
      ml_item_id:      item.item?.id,
      nombre:          item.item?.title,
      cantidad,
      precio_unitario: precio,
      subtotal:        cantidad * precio,
    });
  }
  return { lineas, sinVincular };
}

/**
 * Decision de Victor del 2026-09-12: si el producto YA esta vinculado y no hay
 * existencia suficiente, la orden se RECHAZA y no se escribe nada.
 *
 * Se asume la consecuencia: esa venta, cobrada en ML, no queda registrada y el
 * corte de la sucursal 5 no la cuenta mientras dure el rechazo. Lo que lo hace
 * aceptable es que sea RECUPERABLE: la orden no se marca como importada, asi
 * que en cuanto se ajuste la existencia se vuelve a importar sola.
 *
 * Un producto vinculado sin existencia quiere decir que el inventario ya estaba
 * mal antes de la venta. El sistema lo senala en vez de hundirlo en negativo.
 *
 * Los renglones sin `producto_id` se saltan a proposito: esos se importan y van
 * a la lista de pendientes (Task 3).
 */
function validarExistenciaDeOrden(DB, lineas) {
  const pedidoPorProducto = new Map();
  for (const l of lineas) {
    if (!l.producto_id) continue;
    pedidoPorProducto.set(l.producto_id, (pedidoPorProducto.get(l.producto_id) || 0) + Number(l.cantidad || 0));
  }
  for (const [productoId, pedida] of pedidoPorProducto) {
    const exist = DB.inventario.existencias.find(
      (e) => e.producto_id === Number(productoId) && e.sucursal_id === SUCURSAL_ML
    );
    const hay = exist ? Number(exist.cantidad_actual) : 0;
    if (hay < pedida) {
      const prod = DB["catalogo-productos"].productos.find((p) => p.id === Number(productoId));
      const nombre = prod ? prod.nombre : `producto ${productoId}`;
      throw new Error(
        `No alcanza la existencia de "${nombre}" en MercadoLibre: la orden pide ${pedida} y hay ${hay}. ` +
        `Ajusta la existencia y vuelve a importar la orden — no se guardó nada.`
      );
    }
  }
}

/**
 * Decision de Victor del 2026-09-12: una orden con el SKU sin vincular SI se
 * importa —el dinero ya entro en ML y el corte de la sucursal 5 lo espera— pero
 * deja de ser invisible. Aqui es donde deja de serlo.
 *
 * Sin esta lista, la unica huella de que salio mercancia sin descontar era un
 * `console.error` que nadie lee.
 */
function registrarPendientesDeVinculo(DB, { ordenId, ventaId, sinVincular }) {
  if (!Array.isArray(DB.ml.pendientes_vinculo)) DB.ml.pendientes_vinculo = [];
  let sigId = DB.ml.pendientes_vinculo.length
    ? Math.max(...DB.ml.pendientes_vinculo.map((p) => p.id)) + 1 : 1;
  for (const s of sinVincular || []) {
    DB.ml.pendientes_vinculo.push({
      id: sigId++,
      orden_id: ordenId,
      venta_id: ventaId,
      sku: s.sku,
      ml_item_id: s.ml_item_id,
      nombre: s.nombre,
      cantidad: s.cantidad,
      fecha: new Date().toISOString(),
      resuelto: false,
    });
  }
}

/**
 * Cierra un pendiente: liga el renglon al producto y descuenta lo que la venta
 * saco de la bodega.
 *
 * Todo se valida ANTES de mutar y el orden es sincrono (validar -> descontar ->
 * marcar). Es la misma leccion de la Task 9 de las fugas del 2026-09-08: alli un
 * `await` a Drive entre revisar y borrar dejaba pasar dos borrados simultaneos.
 * Aqui no hay nada externo en medio, y no debe haberlo.
 */
function resolverPendienteVinculo(DB, pendienteId, productoId, usuario) {
  const pendiente = (DB.ml.pendientes_vinculo || []).find((p) => p.id === Number(pendienteId));
  if (!pendiente) throw new Error("Ese pendiente de MercadoLibre no existe");
  if (pendiente.resuelto) throw new Error("Ese pendiente ya fue resuelto: la mercancía ya se descontó");

  const prod = DB["catalogo-productos"].productos.find((p) => p.id === Number(productoId));
  if (!prod) throw new Error("El producto al que quieres vincular no existe en el catálogo");

  const exist = DB.inventario.existencias.find(
    (e) => e.producto_id === Number(productoId) && e.sucursal_id === SUCURSAL_ML
  );
  const hay = exist ? Number(exist.cantidad_actual) : 0;
  if (hay < Number(pendiente.cantidad)) {
    throw new Error(
      `No alcanza la existencia de "${prod.nombre}" en MercadoLibre: hacen falta ${pendiente.cantidad} y hay ${hay}.`
    );
  }

  const detalle = DB.pos.venta_detalle.find(
    (d) => d.venta_id === pendiente.venta_id
      && d.producto_id === null
      && pendiente.ml_item_id != null
      && d.ml_item_id != null
      && String(d.ml_item_id) === String(pendiente.ml_item_id)
  );
  if (!detalle) throw new Error("No se encontró el renglón exacto de la venta para este pendiente");

  ajustarExistencia(DB, Number(productoId), {
    cantidad: -Number(pendiente.cantidad),
    motivo: `Venta MercadoLibre — orden ${pendiente.orden_id} (vinculada después)`,
    sucursal_id: SUCURSAL_ML,
    usuario: usuario || { nombre: "MercadoLibre" },
  });

  detalle.producto_id = Number(productoId);

  pendiente.resuelto = true;
  pendiente.resuelto_fecha = new Date().toISOString();
  pendiente.resuelto_por = (usuario && usuario.nombre) || "desconocido";
  pendiente.producto_id = Number(productoId);
  return pendiente;
}

async function importarOrdenComoVenta(DB, ordenId) {
  const token = await tokenActivo(DB);
  const r = await fetch(`${ML_API}/orders/${ordenId}`, { headers: mlHeaders(token) });
  if (!r.ok) throw new Error("Error al obtener orden de ML");
  const orden = await r.json();

  // GARANTÍA DE CONCURRENCIA: desde esta comprobación hasta
  // DB.ml.ordenes_importadas.push(ordenId) no debe haber ningún await. Eso es lo
  // único que evita que dos solicitudes simultáneas importen dos veces la orden;
  // mercadolibreDobleImportacion.test.js lo vigila. Si hace falta esperar algo
  // aquí, primero hay que implementar un bloqueo real.
  if (DB.ml.ordenes_importadas.includes(ordenId)) {
    throw new Error("Esta orden ya fue importada");
  }

  validarOrdenImportable(orden);

  // Mapear ítems ML → productos locales por SKU
  const { lineas, sinVincular } = mapearLineasDeOrden(DB, orden);
  validarExistenciaDeOrden(DB, lineas);   // lanza y corta aqui: nada escrito todavia

  // Buscar o crear comprador en el CRM (sucursal ML = 5)
  let clienteId = 0;
  if (orden.buyer) {
    const clave = `ML-${orden.buyer.id}`;
    let cliente = DB.crm.clientes.find((c) => c.clave === clave);
    if (!cliente) {
      const nuevoId = DB.crm.clientes.length
        ? Math.max(...DB.crm.clientes.map((c) => c.id)) + 1 : 1;
      const nombre = [orden.buyer.first_name, orden.buyer.last_name]
        .filter(Boolean).join(" ").trim() || orden.buyer.nickname || "Comprador ML";
      cliente = {
        id: nuevoId, clave,
        representante: orden.buyer.nickname || nombre,
        nombre,
        tipo: "menudeo", rfc: "XAXX010101000",
        email: orden.buyer.email || "", telefono: "", celular: "",
        sujeto_credito: false, precio_lista: 1, dias_credito: 0, limite_credito: 0,
        monedero: 0, saldo: 0, saldo_vencido: 0, fecha_vencimiento: null,
        fecha_alta: fechaLocal(),
        vendedor_asignado_id: null, sucursal_id: 5,
        estado: "compro",
        // No usamos orden.date_created?.slice(0, 10): eso asume que ML siempre manda
        // el ISO con el desfase local incrustado (...-06:00). Ese contrato no está
        // fijado en ningún lado del repo, y si algún día ML normaliza a "Z" (UTC),
        // el slice metería compras de la noche en el día siguiente — el mismo bug
        // que fechaLocal() ya resuelve para el resto del sistema. fechaLocal()
        // acierta en los dos casos:
        //   fechaLocal("2026-07-31T20:56:35.000-06:00") === "2026-07-31" (con desfase)
        //   fechaLocal("2026-08-01T02:56:35.000Z")      === "2026-07-31" (normalizado a Z)
        // Si orden.date_created viene vacío/ausente, fechaLocal(undefined) cae en HOY,
        // igual que el `|| fechaLocal()` que tenía este respaldo antes.
        ultimo_contacto: fechaLocal(orden.date_created),
        ubicacion: "MercadoLibre",
      };
      DB.crm.clientes.push(cliente);
    } else {
      cliente.estado = "compro";
      // Mismo razonamiento que en ultimo_contacto de arriba: fechaLocal() no depende
      // de que ML mande el desfase incrustado, y cae en HOY si date_created falta.
      cliente.ultimo_contacto = fechaLocal(orden.date_created);
    }
    clienteId = cliente.id;
  }

  // Crear venta en sucursal ML (id=5)
  const sigId = DB.pos.ventas.length
    ? Math.max(...DB.pos.ventas.map((v) => v.id)) + 1 : 1;
  const caja = cajaPredeterminadaDeSucursal(DB, 5);
  const venta = {
    id:          sigId,
    // Mismo razonamiento que en ultimo_contacto (ver comentario arriba): fechaLocal()
    // da el día correcto sin importar si ML manda el desfase local incrustado o
    // normaliza a "Z", y cae en HOY si orden.date_created falta.
    fecha:       fechaLocal(orden.date_created),
    // El corte mide cuando el dinero entra a la contabilidad de la tienda,
    // no cuando ML creó la orden. Usar date_created permitiría que una orden
    // antigua importada hoy quedara antes de la época y del último corte.
    fecha_hora:  new Date().toISOString(),
    sucursal_id: 5,
    caja_id:     caja?.id ?? null,
    vendedor_id: null,
    cliente_id:  clienteId,
    // El total NO sale de las líneas: lo manda MercadoLibre, y es el que entra
    // al corte de la sucursal 5. Validar las líneas no lo cubría: con un total
    // disparatado la venta se guardaba, la orden quedaba marcada como importada
    // —o sea, irrecuperable— y el corte de ML se quedaba sin cifra.
    total:       exigirImporte(orden.total_amount, `la orden de MercadoLibre ${ordenId}`),
    metodo_pago: "mercadolibre",
    // "Ticket" y no un valor propio como "MercadoLibre": los tipos de documento
    // son una lista cerrada que las pantallas usan para filtrar, y un valor que
    // no está en ella deja estas ventas invisibles en todos los filtros salvo
    // "Todos". El origen igual es inconfundible por `referencia` (ML-xxxx) y por
    // `metodo_pago`. Lo que NO puede ser es "Apartado": ese valor tiene
    // significado propio en el corte, que excluye su total para contar solo los
    // abonos (backend/cortes.js).
    tipo_documento: "Ticket",
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
      producto_id: l.producto_id, ml_item_id: l.ml_item_id, cantidad: l.cantidad,
      precio_unitario: l.precio_unitario, descuento: 0, subtotal: l.subtotal,
    });
    // Descontar inventario ML por el MISMO camino que todo lo demas.
    //
    // Antes se escribia la existencia a mano y con `Math.max(0, ...)`: no
    // generaba movimiento —era el unico cambio de inventario del sistema sin
    // rastro— y recortaba a cero, que es justo lo que el comentario de
    // `ajustarExistencia` dice que NO hay que hacer: al recortar se pierde
    // informacion, y si despues se cancela la venta el reintegro parte de un
    // punto falso y crea inventario de la nada.
    if (l.producto_id) {
      try {
        ajustarExistencia(DB, l.producto_id, {
          cantidad: -l.cantidad,
          motivo: `Venta MercadoLibre — orden ${ordenId}`,
          sucursal_id: 5,
          usuario: { nombre: "MercadoLibre" },
        });
      } catch (e) {
        console.error(`[inventario] la orden ML ${ordenId} no pudo descontar el producto ${l.producto_id}: ${e.message}`);
        registrarPendientesDeVinculo(DB, {
          ordenId, ventaId: venta.id,
          sinVincular: [{ sku: l.ml_item_id, ml_item_id: l.ml_item_id, nombre: `${l.nombre} — no se pudo descontar: ${e.message}`, cantidad: l.cantidad }],
        });
      }
    }
  }
  DB.ml.ordenes_importadas.push(ordenId);
  registrarPendientesDeVinculo(DB, { ordenId, ventaId: venta.id, sinVincular });
  return venta;
}

module.exports = {
  intercambiarCodigo, urlAutorizacion, tokenActivo,
  listarPublicaciones, publicarProducto, actualizarStockML, actualizarPublicacion,
  listarOrdenes, importarOrdenComoVenta, validarOrdenImportable, mapearLineasDeOrden, validarExistenciaDeOrden, registrarPendientesDeVinculo, resolverPendienteVinculo,
};
