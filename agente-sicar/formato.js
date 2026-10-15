const { randomUUID } = require('node:crypto');
const PUBLICOS = new Set(['1', '2', '3', '13', '21', '33', '4566', '4567', '4572']);
const ZONA = 'America/Mexico_City';
function id(valor) {
  if (typeof valor === 'number' && !Number.isSafeInteger(valor)) throw new Error('ID_INVALIDO');
  const texto = String(valor);
  if (!/^[1-9][0-9]{0,127}$/.test(texto)) throw new Error('ID_INVALIDO');
  return texto;
}
// redondear solo para precios unitarios (informativos): los importes que suman nunca se redondean.
function decimal(valor, escala, redondear = false) {
  if (typeof valor !== 'string' || !/^\d+(?:\.\d+)?$/.test(valor)) throw new Error('DECIMAL_INVALIDO');
  const [entero, fraccion = ''] = valor.split('.');
  let resultado = `${entero.replace(/^0+(?=\d)/, '')}.${fraccion.slice(0, escala).padEnd(escala, '0')}`;
  if (/[1-9]/.test(fraccion.slice(escala))) {
    if (!redondear) throw new Error('PRECISION_NO_PACTADA');
    if (fraccion[escala] >= '5') {
      const unidades = (BigInt(resultado.replace('.', '')) + 1n).toString().padStart(escala + 1, '0');
      resultado = `${unidades.slice(0, -escala)}.${unidades.slice(-escala)}`;
    }
  }
  if (BigInt(resultado.replace('.', '')) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('IMPORTE_EXCESIVO');
  return resultado;
}
function texto(valor, maximo, opcional = true) {
  if (valor == null && opcional) return null;
  if (typeof valor !== 'string' || valor.length > maximo || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(valor)) {
    throw new Error('TEXTO_INVALIDO');
  }
  if (!opcional && !valor.trim()) throw new Error('TEXTO_VACIO');
  return valor;
}
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;
function cliente(c, avisar = () => {}) {
  if (!c || !c.nombre?.trim() || PUBLICOS.has(String(c.cli_id)) || /^P.BLICO EN GENERAL/i.test(c.nombre)) return null;
  const cli_id = id(c.cli_id);
  // Un dato de contacto mal capturado no detiene toda la carga: se omite y queda en el registro.
  function contacto(campo, valor, maximo, patron) {
    if (valor == null || (typeof valor === 'string' && !valor.trim())) return null;
    try {
      const limpio = texto(valor, maximo);
      if (patron && !patron.test(limpio.trim())) throw new Error('TEXTO_INVALIDO');
      return patron ? limpio.trim() : limpio;
    } catch { avisar({ cli_id, campo }); return null; }
  }
  return { cli_id, nombre: texto(c.nombre, 250, false), telefono: contacto('telefono', c.telefono, 40),
    celular: contacto('celular', c.celular, 40), email: contacto('email', c.mail, 254), rfc: contacto('rfc', c.rfc, 13, RFC) };
}
function venta(v, c, detalles, enviada, avisar) {
  const ven_id = id(v.ven_id);
  try { return armarVenta(ven_id, v, c, detalles, enviada, avisar); }
  catch (error) { error.ven_id = ven_id; throw error; }
}
function armarVenta(ven_id, v, c, detalles, enviada, avisar) {
  const persona = cliente(c, avisar);
  if (!persona) return enviada ? { ven_id, estado: 'excluida' } : null;
  if (!['1', '-1'].includes(String(v.status))) throw new Error('ESTADO_VENTA_DESCONOCIDO');
  const fecha_local = String(v.fecha).replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(fecha_local)) throw new Error('FECHA_INVALIDA');
  if (!detalles.length || detalles.length > 500) throw new Error('DETALLE_FUERA_DE_LIMITE');
  return { ven_id, cli_id: persona.cli_id, fecha_local, timezone: ZONA,
    estado: String(v.status) === '1' ? 'vigente' : 'cancelada', moneda: 'MXN', total: decimal(v.total, 2),
    detalle: detalles.map(d => ({ art_id: id(d.art_id), clave: texto(d.clave, 100), descripcion: texto(d.descripcion, 500, false),
      cantidad: decimal(d.cantidad, 4), precio_con: decimal(d.precioCon, 4, true), precio_sin: decimal(d.precioSin, 4, true),
      importe_con: decimal(d.importeCon, 2), descuento_total: decimal(d.descTotal, 2) })) };
}
function sobre(sequence, mode, ahora) {
  return { schema_version: 1, mapping_version: 'ocosingo-f0-v1', batch_id: randomUUID(), sequence: id(sequence),
    captured_at: ahora.toISOString(), mode,
    window: { from: new Date(ahora.getTime() - 48 * 3600000).toISOString(), to: ahora.toISOString() }, clientes: [], ventas: [] };
}
function cabe(lote) {
  return lote.clientes.length <= 100 && lote.ventas.length <= 100
    && lote.ventas.every(v => (v.detalle?.length || 0) <= 500)
    && lote.ventas.reduce((n, v) => n + (v.detalle?.length || 0), 0) <= 1000
    && Buffer.byteLength(JSON.stringify(lote), 'utf8') <= 1024 * 1024;
}
function esHorarioHistorico(ahora) {
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', hourCycle: 'h23' }).format(ahora));
  return hora >= 20 || hora < 7;
}
module.exports = { id, decimal, cliente, venta, sobre, cabe, esHorarioHistorico };
