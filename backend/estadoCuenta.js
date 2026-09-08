/**
 * estadoCuenta.js — Estado de cuenta entre sucursales y la cuenta común.
 *
 * Se calcula al vuelo (como los reportes): NO se guarda ningún saldo que pueda
 * desincronizarse. Por tienda: depósitos activos − valor a costo de la
 * mercancía RECIBIDA del CEDIS = saldo. Positivo = puso de más; negativo = debe.
 */

const { dentroDeAlcance } = require("./auth");
const { fechaLocal } = require("./fechas");

function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function enRango(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}
function costoActual(DB, producto_id) {
  const p = DB["catalogo-productos"].productos.find((x) => x.id === producto_id);
  return p ? Number(p.costo) || 0 : 0;
}
function valorTraspaso(DB, t) {
  const costo = t.costo != null ? Number(t.costo) || 0 : costoActual(DB, t.producto_id);
  return (Number(t.cantidad) || 0) * costo;
}

function estadoCuenta(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, sucursal_id } = filtros || {};
  const nombreSucursal = (id) => (DB.pos.sucursales.find((s) => s.id === id) || {}).nombre || "—";
  const soloUna = sucursal_id ? Number(sucursal_id) : null;

  const depositos = (DB.cuenta_comun?.depositos || [])
    .filter((d) => d.estatus === "activo")
    .filter((d) => dentroDeAlcance(d.sucursal_id, alcance))
    .filter((d) => enRango(d.fecha, fecha_inicio, fecha_fin))
    .filter((d) => !soloUna || d.sucursal_id === soloUna);

  const recibidos = (DB.inventario.traspasos || [])
    .filter((t) => t.estatus === "recibido")
    .filter((t) => dentroDeAlcance(t.sucursal_destino_id, alcance))
    .filter((t) => enRango(fechaLocal(t.fecha_recepcion), fecha_inicio, fecha_fin))
    .filter((t) => !soloUna || t.sucursal_destino_id === soloUna);

  const porSucursal = new Map();
  const bucket = (id) => {
    if (!porSucursal.has(id)) porSucursal.set(id, { sucursal_id: id, sucursal_nombre: nombreSucursal(id), depositado: 0, recibido: 0, sin_comprobante: 0, monto_sin_comprobante: 0 });
    return porSucursal.get(id);
  };
  for (const d of depositos) {
    const b = bucket(d.sucursal_id);
    b.depositado += Number(d.monto) || 0;
    // El depósito sin ficha SÍ cuenta como depositado: el dinero salió de la
    // tienda igual. Lo que se lleva aparte es cuánto de ese dinero no tiene
    // nada que pruebe que llegó al banco, para que no se pierda entre los que
    // sí lo tienen. Se cuenta aquí, en el servidor, y no en la pantalla: es la
    // cifra con la que Victor y su contador van a reclamar.
    if (!d.drive_file_id) {
      b.sin_comprobante += 1;
      b.monto_sin_comprobante += Number(d.monto) || 0;
    }
  }
  for (const t of recibidos) bucket(t.sucursal_destino_id).recibido += valorTraspaso(DB, t);

  const resumen = [...porSucursal.values()]
    .map((r) => ({ ...r, depositado: redondear(r.depositado), recibido: redondear(r.recibido), saldo: redondear(r.depositado - r.recibido), monto_sin_comprobante: redondear(r.monto_sin_comprobante) }))
    .sort((a, b) => a.sucursal_nombre.localeCompare(b.sucursal_nombre));

  let movimientos = null;
  if (soloUna) {
    movimientos = [
      ...depositos.map((d) => ({ tipo: "deposito", fecha: d.fecha, folio: d.folio, concepto: `Depósito (${d.forma_pago})`, cargo: 0, abono: redondear(d.monto) })),
      ...recibidos.map((t) => {
        const p = DB["catalogo-productos"].productos.find((x) => x.id === t.producto_id);
        return { tipo: "mercancia", fecha: fechaLocal(t.fecha_recepcion), folio: `T-${t.id}`, concepto: `Mercancía: ${t.cantidad} × ${p?.nombre || "producto"}`, cargo: redondear(valorTraspaso(DB, t)), abono: 0, aproximado: t.costo == null };
      }),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  const totales = resumen.reduce((a, r) => ({
    depositado: a.depositado + r.depositado,
    recibido: a.recibido + r.recibido,
    saldo: a.saldo + r.saldo,
    sin_comprobante: a.sin_comprobante + r.sin_comprobante,
    monto_sin_comprobante: a.monto_sin_comprobante + r.monto_sin_comprobante,
  }), { depositado: 0, recibido: 0, saldo: 0, sin_comprobante: 0, monto_sin_comprobante: 0 });
  return {
    resumen,
    movimientos,
    totales: {
      depositado: redondear(totales.depositado),
      recibido: redondear(totales.recibido),
      saldo: redondear(totales.saldo),
      sin_comprobante: totales.sin_comprobante,
      monto_sin_comprobante: redondear(totales.monto_sin_comprobante),
    },
  };
}

module.exports = { estadoCuenta };
