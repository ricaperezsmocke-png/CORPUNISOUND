/**
 * compras.js — Recepción de mercancía de proveedores en el CEDIS.
 *
 * Cada recepción sube existencia a la sucursal de quien la registra (el
 * CEDIS, normalmente) y, si el costo capturado difiere del costo actual del
 * producto, actualiza el costo y recalcula los 4 precios de venta
 * conservando el % de utilidad de cada nivel (ver actualizarCostoDesdeCompra
 * en productos.js).
 */

const { ajustarExistencia, actualizarCostoDesdeCompra, actualizarProducto } = require("./productos");

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function crearRecepcion(DB, datos, sucursalId, usuario) {
  const proveedor_id = Number(datos.proveedor_id);
  if (!proveedor_id) throw new Error("Selecciona un proveedor");
  if (!Array.isArray(datos.renglones) || datos.renglones.length === 0) {
    throw new Error("Agrega al menos un producto a la recepción");
  }

  const sucursal_id = Number(sucursalId);
  const nuevoId = siguienteId(DB.inventario.compras);
  const compra = {
    id: nuevoId,
    proveedor_id,
    factura: datos.factura || "",
    comentario: datos.comentario || "",
    sucursal_id,
    usuario_id: usuario?.id ?? null,
    usuario_nombre: usuario?.nombre || "—",
    fecha: new Date().toISOString(),
  };

  let siguienteDetalleId = siguienteId(DB.inventario.compra_detalle);
  const renglonesValidados = datos.renglones.map((r) => {
    const producto_id = Number(r.producto_id);
    const cantidad = Number(r.cantidad);
    if (!producto_id) throw new Error("Cada renglón necesita un producto");
    if (!cantidad || cantidad <= 0) throw new Error("La cantidad debe ser mayor a cero");
    const existeProducto = DB["catalogo-productos"].productos.some((p) => p.id === producto_id);
    if (!existeProducto) throw new Error("Producto no encontrado");
    const costo = Number(r.costo);
    const descuento_pesos = Number(r.descuento_pesos) || 0;
    const descuento_porcentaje = Number(r.descuento_porcentaje) || 0;
    const costoFinal = Math.round((costo - descuento_pesos) * (1 - descuento_porcentaje / 100) * 100) / 100;
    return {
      producto_id, cantidad, descuento_pesos, descuento_porcentaje, costoFinal,
      clave_sat: r.clave_sat, localizacion: r.localizacion, aplicaIva: r.aplicaIva, neto: r.neto, precios: r.precios,
    };
  });

  DB.inventario.compras.push(compra);

  renglonesValidados.forEach(({ producto_id, cantidad, descuento_pesos, descuento_porcentaje, costoFinal, clave_sat, localizacion, aplicaIva, neto, precios }) => {
    DB.inventario.compra_detalle.push({
      id: siguienteDetalleId++,
      compra_id: nuevoId,
      producto_id,
      cantidad,
      costo: costoFinal,
      descuento_pesos,
      descuento_porcentaje,
    });

    const existe = DB.inventario.existencias.some((e) => e.producto_id === producto_id && e.sucursal_id === sucursal_id);
    if (!existe) {
      DB.inventario.existencias.push({ producto_id, sucursal_id, cantidad_actual: 0, cantidad_minima: 0, cantidad_maxima: 0 });
    }

    ajustarExistencia(DB, producto_id, {
      cantidad,
      motivo: `Compra #${nuevoId} — factura ${compra.factura || "s/n"}`,
      sucursal_id,
    });

    if (Number.isFinite(costoFinal) && costoFinal > 0) {
      actualizarCostoDesdeCompra(DB, producto_id, costoFinal);
    }

    // La pantalla Artículo (frontend) puede traer clave SAT, localización,
    // IVA, neto y precios ya editados/confirmados a mano — esto se aplica
    // DESPUÉS de actualizarCostoDesdeCompra para que un precio editado a
    // mano no se pierda bajo el recálculo automático por % de utilidad.
    if (clave_sat !== undefined || localizacion !== undefined || aplicaIva !== undefined || neto !== undefined || precios !== undefined) {
      actualizarProducto(DB, producto_id, {
        clave_sat, localizacion,
        iva: aplicaIva !== undefined ? aplicaIva : undefined,
        neto: neto !== undefined ? neto : undefined,
        precios: Array.isArray(precios) ? precios : undefined,
      }, sucursal_id);
    }
  });

  return compra;
}

function listarRecepciones(DB, alcance) {
  let lista = [...DB.inventario.compras];
  if (alcance && !alcance.verTodas) {
    lista = lista.filter((c) => c.sucursal_id === alcance.sucursalId);
  }
  return lista
    .map((c) => ({
      ...c,
      renglones: DB.inventario.compra_detalle.filter((d) => d.compra_id === c.id),
    }))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

module.exports = { crearRecepcion, listarRecepciones };
