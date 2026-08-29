/**
 * productos.js — Operaciones sobre el catálogo de productos y su inventario.
 *
 * Esta es la fuente única de verdad: el módulo de Alta de Productos escribe
 * aquí, y el Punto de Venta lee de aquí (vía /api/productos), tal como se
 * describe en el documento de arquitectura ("módulos autodescriptivos").
 *
 * Nota: los datos viven en memoria (se reinician si apagas el backend).
 * El siguiente paso natural es cambiar esto por una base de datos real
 * (Postgres/MySQL) sin tener que tocar las rutas ni el frontend.
 *
 * REGLA QUE NO SE NEGOCIA: un producto con historial NUNCA se borra, se
 * DESACTIVA — la misma regla que vendedores.js, y por el mismo motivo.
 * `eliminarProducto` borraba el renglón del catálogo de verdad, y el ticket de
 * una venta vieja pasaba a decir literalmente "Producto": `obtenerVentaDetalle`
 * (ventas.js) resuelve el nombre del renglón contra el catálogo, y el Punto de
 * Venta manda `descripcion: undefined` en todo lo que sale del catálogo, así
 * que el nombre no está guardado en ningún otro lado. Borrar una guitarra
 * dejaba sin nombre, para siempre, cada ticket donde se vendió.
 */

const TASA_IVA = 0.16;

function costoConIva(costoNeto) {
  return Math.round(Number(costoNeto) * (1 + TASA_IVA) * 100) / 100;
}

/**
 * Un producto importado de SICAR no trae el campo `activo`. Ausente = activo,
 * mismo criterio que vendedores.js.
 *
 * OJO: tiene que ser `!== false`, NUNCA `=== true`. Con `=== true` el catálogo
 * entero de productos migrados desaparecería de la caja el día que esto se
 * empezara a filtrar — que es justo lo que hace esta versión.
 */
function estaActivo(producto) {
  return producto.activo !== false;
}

/**
 * Todo lo que el sistema guarda a nombre de este producto. Si hay aunque sea
 * un renglón, el producto NO se borra: se desactiva.
 *
 * Son dos familias:
 *  - Documentos que alguien va a volver a abrir — tickets, apartados,
 *    recepciones de compra, traspasos, garantías, publicaciones de ML. Borrar
 *    el producto los deja diciendo "Producto" en vez del nombre real.
 *  - Historial que nadie imprime pero que igual es un dato del negocio — el
 *    reporte de ventas importado de SICAR (que además alimenta las
 *    predicciones), la bitácora de movimientos de inventario, las consultas
 *    del Radar de Demanda, las tareas del Gerente de Ventas y la mercancía que
 *    sigue en el anaquel.
 *
 * REGLA PARA EL FUTURO: cada vez que se cree una colección que guarde
 * `producto_id`, hay que agregarla AQUÍ. Esta lista es lo único que separa un
 * producto descontinuado de un renglón huérfano, y no hay nada que avise
 * cuando se queda corta — es la misma trampa de `COLECCIONES_RESPALDADAS`
 * (respaldos.js), que en agosto de 2026 dejó ilegibles 30 días de respaldos.
 *
 * Devuelve el detalle contado, no un booleano, para poder decirle al usuario
 * POR QUÉ no se borró: "tiene 3 ventas y 1 garantía" se entiende; "no se puede
 * borrar" manda a alguien a llamar por teléfono.
 *
 * Ventas y apartados salen de la misma tabla (`venta_detalle`): apartados.js
 * guarda el apartado como una venta con `tipo_documento: "Apartado"`, así que
 * se separan por ahí y no por tabla.
 */
function rastroHistorico(DB, id) {
  const productoId = Number(id);
  const rastro = [];

  // Comparar por `Number(...)`, nunca crudo. `ventas.js` y `apartados.js`
  // guardan `producto_id` tal como viene del cuerpo HTTP: un cliente que mande
  // "9" en vez de 9 deja un texto guardado para siempre, y con igualdad
  // estricta ese renglón no contaba — el producto se borraba en duro con una
  // venta encima. Este guard tiene que fallar cerrado, nunca de largo.
  const esDeEsteProducto = (r) => Number(r.producto_id) === productoId;

  const ventaPorId = new Map((DB.pos?.ventas || []).map((v) => [v.id, v]));
  let ventas = 0, apartados = 0;
  for (const d of DB.pos?.venta_detalle || []) {
    if (!esDeEsteProducto(d)) continue;
    const doc = ventaPorId.get(d.venta_id);
    if (doc && String(doc.tipo_documento || "").toLowerCase() === "apartado") apartados++;
    else ventas++;
  }
  if (ventas) rastro.push({ tipo: "ventas", cantidad: ventas });
  if (apartados) rastro.push({ tipo: "apartados", cantidad: apartados });

  const compras = (DB.inventario?.compra_detalle || []).filter(esDeEsteProducto).length;
  if (compras) rastro.push({ tipo: "compras", cantidad: compras });

  const traspasos = (DB.inventario?.traspasos || []).filter(esDeEsteProducto).length;
  if (traspasos) rastro.push({ tipo: "traspasos", cantidad: traspasos });

  const garantias = (DB.inventario?.garantias || []).filter(esDeEsteProducto).length;
  if (garantias) rastro.push({ tipo: "garantías", cantidad: garantias });

  // `DB.ml` no existe en el DB de pruebas (testHelpers.js) ni en bases viejas
  // anteriores a MercadoLibre: se navega con `?.` en vez de asumirlo. Lo mismo
  // vale para `DB.radar_demanda`, que es de agosto de 2026.
  const publicaciones = (DB.ml?.publicaciones || []).filter(esDeEsteProducto).length;
  if (publicaciones) rastro.push({ tipo: "publicaciones de MercadoLibre", cantidad: publicaciones });

  // Años de venta traídos de SICAR. No imprimen ticket, pero son el insumo de
  // las predicciones de demanda: borrarlos deja al producto sin pasado.
  const historial = (DB.pos?.historial_ventas_mensual || []).filter(esDeEsteProducto).length;
  if (historial) rastro.push({ tipo: "meses de historial de ventas", cantidad: historial });

  // La bitácora de entradas y salidas: ajustes manuales, mermas, el descuento
  // de cada venta. Sin el producto, cada renglón queda sin nombre posible.
  const movimientos = (DB.inventario?.movimientos_inventario || []).filter(esDeEsteProducto).length;
  if (movimientos) rastro.push({ tipo: "movimientos de inventario", cantidad: movimientos });

  const consultas = (DB.radar_demanda?.registros || []).filter(esDeEsteProducto).length;
  if (consultas) rastro.push({ tipo: "consultas de clientes en el Radar", cantidad: consultas });

  // Tareas del Gerente de Ventas ("empújale este producto a este cliente").
  // Hoy el motor solo las genera para productos que ya se vendieron —o sea,
  // que ya retienen por ventas—, pero el campo `origen` está puesto para que
  // existan tareas de otro origen, y ese día esto sería el único guard.
  const tareas = (DB.pos?.tareas_venta?.tareas || []).filter(esDeEsteProducto).length;
  if (tareas) rastro.push({ tipo: "tareas de venta", cantidad: tareas });

  // Mercancía que sigue en el anaquel. `crearProducto` guarda la
  // `existencia_inicial` SIN generar movimiento, así que un producto capturado
  // con piezas y nunca vendido no deja ninguna otra huella: borrarlo tiraría
  // ese conteo en silencio. La existencia negativa también retiene — un
  // descuadre hay que poder verlo, no desaparecerlo.
  const tiendasConExistencia = (DB.inventario?.existencias || [])
    .filter((e) => esDeEsteProducto(e) && Number(e.cantidad_actual || 0) !== 0).length;
  if (tiendasConExistencia) rastro.push({ tipo: "tiendas con existencia", cantidad: tiendasConExistencia });

  return rastro;
}

/** "3 ventas, 1 garantía" — para el aviso que ve el usuario. */
function describirRastro(rastro) {
  return rastro.map((r) => `${r.cantidad} ${r.tipo}`).join(", ");
}

function listarProductos(DB, sucursalId, { incluirInactivos = false } = {}) {
  return DB["catalogo-productos"].productos
    .filter((p) => incluirInactivos || estaActivo(p))
    .map((p) => {
    // Global "todas" (sucursalId null): suma la existencia de todas las sucursales.
    // Sucursal concreta (o default 1): existencia de esa sucursal.
    const existenciasProducto = DB.inventario.existencias.filter((e) => e.producto_id === p.id);
    let exist;
    if (sucursalId == null) {
      const total = existenciasProducto.reduce((a, e) => a + (e.cantidad_actual || 0), 0);
      exist = existenciasProducto.length ? { cantidad_actual: total, cantidad_minima: 0, cantidad_maxima: 0 } : null;
    } else {
      exist = existenciasProducto.find((e) => e.sucursal_id === Number(sucursalId)) || null;
    }
    const categoria = DB["catalogo-productos"].categorias.find((c) => c.id === p.categoria_id);
    const departamento = DB["catalogo-productos"].departamentos.find((d) => d.id === p.departamento_id);
    return {
      ...p,
      // Normalizado a booleano de verdad: el catálogo pinta el renglón gris y
      // el botón de reactivar con esto, y un `undefined` heredado de SICAR lo
      // haría verse desactivado sin estarlo.
      activo: estaActivo(p),
      codigo: p.clave_alterna || p.sku,
      ubicacion: p.ubicacion || "-",
      promocion: !!p.promocion,
      existencia: exist ? exist.cantidad_actual : 0,
      existencia_minima: exist ? exist.cantidad_minima : 0,
      existencia_maxima: exist ? exist.cantidad_maxima : 0,
      categoria_nombre: categoria ? categoria.nombre : "Sin definir",
      departamento_nombre: departamento ? departamento.nombre : (p.departamento || "Sin definir"),
    };
  });
}

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function generarClave() {
  return "PROD" + String(Date.now()).slice(-8);
}

function crearProducto(DB, datos, sucursalId) {
  if (!datos.descripcion || !datos.descripcion.trim()) {
    throw new Error("La descripción del producto es obligatoria");
  }
  // Antes, sin sucursal se caía a la 1 "por compatibilidad": la existencia
  // inicial de un producto capturado desde cualquier tienda terminaba en
  // Ocosingo. Ahora se exige, y quien llama debe pedirla al usuario.
  const sucursalOrigen = Number(sucursalId);
  if (!Number.isInteger(sucursalOrigen) || sucursalOrigen <= 0) {
    throw new Error("Falta la sucursal donde queda la existencia inicial del producto");
  }
  const nuevoId = siguienteId(DB["catalogo-productos"].productos);
  const producto = {
    id: nuevoId,
    sku: datos.clave && datos.clave.trim() ? datos.clave.trim() : generarClave(),
    clave_alterna: datos.clave_alterna || "",
    servicio: !!datos.servicio,
    nombre: datos.descripcion.trim(),
    categoria_id: datos.categoria_id ? Number(datos.categoria_id) : null,
    departamento_id: datos.departamento_id ? Number(datos.departamento_id) : null,
    proveedor_id: datos.proveedor_id ? Number(datos.proveedor_id) : null,
    unidad_compra: datos.unidad_compra || "PZA",
    unidad_venta: datos.unidad_venta || "PZA",
    factor: Number(datos.factor) || 1,
    iva: !!datos.iva,
    costo: Number(datos.precio_compra) || 0,
    neto: datos.neto !== undefined ? !!datos.neto : true,
    precios: Array.isArray(datos.precios) && datos.precios.length
      ? datos.precios
      : [{ utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }],
    unidad_medida: datos.unidad_venta || "pza",
    unidades_por_mayoreo: Number(datos.unidades_por_mayoreo) || 0,
    ubicacion: datos.ubicacion || "-",
    clave_sat: datos.clave_sat || "",
    localizacion: datos.localizacion || "",
    promocion: !!datos.promocion,
    imagen_url: datos.imagen_url || "",
    activo: true,
  };
  producto.precio_venta = producto.precios[0]?.precioVenta || 0;

  DB["catalogo-productos"].productos.push(producto);

  DB.pos.sucursales.forEach((s) => {
    const esOrigen = s.id === sucursalOrigen;
    DB.inventario.existencias.push({
      producto_id: nuevoId,
      sucursal_id: s.id,
      cantidad_actual: esOrigen ? (Number(datos.existencia_inicial) || 0) : 0,
      cantidad_minima: esOrigen ? (Number(datos.existencia_minima) || 0) : 0,
      cantidad_maxima: esOrigen ? (Number(datos.existencia_maxima) || 0) : 0,
    });
  });
  return producto;
}

function actualizarProducto(DB, id, datos, sucursalId) {
  const actual = DB["catalogo-productos"].productos.find((p) => p.id === Number(id));
  if (!actual) throw new Error("Producto no encontrado");

  const preciosEntrantes = Array.isArray(datos.precios) ? datos.precios : actual.precios;
  const todosLosNivelesEnCero = Array.isArray(preciosEntrantes) && preciosEntrantes.length > 0
    && preciosEntrantes.every((t) => !Number(t?.precioVenta));
  if (todosLosNivelesEnCero && Number(actual.precio_venta) > 0) {
    throw new Error(
      "Los 4 niveles de precio llegaron en $0.00, pero el producto ya tenía precio de venta. " +
      "Revisa los campos de precio antes de guardar (probablemente un error al editar, no una intención real de dejarlo en $0.00)."
    );
  }

  const actualizado = {
    ...actual,
    sku: datos.clave ?? actual.sku,
    clave_alterna: datos.clave_alterna ?? actual.clave_alterna,
    servicio: datos.servicio !== undefined ? !!datos.servicio : actual.servicio,
    nombre: datos.descripcion ?? actual.nombre,
    categoria_id: datos.categoria_id !== undefined ? (Number(datos.categoria_id) || null) : actual.categoria_id,
    departamento_id: datos.departamento_id !== undefined ? (Number(datos.departamento_id) || null) : actual.departamento_id,
    proveedor_id: datos.proveedor_id !== undefined ? (Number(datos.proveedor_id) || null) : actual.proveedor_id,
    unidad_compra: datos.unidad_compra ?? actual.unidad_compra,
    unidad_venta: datos.unidad_venta ?? actual.unidad_venta,
    factor: datos.factor !== undefined ? Number(datos.factor) : actual.factor,
    iva: datos.iva !== undefined ? !!datos.iva : actual.iva,
    costo: datos.precio_compra !== undefined ? Number(datos.precio_compra) : actual.costo,
    neto: datos.neto !== undefined ? !!datos.neto : actual.neto,
    precios: Array.isArray(datos.precios) ? datos.precios : actual.precios,
    unidades_por_mayoreo: datos.unidades_por_mayoreo !== undefined ? Number(datos.unidades_por_mayoreo) : actual.unidades_por_mayoreo,
    imagen_url: datos.imagen_url !== undefined ? datos.imagen_url : (actual.imagen_url || ""),
    clave_sat: datos.clave_sat !== undefined ? datos.clave_sat : (actual.clave_sat || ""),
    localizacion: datos.localizacion !== undefined ? datos.localizacion : (actual.localizacion || ""),
  };
  actualizado.precio_venta = actualizado.precios?.[0]?.precioVenta || 0;

  // Object.assign en vez de reemplazar el slot del array: crearRecepcion
  // (en compras.js) guarda una referencia viva a este mismo objeto y la
  // sigue usando después de esta llamada, así que debe seguir siendo la
  // misma identidad, solo con sus propiedades actualizadas.
  Object.assign(actual, actualizado);

  if (datos.existencia_minima !== undefined || datos.existencia_maxima !== undefined) {
    // Mínima y máxima son de UNA tienda: sin sucursal no hay dónde aplicarlas
    // (antes se caía a la 1 y se cambiaban los mínimos de otra sucursal).
    const sucursalObjetivo = Number(sucursalId);
    if (!Number.isInteger(sucursalObjetivo) || sucursalObjetivo <= 0) {
      throw new Error("Falta la sucursal para cambiar la existencia mínima y máxima");
    }
    const exist = DB.inventario.existencias.find((e) => e.producto_id === Number(id) && e.sucursal_id === sucursalObjetivo);
    if (exist) {
      if (datos.existencia_minima !== undefined) exist.cantidad_minima = Number(datos.existencia_minima);
      if (datos.existencia_maxima !== undefined) exist.cantidad_maxima = Number(datos.existencia_maxima);
    }
  }
  return actual;
}

/**
 * Saca un producto del catálogo. DESACTIVA si tiene historial, borra de verdad
 * solo si no lo tiene.
 *
 * El borrado físico se quedó porque sirve para lo único que de verdad sirve:
 * deshacer un alta recién capturada con la clave mal escrita, que no aparece en
 * ningún documento. En cuanto el producto se vendió, se compró, se traspasó o
 * se garantizó, borrarlo destruye el nombre en esos documentos (ver el
 * encabezado de este archivo), así que se desactiva.
 *
 * Desactivar NO toca las existencias: la mercancía que quedó en el anaquel es
 * real y tiene que seguir contando en el reporte de existencias. Lo que cambia
 * es que el producto deja de ofrecerse para vender, comprar, traspasar,
 * garantizar o publicar en ML — todas esas pantallas leen /api/productos, que
 * ya filtra los inactivos.
 */
function eliminarProducto(DB, id) {
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === Number(id));
  if (!producto) throw new Error("Producto no encontrado");

  const rastro = rastroHistorico(DB, producto.id);
  if (rastro.length) {
    producto.activo = false;
    return { desactivado: true, rastro, detalle: describirRastro(rastro) };
  }

  // Mismo criterio de comparación que `rastroHistorico`: si un `producto_id`
  // de texto se escapa aquí, la fila de existencia sobrevive huérfana — y como
  // `siguienteId` reutiliza el id más alto, terminaría colgada del próximo
  // producto que se dé de alta.
  DB["catalogo-productos"].productos = DB["catalogo-productos"].productos.filter((p) => Number(p.id) !== Number(id));
  DB.inventario.existencias = DB.inventario.existencias.filter((e) => Number(e.producto_id) !== Number(id));
  return { desactivado: false, rastro: [], detalle: "" };
}

/**
 * Devuelve al catálogo un producto desactivado. Sin guard: reactivar siempre
 * deja el sistema en un estado sano (mismo criterio que vendedores.js).
 */
function reactivarProducto(DB, id) {
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === Number(id));
  if (!producto) throw new Error("Producto no encontrado");
  producto.activo = true;
  return producto;
}

function clonarProducto(DB, id, sucursalId) {
  const original = DB["catalogo-productos"].productos.find((p) => p.id === Number(id));
  if (!original) throw new Error("Producto no encontrado");
  return crearProducto(DB, {
    clave: generarClave(),
    clave_alterna: "",
    servicio: original.servicio,
    descripcion: original.nombre + " (copia)",
    categoria_id: original.categoria_id,
    departamento_id: original.departamento_id,
    proveedor_id: original.proveedor_id,
    unidad_compra: original.unidad_compra,
    unidad_venta: original.unidad_venta,
    factor: original.factor,
    iva: original.iva,
    precio_compra: original.costo,
    neto: original.neto,
    precios: original.precios,
    unidades_por_mayoreo: original.unidades_por_mayoreo,
    existencia_inicial: 0,
  }, sucursalId);
}

function ajustarExistencia(DB, id, { cantidad, motivo, sucursal_id }) {
  // Sin sucursal no se adivina: antes caía a la 1 y el ajuste (o el descuento
  // de una venta) se aplicaba a la existencia de la tienda equivocada.
  const suc = Number(sucursal_id);
  if (!Number.isInteger(suc) || suc <= 0) {
    throw new Error("Falta la sucursal a la que se le ajusta la existencia");
  }
  const exist = DB.inventario.existencias.find((e) => e.producto_id === Number(id) && e.sucursal_id === suc);
  if (!exist) throw new Error("Este producto no tiene registro de existencia en esta sucursal");
  const delta = Number(cantidad) || 0;
  // Importante: NO se recorta a 0 aquí. Si se recorta, una venta que deja
  // el stock "en 0" en vez de en negativo pierde información — y al
  // cancelar esa venta, el reintegro parte de un punto falso y crea
  // inventario de la nada. La validación de "no vender más de lo que hay"
  // debe pasar ANTES de llegar aquí (ver crearVenta en ventas.js).
  exist.cantidad_actual = exist.cantidad_actual + delta;
  DB.inventario.movimientos_inventario.push({
    id: siguienteId(DB.inventario.movimientos_inventario.length ? DB.inventario.movimientos_inventario : [{ id: 0 }]),
    producto_id: Number(id),
    sucursal_id: suc,
    fecha: new Date().toISOString(),
    tipo: delta >= 0 ? "entrada" : "salida",
    cantidad: delta,
    referencia_documento: motivo || "Ajuste manual",
  });
  return exist;
}

function listarCategorias(DB) {
  return DB["catalogo-productos"].categorias;
}

function crearCategoria(DB, nombre) {
  if (!nombre || !nombre.trim()) throw new Error("El nombre de la categoría es obligatorio");
  const nueva = { id: siguienteId(DB["catalogo-productos"].categorias), nombre: nombre.trim(), categoria_padre_id: null };
  DB["catalogo-productos"].categorias.push(nueva);
  return nueva;
}

function listarDepartamentos(DB) {
  return DB["catalogo-productos"].departamentos;
}

function crearDepartamento(DB, nombre) {
  if (!nombre || !nombre.trim()) throw new Error("El nombre del departamento es obligatorio");
  const nuevo = { id: siguienteId(DB["catalogo-productos"].departamentos), nombre: nombre.trim() };
  DB["catalogo-productos"].departamentos.push(nuevo);
  return nuevo;
}

function crearProveedor(DB, nombre, rfc) {
  if (!nombre || !nombre.trim()) throw new Error("El nombre del proveedor es obligatorio");
  const nuevo = { id: siguienteId(DB["catalogo-productos"].proveedores), nombre: nombre.trim(), contacto: "", tiempo_entrega_dias: 0, condiciones_pago: "", rfc: rfc || "" };
  DB["catalogo-productos"].proveedores.push(nuevo);
  return nuevo;
}

function actualizarCostoDesdeCompra(DB, id, nuevoCosto) {
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === Number(id));
  if (!producto) throw new Error("Producto no encontrado");

  const costo = Number(nuevoCosto);
  if (!Number.isFinite(costo) || costo === producto.costo) return producto;

  producto.costo = costo;
  // Solo recalcula precios si el producto tiene un array de precios.
  // Productos legacy (como los 4 de seed) no tienen precios array,
  // así que solo actualizamos el costo sin intentar recalcular.
  if (Array.isArray(producto.precios)) {
    producto.precios = producto.precios.map((t) => ({
      ...t,
      precioVenta: Math.round(costo * (1 + (Number(t.utilidad) || 0) / 100) * 100) / 100,
    }));
    producto.precio_venta = producto.precios[0]?.precioVenta || 0;
  }
  return producto;
}

module.exports = {
  listarProductos,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  reactivarProducto,
  estaActivo,
  rastroHistorico,
  describirRastro,
  clonarProducto,
  ajustarExistencia,
  actualizarCostoDesdeCompra,
  listarCategorias,
  crearCategoria,
  listarDepartamentos,
  crearDepartamento,
  crearProveedor,
  generarClave,
  TASA_IVA,
  costoConIva,
};
