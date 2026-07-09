/**
 * traspasos.js — Traspasos de inventario entre sucursales.
 *
 * Un traspaso queda "en_transito" al crearse: se descuenta de inmediato la
 * existencia de la sucursal origen, pero la sucursal destino no recibe nada
 * todavía. Solo al confirmar recepción se abona a destino — siempre la
 * cantidad exacta que se envió; cualquier problema (mercancía dañada, etc.)
 * se anota como comentario libre, no como ajuste de cantidad.
 */

const { ajustarExistencia } = require("./productos");

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function crearTraspaso(DB, datos, sucursalOrigenId, usuario) {
  const producto_id = Number(datos.producto_id);
  const cantidad = Number(datos.cantidad);
  const sucursal_destino_id = Number(datos.sucursal_destino_id);
  const sucursal_origen_id = Number(sucursalOrigenId);

  if (!producto_id) throw new Error("Selecciona un producto");
  if (!cantidad || cantidad <= 0) throw new Error("La cantidad debe ser mayor a cero");
  if (!sucursal_destino_id) throw new Error("Selecciona la sucursal destino");
  if (sucursal_destino_id === sucursal_origen_id) throw new Error("La sucursal destino debe ser distinta a la de origen");

  const existOrigen = DB.inventario.existencias.find((e) => e.producto_id === producto_id && e.sucursal_id === sucursal_origen_id);
  const disponible = existOrigen ? existOrigen.cantidad_actual : 0;
  if (disponible < cantidad) {
    const producto = DB["catalogo-productos"].productos.find((p) => p.id === producto_id);
    throw new Error(`No hay existencia suficiente de "${producto?.nombre || "producto"}" en tu sucursal (disponible: ${disponible}, solicitado: ${cantidad})`);
  }

  const nuevo = {
    id: siguienteId(DB.inventario.traspasos),
    producto_id,
    cantidad,
    sucursal_origen_id,
    sucursal_destino_id,
    estatus: "en_transito",
    comentario_envio: datos.comentario || "",
    comentario_recepcion: null,
    usuario_envio_id: usuario?.id ?? null,
    usuario_envio_nombre: usuario?.nombre || "—",
    usuario_recibe_id: null,
    usuario_recibe_nombre: null,
    fecha_envio: new Date().toISOString(),
    fecha_recepcion: null,
  };

  ajustarExistencia(DB, producto_id, {
    cantidad: -cantidad,
    motivo: `Traspaso #${nuevo.id} — envío a sucursal ${sucursal_destino_id}`,
    sucursal_id: sucursal_origen_id,
  });

  DB.inventario.traspasos.push(nuevo);
  return nuevo;
}

function recibirTraspaso(DB, id, datos, sucursalUsuarioId, usuario) {
  const traspaso = DB.inventario.traspasos.find((t) => t.id === Number(id));
  if (!traspaso) throw new Error("Traspaso no encontrado");
  if (traspaso.estatus !== "en_transito") throw new Error("Este traspaso ya fue recibido");
  if (traspaso.sucursal_destino_id !== Number(sucursalUsuarioId)) {
    throw new Error("Este traspaso no es para tu sucursal");
  }

  const existeDestino = DB.inventario.existencias.some((e) => e.producto_id === traspaso.producto_id && e.sucursal_id === traspaso.sucursal_destino_id);
  if (!existeDestino) {
    DB.inventario.existencias.push({
      producto_id: traspaso.producto_id,
      sucursal_id: traspaso.sucursal_destino_id,
      cantidad_actual: 0,
      cantidad_minima: 0,
      cantidad_maxima: 0,
    });
  }

  ajustarExistencia(DB, traspaso.producto_id, {
    cantidad: traspaso.cantidad,
    motivo: `Traspaso #${traspaso.id} — recepción de sucursal ${traspaso.sucursal_origen_id}`,
    sucursal_id: traspaso.sucursal_destino_id,
  });

  traspaso.estatus = "recibido";
  traspaso.comentario_recepcion = datos.comentario || null;
  traspaso.usuario_recibe_id = usuario?.id ?? null;
  traspaso.usuario_recibe_nombre = usuario?.nombre || "—";
  traspaso.fecha_recepcion = new Date().toISOString();
  return traspaso;
}

function listarTraspasos(DB, alcance, filtroEstatus) {
  let lista = [...DB.inventario.traspasos];
  if (alcance && !alcance.verTodas) {
    lista = lista.filter((t) => t.sucursal_origen_id === alcance.sucursalId || t.sucursal_destino_id === alcance.sucursalId);
  }
  if (filtroEstatus) {
    lista = lista.filter((t) => t.estatus === filtroEstatus);
  }
  return lista.sort((a, b) => new Date(b.fecha_envio) - new Date(a.fecha_envio));
}

module.exports = { crearTraspaso, recibirTraspaso, listarTraspasos };
