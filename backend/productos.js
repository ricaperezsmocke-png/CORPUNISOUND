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
 */

function listarProductos(DB, sucursalId) {
  return DB["catalogo-productos"].productos.map((p) => {
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

  const sucursalOrigen = Number(sucursalId) || 1;
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
  const idx = DB["catalogo-productos"].productos.findIndex((p) => p.id === Number(id));
  if (idx === -1) throw new Error("Producto no encontrado");

  const actual = DB["catalogo-productos"].productos[idx];
  const actualizado = {
    ...actual,
    sku: datos.clave ?? actual.sku,
    clave_alterna: datos.clave_alterna ?? actual.clave_alterna,
    servicio: datos.servicio !== undefined ? !!datos.servicio : actual.servicio,
    nombre: datos.descripcion ?? actual.nombre,
    categoria_id: datos.categoria_id !== undefined ? Number(datos.categoria_id) || null : actual.categoria_id,
    departamento_id: datos.departamento_id !== undefined ? (Number(datos.departamento_id) || null) : actual.departamento_id,
    proveedor_id: datos.proveedor_id !== undefined ? Number(datos.proveedor_id) || null : actual.proveedor_id,
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
  actualizado.precio_venta = actualizado.precios[0]?.precioVenta || 0;
  DB["catalogo-productos"].productos[idx] = actualizado;

  if (datos.existencia_minima !== undefined || datos.existencia_maxima !== undefined) {
    const sucursalObjetivo = Number(sucursalId) || 1;
    const exist = DB.inventario.existencias.find((e) => e.producto_id === Number(id) && e.sucursal_id === sucursalObjetivo);
    if (exist) {
      if (datos.existencia_minima !== undefined) exist.cantidad_minima = Number(datos.existencia_minima);
      if (datos.existencia_maxima !== undefined) exist.cantidad_maxima = Number(datos.existencia_maxima);
    }
  }
  return actualizado;
}

function eliminarProducto(DB, id) {
  const existe = DB["catalogo-productos"].productos.some((p) => p.id === Number(id));
  if (!existe) throw new Error("Producto no encontrado");
  DB["catalogo-productos"].productos = DB["catalogo-productos"].productos.filter((p) => p.id !== Number(id));
  DB.inventario.existencias = DB.inventario.existencias.filter((e) => e.producto_id !== Number(id));
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
  const suc = Number(sucursal_id) || 1;
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
  clonarProducto,
  ajustarExistencia,
  actualizarCostoDesdeCompra,
  listarCategorias,
  crearCategoria,
  listarDepartamentos,
  crearDepartamento,
  crearProveedor,
  generarClave,
};
