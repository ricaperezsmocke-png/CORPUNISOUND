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
  return lote.clientes.length <= 100 && lote.ventas.length <= 100 && (lote.articulos?.length || 0) <= 500
    && (lote.proveedores?.length || 0) <= 500 && (lote.existencias?.length || 0) <= 500
    && lote.ventas.every(v => (v.detalle?.length || 0) <= 500)
    && lote.ventas.reduce((n, v) => n + (v.detalle?.length || 0), 0) <= 1000
    && Buffer.byteLength(JSON.stringify(lote), 'utf8') <= 1024 * 1024;
}
function esHorarioHistorico(ahora) {
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', hourCycle: 'h23' }).format(ahora));
  return hora >= 20 || hora < 7;
}
// Datos de SICAR que el agente no sabe leer. Decisión de Victor (2026-10-15): se salta esa venta o ese cliente,
// queda en el registro con su id y el motivo, y la carga sigue. Cualquier otro error sí detiene la corrida.
const DATOS_RAROS = new Set(['ID_INVALIDO', 'DECIMAL_INVALIDO', 'PRECISION_NO_PACTADA', 'IMPORTE_EXCESIVO',
  'TEXTO_INVALIDO', 'TEXTO_VACIO', 'ESTADO_VENTA_DESCONOCIDO', 'FECHA_INVALIDA', 'DETALLE_FUERA_DE_LIMITE']);
function clienteSeguro(c, avisar) {
  try { return { cliente: cliente(c, avisar), omitido: null }; }
  catch (error) {
    if (!DATOS_RAROS.has(error.message) || !/^[1-9]\d*$/.test(String(c?.cli_id))) throw error;
    return { cliente: null, omitido: { cli_id: String(c.cli_id), codigo: error.message } };
  }
}
// Mismos límites que el servidor (sicarIngesta.js). Vacío → null; la descripción es obligatoria.
function articulo(a) {
  const art_id = id(a.art_id);
  // Se recorta antes de medir: SICAR rellena con espacios y eso no debe dejar fuera al artículo.
  const opcional = (valor, maximo) => {
    if (valor == null) return null;
    return texto(String(valor).trim(), maximo) || null;
  };
  return { art_id, clave: opcional(a.clave, 100), descripcion: texto(String(a.descripcion ?? '').trim(), 500, false),
    categoria: opcional(a.categoria, 100), departamento: opcional(a.departamento, 100) };
}
// Un artículo que el contrato no acepta no detiene la carga: se salta con su id, como ventas y clientes.
function articuloSeguro(a) {
  const art_id = id(a?.art_id);
  try { return { articulo: articulo(a), omitido: null }; }
  catch (error) {
    if (!DATOS_RAROS.has(error.message)) throw error;
    return { articulo: null, omitido: { art_id, codigo: error.message } };
  }
}
// Proveedor de SICAR para el Radar de Demanda: id y nombre, nada más. Mismo máximo que el nombre del cliente (250).
function proveedorSeguro(p) {
  const prv_id = id(p?.prv_id);
  try { return { proveedor: { prv_id, nombre: texto(String(p.nombre ?? '').trim(), 250, false) }, omitido: null }; }
  catch (error) {
    if (!DATOS_RAROS.has(error.message)) throw error;
    return { proveedor: null, omitido: { prv_id, codigo: error.message } };
  }
}
// Existencia de un artículo vigente: texto con signo y 4 decimales, tal cual la guarda SICAR (sin redondear). decimal()
// no acepta negativos, así que el signo se separa aquí y se valida la parte sin signo. '-0.0000' se manda como '0.0000'.
function existencia(valor) {
  const negativa = typeof valor === 'string' && valor.startsWith('-');
  const absoluta = decimal(negativa ? valor.slice(1) : valor, 4);
  return negativa && /[1-9]/.test(absoluta) ? `-${absoluta}` : absoluta;
}
// Una existencia que el contrato no acepta no detiene la carga: se salta con su id. Un art_id inválido sí detiene.
function existenciaSegura(fila) {
  const art_id = id(fila?.art_id);
  try { return { existencia: { art_id, existencia: existencia(fila.existencia) }, omitido: null }; }
  catch (error) {
    if (!DATOS_RAROS.has(error.message)) throw error;
    return { existencia: null, omitido: { art_id, codigo: error.message } };
  }
}
function ventaSegura(v, c, detalles, enviada, avisar) {
  try { return { venta: venta(v, c, detalles, enviada, avisar), omitida: null }; }
  catch (error) {
    if (!DATOS_RAROS.has(error.message) || !error.ven_id) throw error;
    // Cancelada con datos raros (por ejemplo, sin renglones) que el CRM ya tiene: basta avisar que se canceló,
    // para que no se siga contando como vigente.
    if (String(v.status) === '-1' && enviada) return { venta: { ven_id: error.ven_id, estado: 'cancelada' }, omitida: null };
    // Vigente ya enviada que ahora no se puede leer: se saca del CRM en vez de dejar la versión vieja.
    const omitida = { ven_id: error.ven_id, codigo: error.message };
    return { venta: enviada ? { ven_id: error.ven_id, estado: 'excluida' } : null, omitida };
  }
}
module.exports = { id, decimal, cliente, venta, sobre, cabe, esHorarioHistorico, DATOS_RAROS, clienteSeguro, ventaSegura, articuloSeguro,
  proveedorSeguro, existenciaSegura };
