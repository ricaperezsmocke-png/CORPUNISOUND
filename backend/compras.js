/**
 * compras.js — Recepción de mercancía de proveedores en el CEDIS.
 *
 * Cada recepción sube existencia a la sucursal de quien la registra (el
 * CEDIS, normalmente). Antes de recalcular el costo, aplica el descuento
 * por renglón (pesos y/o porcentaje) capturado en la recepción. Si el costo
 * final difiere del costo actual del producto, actualiza el costo y
 * recalcula los 4 precios de venta conservando el % de utilidad de cada
 * nivel (ver actualizarCostoDesdeCompra en productos.js). Por último, si el
 * renglón trae clave SAT, localización, IVA, neto o precios editados/
 * confirmados a mano (desde la pantalla Artículo), esos valores se
 * persisten en el producto DESPUÉS del recálculo automático, para que no se
 * pierdan bajo el % de utilidad.
 */

const { ajustarExistencia, actualizarCostoDesdeCompra, actualizarProducto, costoConIva } = require("./productos");

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function crearRecepcion(DB, datos, sucursalId, usuario) {
  const proveedor_id = Number(datos.proveedor_id);
  if (!proveedor_id) throw new Error("Selecciona un proveedor");
  if (!Array.isArray(datos.renglones) || datos.renglones.length === 0) {
    throw new Error("Agrega al menos un producto a la recepción");
  }

  if (datos.uuid_cfdi) {
    const yaRegistrada = DB.inventario.compras.some((c) => c.uuid_cfdi === datos.uuid_cfdi);
    if (yaRegistrada) throw new Error("Esta factura ya fue registrada anteriormente (folio fiscal duplicado)");
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
    uuid_cfdi: datos.uuid_cfdi || null,
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
        iva: aplicaIva,
        neto: neto,
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

function historialCostoProducto(DB, productoId) {
  const id = Number(productoId);
  const historial = DB.inventario.compra_detalle
    .filter((d) => d.producto_id === id)
    .map((d) => {
      const compra = DB.inventario.compras.find((c) => c.id === d.compra_id);
      return compra ? { costo: d.costo, fecha: compra.fecha } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  if (historial.length === 0) return { ultimo: null, promedio: null };

  const ultimoNeto = historial[historial.length - 1].costo;
  const promedioNeto = Math.round((historial.reduce((acc, h) => acc + h.costo, 0) / historial.length) * 100) / 100;

  return {
    ultimo: { neto: ultimoNeto, conIva: costoConIva(ultimoNeto) },
    promedio: { neto: promedioNeto, conIva: costoConIva(promedioNeto) },
  };
}

module.exports = { crearRecepcion, listarRecepciones, historialCostoProducto };
