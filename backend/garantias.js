/**
 * garantias.js — Garantías con proveedor. Se registra un producto
 * defectuoso (con o sin cliente), se envía a resolver (proveedor directo o
 * vía CEDIS), se registra la resolución, y si vuelve producto físico se
 * reintegra a la existencia de la tienda de ORIGEN (el dato que nunca se
 * pierde, sin importar cuántos saltos dé el caso).
 *
 * Máquina de estados:
 *   registrada → enviada → resuelta → en_tienda_pendiente_entrega → cerrada
 * con rechazada/nota_credito saltando de 'enviada' directo a 'cerrada'
 * (no hay producto físico de vuelta, así que nunca reintegran existencia
 * ni pasan por recibirEnTienda).
 *
 * Mismo patrón que apartados.js: funciones planas que reciben DB y mutan
 * objetos, con una bitácora (garantia_movimientos, al estilo apartado_abonos).
 * CADA función mutadora sobre una garantía existente valida
 * dentroDeAlcance(garantia.sucursal_origen_id, alcance) ANTES de actuar —
 * el guard que faltó en Apartados y se tuvo que parchar en auditoría; aquí
 * se construye desde el día uno.
 */

const { ajustarExistencia } = require("./productos");
const { obtenerConfiguracion } = require("./configuracion");
const { dentroDeAlcance } = require("./auth");
const { fechaLocal } = require("./fechas");

const TIPOS_RESOLUCION = ["reparado", "reemplazo", "cambio_componente", "rechazada", "nota_credito"];
const TIPOS_CON_PRODUCTO = ["reparado", "reemplazo", "cambio_componente"];

/** Etiquetas legibles de la máquina de estados y de las resoluciones, para que
 *  el backend pueda mandar texto ya presentable (así lo hace el reporte de
 *  Gastos de Garantías con `estado_etiqueta`/`resolucion_etiqueta`).
 *  Nota: `src/Garantias.jsx` mantiene su propia copia porque además necesita
 *  el flag `conProducto` de cada resolución para armar sus formularios — si se
 *  agrega o renombra un estado, hay que tocar los dos lados. */
const ETIQUETA_ESTADO = {
  registrada: "Registrada",
  enviada: "Enviada",
  resuelta: "Resuelta",
  en_tienda_pendiente_entrega: "En tienda (pend. entrega)",
  cerrada: "Cerrada",
};

const ETIQUETA_RESOLUCION = {
  reparado: "Reparado",
  reemplazo: "Reemplazo",
  cambio_componente: "Cambio de componente",
  rechazada: "Rechazada (no procede)",
  nota_credito: "Nota de crédito / reembolso",
};

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function hoy() {
  return fechaLocal();
}

function ahora() {
  return new Date().toISOString();
}

function diasEntre(fechaA, fechaB) {
  return Math.floor((new Date(fechaB) - new Date(fechaA)) / 86400000);
}

function nombreSucursal(DB, id) {
  return DB.pos.sucursales.find((s) => s.id === Number(id))?.nombre || `Sucursal ${id}`;
}

/** Agrega un renglón a la bitácora y refresca fecha_ultimo_movimiento (base
 *  del cálculo de días sin seguimiento). */
function pushMovimiento(DB, garantia, tipo, descripcion, usuario) {
  const fecha = ahora();
  DB.inventario.garantia_movimientos.push({
    id: siguienteId(DB.inventario.garantia_movimientos),
    garantia_id: garantia.id,
    fecha,
    usuario: usuario?.nombre || "—",
    tipo,
    descripcion: descripcion || "",
  });
  garantia.fecha_ultimo_movimiento = fechaLocal(fecha);
}

/** Ajusta la existencia de la sucursal de ORIGEN. Devuelve true si el ajuste
 *  aplicó; devuelve false SOLO cuando el producto no tiene registro de
 *  existencia en esa sucursal (dato legado — no debe frenar el flujo de la
 *  garantía). Cualquier otro error se propaga: no queremos volver a tragarnos
 *  en silencio fallas futuras de ajustarExistencia. */
function ajustarExistenciaOrigen(DB, garantia, cantidad, motivo) {
  try {
    ajustarExistencia(DB, garantia.producto_id, {
      cantidad,
      motivo,
      sucursal_id: garantia.sucursal_origen_id,
    });
    return true;
  } catch (e) {
    if (/no tiene registro de existencia/i.test(e.message)) return false;
    throw e;
  }
}

/** El inventario de la tienda solo se mueve cuando la pieza es de la tienda.
 *
 *  Si la garantía tiene cliente, el producto es del cliente: nunca fue
 *  existencia nuestra. Descontarlo al enviarlo hacía que el sistema reportara
 *  una pieza menos de las que había durante todo el tiempo que la garantía
 *  estuviera afuera — lo que ve Radar de Demanda y las predicciones, y puede
 *  provocar una recompra por una escasez que no existe. Peor: si el proveedor
 *  la rechazaba, el faltante se volvía permanente, porque `rechazada` y
 *  `nota_credito` cierran directo sin pasar por `recibirEnTienda`. */
function esStockPropio(garantia) {
  return garantia.cliente_id == null;
}

/** Busca la garantía y aplica el guard de alcance. Lanza "Garantía no
 *  encontrada" tanto si no existe como si está fuera del alcance (no revela
 *  que existe en otra sucursal). */
function buscarConGuardia(DB, id, alcance) {
  const garantia = DB.inventario.garantias.find((g) => g.id === Number(id));
  if (!garantia) throw new Error("Garantía no encontrada");
  if (!dentroDeAlcance(garantia.sucursal_origen_id, alcance)) {
    throw new Error("Garantía no encontrada");
  }
  return garantia;
}

function crearGarantia(DB, datos, sucursalId, usuario) {
  // Sin sucursal de origen no se adivina: la garantía descuenta y reintegra
  // existencia de UNA tienda (antes caía a la 1).
  const sucursal_origen_id = Number(sucursalId);
  if (!Number.isInteger(sucursal_origen_id) || sucursal_origen_id <= 0) {
    throw new Error("Falta la sucursal de origen de la garantía");
  }
  const producto_id = Number(datos.producto_id);
  if (!producto_id) throw new Error("Selecciona un producto para la garantía");
  const producto = DB["catalogo-productos"].productos.find((p) => p.id === producto_id);
  if (!producto) throw new Error("Producto no encontrado");

  const nuevoId = siguienteId(DB.inventario.garantias);
  const fechaHoy = hoy();
  const garantia = {
    id: nuevoId,
    folio: `G-${String(nuevoId).padStart(4, "0")}`,
    sucursal_origen_id,
    producto_id,
    cliente_id: datos.cliente_id != null && datos.cliente_id !== "" ? Number(datos.cliente_id) : null,
    venta_id: datos.venta_id != null && datos.venta_id !== "" ? Number(datos.venta_id) : null,
    proveedor_id: datos.proveedor_id != null && datos.proveedor_id !== "" ? Number(datos.proveedor_id) : null,
    estado: "registrada",
    ubicacion_actual: nombreSucursal(DB, sucursal_origen_id),
    tipo_resolucion: null,
    notas_resolucion: null,
    fecha_creacion: fechaHoy,
    fecha_ultimo_movimiento: fechaHoy,
    usuario_creacion: usuario?.nombre || "—",
  };
  DB.inventario.garantias.push(garantia);

  const desc = datos.notas_defecto
    ? `Registrada — ${datos.notas_defecto}`
    : `Registrada en ${garantia.ubicacion_actual}`;
  pushMovimiento(DB, garantia, "creacion", desc, usuario);
  return garantia;
}

function marcarEnviada(DB, id, datos, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "registrada") {
    throw new Error("Solo se puede enviar una garantía en estado 'registrada'");
  }
  const destino_nombre = (datos.destino_nombre || "").trim();
  if (!destino_nombre) throw new Error("Indica el destino del envío");

  if (datos.proveedor_id != null && datos.proveedor_id !== "") {
    garantia.proveedor_id = Number(datos.proveedor_id);
  }

  const esPropio = esStockPropio(garantia);
  const stockAjustado = esPropio
    ? ajustarExistenciaOrigen(DB, garantia, -1, `Garantía ${garantia.folio} — enviada`)
    : false;

  garantia.estado = "enviada";
  garantia.ubicacion_actual = destino_nombre;
  garantia.stock_ajustado = stockAjustado;
  const destinoTipo = datos.destino_tipo === "cedis" ? "CEDIS" : "Proveedor directo";
  const notaStock = stockAjustado
    ? " — se descontó 1 pieza de existencia"
    : esPropio
      ? " — sin ajuste de existencia (el producto no tenía stock en esta sucursal)"
      : " — sin ajuste de existencia (el producto es del cliente, no es inventario de la tienda)";
  pushMovimiento(DB, garantia, "envio", `Enviada a ${destino_nombre} (${destinoTipo})${notaStock}`, usuario);
  return garantia;
}

function actualizarUbicacion(DB, id, datos, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "enviada") {
    throw new Error("Solo se puede actualizar la ubicación de una garantía 'enviada'");
  }
  const ubicacion = (datos.ubicacion_actual || "").trim();
  if (!ubicacion) throw new Error("Indica la nueva ubicación");

  garantia.ubicacion_actual = ubicacion;
  const desc = datos.notas ? `${ubicacion} — ${datos.notas}` : ubicacion;
  pushMovimiento(DB, garantia, "actualizacion_ubicacion", desc, usuario);
  return garantia;
}

function registrarResolucion(DB, id, datos, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "enviada") {
    throw new Error("Solo se puede registrar la resolución de una garantía 'enviada'");
  }
  const tipo = datos.tipo_resolucion;
  if (!TIPOS_RESOLUCION.includes(tipo)) throw new Error("Tipo de resolución inválido");

  garantia.tipo_resolucion = tipo;
  garantia.notas_resolucion = datos.notas || null;

  if (TIPOS_CON_PRODUCTO.includes(tipo)) {
    garantia.estado = "resuelta";
  } else {
    // rechazada / nota_credito: no hay producto físico de vuelta — cierra directo
    garantia.estado = "cerrada";
  }

  pushMovimiento(DB, garantia, "resolucion", `Resuelta: ${tipo}`, usuario);
  return garantia;
}

function recibirEnTienda(DB, id, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "resuelta") {
    throw new Error("Solo se puede recibir una garantía 'resuelta'");
  }

  const esPropio = esStockPropio(garantia);
  const stockAjustado = esPropio
    ? ajustarExistenciaOrigen(DB, garantia, 1, `Garantía ${garantia.folio} — recibida`)
    : false;

  const sucursal = nombreSucursal(DB, garantia.sucursal_origen_id);
  garantia.ubicacion_actual = sucursal;
  garantia.stock_ajustado = stockAjustado;
  const notaStock = stockAjustado
    ? " — reintegrada 1 pieza a inventario"
    : esPropio
      ? " — sin ajuste de existencia (el producto no tenía stock en esta sucursal)"
      : " — sin ajuste de existencia (el producto es del cliente, se le entrega a él)";

  if (garantia.cliente_id != null) {
    garantia.estado = "en_tienda_pendiente_entrega";
    pushMovimiento(DB, garantia, "recepcion", `Recibida en ${sucursal}${notaStock} — pendiente de entregar al cliente`, usuario);
  } else {
    garantia.estado = "cerrada";
    pushMovimiento(DB, garantia, "recepcion", `Recibida en ${sucursal}${notaStock}`, usuario);
  }
  return garantia;
}

function entregarACliente(DB, id, usuario, alcance) {
  const garantia = buscarConGuardia(DB, id, alcance);
  if (garantia.estado !== "en_tienda_pendiente_entrega") {
    throw new Error("Solo se puede entregar una garantía en 'en_tienda_pendiente_entrega'");
  }
  garantia.estado = "cerrada";
  pushMovimiento(DB, garantia, "entrega_cliente", "Entregada al cliente", usuario);
  return garantia;
}

function listarGarantias(DB, alcance) {
  const config = obtenerConfiguracion(DB);
  const umbral = Number(config.dias_alerta_garantias) || 15;

  let lista = DB.inventario.garantias;
  if (alcance && !alcance.verTodas) {
    lista = lista.filter((g) => g.sucursal_origen_id === alcance.sucursalId);
  }

  return lista
    .map((g) => {
      const cliente = g.cliente_id != null ? DB.crm.clientes.find((c) => c.id === g.cliente_id) : null;
      const producto = DB["catalogo-productos"].productos.find((p) => p.id === g.producto_id);
      const proveedor = g.proveedor_id != null
        ? DB["catalogo-productos"].proveedores.find((pr) => pr.id === g.proveedor_id)
        : null;
      const dias_sin_movimiento = diasEntre(g.fecha_ultimo_movimiento, hoy());
      return {
        ...g,
        cliente_nombre: cliente ? cliente.nombre : null,
        producto_nombre: producto ? producto.nombre : `Producto ${g.producto_id}`,
        sucursal_origen_nombre: nombreSucursal(DB, g.sucursal_origen_id),
        proveedor_nombre: proveedor ? proveedor.nombre : null,
        dias_sin_movimiento,
        atrasada: g.estado !== "cerrada" && dias_sin_movimiento > umbral,
        total_gastos: (DB.inventario.garantia_gastos || [])
          .filter((x) => x.garantia_id === g.id)
          .reduce((s, x) => s + Number(x.monto || 0), 0),
        movimientos: DB.inventario.garantia_movimientos
          .filter((m) => m.garantia_id === g.id)
          .sort((a, b) => a.fecha.localeCompare(b.fecha)),
      };
    })
    .sort((a, b) => b.dias_sin_movimiento - a.dias_sin_movimiento);
}

module.exports = {
  crearGarantia, marcarEnviada, actualizarUbicacion, registrarResolucion,
  recibirEnTienda, entregarACliente, listarGarantias,
  buscarConGuardia, pushMovimiento,
  ETIQUETA_ESTADO, ETIQUETA_RESOLUCION,
};
