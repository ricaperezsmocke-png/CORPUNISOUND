const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');

class ErrorIngestaSicar extends Error {
  constructor(status, codigo) {
    super('La solicitud SICAR no cumple el contrato.');
    this.status = status;
    this.codigo = codigo;
  }
}
const fallar = (codigo = 'DATOS_INVALIDOS', status = 422) => { throw new ErrorIngestaSicar(status, codigo); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esId = valor => typeof valor === 'string' && /^[1-9][0-9]{0,127}$/.test(valor);
const hashSicar = valor => createHash('sha256').update(valor).digest('hex');

function objeto(valor, permitidas) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) fallar();
  if (Object.keys(valor).some(k => !permitidas.includes(k))) fallar('PROPIEDAD_NO_DECLARADA', 400);
}
function texto(valor, maximo, opcional = false) {
  if (opcional && (valor === null || valor === undefined)) return;
  if (typeof valor !== 'string' || valor.length > maximo || (!opcional && !valor.trim())) fallar();
  // Rechaza caracteres de sustitución y controles: no persiste texto mal decodificado.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(valor)) fallar('TEXTO_INVALIDO');
}
function decimal(valor, escala) {
  if (typeof valor !== 'string' || valor.length > 32 || !new RegExp(`^\\d+\\.\\d{${escala}}$`).test(valor)) fallar('IMPORTE_INVALIDO');
  if (BigInt(valor.replace('.', '')) > BigInt(Number.MAX_SAFE_INTEGER)) fallar('IMPORTE_INVALIDO');
}
function fecha(valor, local = false) {
  const patron = local ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof valor !== 'string' || !patron.test(valor)) fallar('FECHA_INVALIDA');
  const base = valor.slice(0, 19);
  const instante = new Date(`${base}Z`);
  if (!Number.isFinite(instante.getTime()) || instante.toISOString().slice(0, 19) !== base) fallar('FECHA_INVALIDA');
  if (!local && !Number.isFinite(Date.parse(valor))) fallar('FECHA_INVALIDA');
}
function arreglo(valor, maximo, id, unico = true) {
  if (!Array.isArray(valor) || valor.length > maximo) fallar('LIMITE_ENTIDADES');
  const vistos = new Set();
  for (const fila of valor) {
    if (!fila || !esId(fila[id])) fallar('ID_INVALIDO');
    if (unico && vistos.has(fila[id])) fallar('ID_DUPLICADO');
    vistos.add(fila[id]);
  }
}

function enReferencia(referencia, validar) {
  try { return validar(); }
  catch (e) { if (e instanceof ErrorIngestaSicar && !e.referencia) e.referencia = referencia; throw e; }
}

function validarDetalle(d) {
  objeto(d, ['art_id', 'clave', 'descripcion', 'cantidad', 'precio_con', 'precio_sin', 'importe_con', 'descuento_total']);
  texto(d.clave, 100, true);
  texto(d.descripcion, 500);
  for (const campo of ['cantidad', 'precio_con', 'precio_sin']) decimal(d[campo], 4);
  for (const campo of ['importe_con', 'descuento_total']) decimal(d[campo], 2);
}

function validarArticulo(a, indice) {
  objeto(a, ['art_id', 'clave', 'descripcion', 'categoria', 'departamento']);
  if (!esId(a.art_id)) fallar('ID_INVALIDO');
  const textoArticulo = (valor, maximo, opcional = false) => {
    try { texto(valor, maximo, opcional); }
    catch (e) {
      if (e instanceof ErrorIngestaSicar && e.codigo === 'DATOS_INVALIDOS') fallar('TEXTO_INVALIDO');
      throw e;
    }
  };
  // Mismos máximos que los renglones de venta para clave y descripción.
  textoArticulo(a.descripcion, 500);
  for (const [campo, maximo] of [['clave', 100], ['categoria', 100], ['departamento', 100]]) {
    enReferencia(`articulos[${indice}].${campo}`, () => textoArticulo(a[campo], maximo, true));
  }
}

// Proveedor de SICAR para el Radar de Demanda: id y nombre (mismo máximo que el nombre del cliente).
function validarProveedor(p) {
  objeto(p, ['prv_id', 'nombre']);
  if (!esId(p.prv_id)) fallar('ID_INVALIDO');
  try { texto(p.nombre, 250); }
  catch (e) {
    if (e instanceof ErrorIngestaSicar && e.codigo === 'DATOS_INVALIDOS') fallar('TEXTO_INVALIDO');
    throw e;
  }
}

// Existencia de SICAR para la pantalla Existencias SICAR: art_id y cantidad como texto exacto con cuatro decimales; null = ya no vigente.
function validarExistencia(e) {
  objeto(e, ['art_id', 'existencia']);
  if (!esId(e.art_id)) fallar('ID_INVALIDO');
  if (e.existencia === null) return;
  if (typeof e.existencia !== 'string' || !/^-?\d{1,16}\.\d{4}$/.test(e.existencia)) fallar('IMPORTE_INVALIDO');
  if (BigInt(e.existencia.replace('-', '').replace('.', '')) > BigInt(Number.MAX_SAFE_INTEGER)) fallar('IMPORTE_INVALIDO');
}

// Importe con signo para cortes: texto con dos decimales exactos; el valor sin punto no pasa del entero seguro.
function importeConSigno(valor) {
  if (typeof valor !== 'string' || !/^-?\d{1,16}\.\d{2}$/.test(valor)) fallar('IMPORTE_INVALIDO');
  if (BigInt(valor.replace('-', '').replace('.', '')) > BigInt(Number.MAX_SAFE_INTEGER)) fallar('IMPORTE_INVALIDO');
}
const conteo = valor => { if (!Number.isInteger(valor) || valor < 0 || valor > 100000) fallar(); };

// Corte de caja de SICAR con sus pagos por forma de pago y sus cobros por usuario (usu_id null = ventas sin alta en historial).
function validarCorte(c) {
  objeto(c, ['cor_id', 'caj_id', 'fecha_local', 'usu_id', 'contado', 'calculado', 'diferencia', 'retiro', 'pagos', 'cobros']);
  if (!esId(c.cor_id) || !esId(c.caj_id) || (c.usu_id !== null && !esId(c.usu_id))) fallar('ID_INVALIDO');
  fecha(c.fecha_local, true);
  for (const campo of ['contado', 'calculado', 'diferencia', 'retiro']) importeConSigno(c[campo]);
  arreglo(c.pagos, 8, 'tpa_id');
  for (const p of c.pagos) {
    objeto(p, ['tpa_id', 'contado', 'calculado', 'diferencia', 'retiro']);
    for (const campo of ['contado', 'calculado', 'diferencia', 'retiro']) importeConSigno(p[campo]);
  }
  if (!Array.isArray(c.cobros) || c.cobros.length > 50) fallar('LIMITE_ENTIDADES');
  const usuarios = new Set();
  for (const b of c.cobros) {
    objeto(b, ['usu_id', 'ventas', 'total', 'canceladas', 'total_canceladas']);
    if (b.usu_id !== null && !esId(b.usu_id)) fallar('ID_INVALIDO');
    if (usuarios.has(b.usu_id)) fallar('ID_DUPLICADO');
    usuarios.add(b.usu_id);
    conteo(b.ventas);
    conteo(b.canceladas);
    importeConSigno(b.total);
    importeConSigno(b.total_canceladas);
  }
}

function validarVenta(v, indice) {
  objeto(v, ['ven_id', 'cli_id', 'fecha_local', 'timezone', 'estado', 'moneda', 'total', 'detalle']);
  if (!['vigente', 'cancelada', 'excluida'].includes(v.estado)) fallar('ESTADO_INVALIDO');
  if (v.estado === 'excluida' || (v.estado === 'cancelada' && v.cli_id === undefined)) {
    objeto(v, ['ven_id', 'estado']);
    return 0;
  }
  if (!esId(v.cli_id)) fallar('ID_INVALIDO');
  fecha(v.fecha_local, true);
  if (v.timezone !== 'America/Mexico_City' || v.moneda !== 'MXN') fallar('MONEDA_ZONA_INVALIDA');
  decimal(v.total, 2);
  arreglo(v.detalle, 500, 'art_id', false);
  if (!v.detalle.length) fallar('DETALLE_VACIO');
  v.detalle.forEach((d, i) => enReferencia(`ventas[${indice}].detalle[${i}]`, () => validarDetalle(d)));
  return v.detalle.length;
}

function validarSobreSicar(body) {
  objeto(body, ['schema_version', 'mapping_version', 'batch_id', 'sequence', 'captured_at', 'mode', 'window', 'clientes', 'ventas', 'articulos',
    'proveedores', 'existencias', 'cortes']);
  if (body.schema_version !== 1) fallar('VERSION_NO_SOPORTADA', 400);
  if (typeof body.batch_id !== 'string' || !UUID.test(body.batch_id)) fallar('BATCH_INVALIDO', 400);
}

function validarLoteSicar(body, mapping = 'ocosingo-f0-v1') {
  validarSobreSicar(body);
  if (body.mapping_version !== mapping) fallar('MAPEO_NO_SOPORTADO', 400);
  if (!esId(body.sequence)) fallar('SECUENCIA_INVALIDA');
  fecha(body.captured_at);
  if (!['incremental', 'historico', 'conciliacion'].includes(body.mode)) fallar('MODO_INVALIDO');
  objeto(body.window, ['from', 'to']);
  fecha(body.window.from);
  fecha(body.window.to);
  if (Date.parse(body.window.from) > Date.parse(body.window.to)) fallar('VENTANA_INVALIDA');
  arreglo(body.clientes, 100, 'cli_id');
  arreglo(body.ventas, 100, 'ven_id');
  if (body.articulos !== undefined) {
    arreglo(body.articulos, 500, 'art_id');
    body.articulos.forEach((a, i) => enReferencia(`articulos[${i}]`, () => validarArticulo(a, i)));
  }
  if (body.proveedores !== undefined) {
    arreglo(body.proveedores, 500, 'prv_id');
    body.proveedores.forEach((p, i) => enReferencia(`proveedores[${i}]`, () => validarProveedor(p)));
  }
  if (body.existencias !== undefined) {
    arreglo(body.existencias, 500, 'art_id');
    body.existencias.forEach((e, i) => enReferencia(`existencias[${i}]`, () => validarExistencia(e)));
  }
  if (body.cortes !== undefined) {
    arreglo(body.cortes, 100, 'cor_id');
    body.cortes.forEach((c, i) => enReferencia(`cortes[${i}]`, () => validarCorte(c)));
  }
  body.clientes.forEach((c, i) => enReferencia(`clientes[${i}]`, () => {
    objeto(c, ['cli_id', 'nombre', 'telefono', 'celular', 'email', 'rfc']);
    texto(c.nombre, 250);
    for (const [campo, max] of [['telefono', 40], ['celular', 40], ['email', 254], ['rfc', 13]]) texto(c[campo], max, true);
  }));
  let lineas = 0;
  body.ventas.forEach((v, i) => {
    lineas += enReferencia(`ventas[${i}]`, () => validarVenta(v, i));
    if (lineas > 1000) fallar('LIMITE_ENTIDADES');
  });
  return body;
}

function crearLlaveSicar(repo, sucursalId, actor) {
  const keyId = randomUUID();
  const secreto = randomBytes(32).toString('hex');
  const creada = new Date().toISOString();
  repo.guardarLlave({ key_id: keyId, sucursal_id: sucursalId, secreto_hash: hashSicar(secreto), creada, actor: String(actor) });
  return { key_id: keyId, sucursal_id: sucursalId, creada, llave: `${keyId}.${secreto}` };
}

function autenticarLlaveSicar(repo, authorization) {
  const coincidencia = typeof authorization === 'string' && /^Bearer ([\da-f-]{36})\.([\da-f]{64})$/i.exec(authorization);
  if (!coincidencia) return null;
  const llave = repo.obtenerLlave(coincidencia[1]);
  const esperado = Buffer.from(llave?.secreto_hash || '0'.repeat(64), 'hex');
  const recibido = Buffer.from(hashSicar(coincidencia[2]), 'hex');
  const coincide = esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
  return coincide && llave && !llave.revocada ? llave : null;
}

function crearControlSicar(reloj = Date.now) {
  const ventanas = new Map(), ocupadas = new Set();
  return {
    admitir(id) {
      const ahora = reloj();
      for (const [clave, v] of ventanas) if (ahora - v.desde >= 60000) ventanas.delete(clave);
      let ventana = ventanas.get(id);
      if (!ventana) {
        if (ventanas.size >= 10000) return false;
        ventana = { desde: ahora, cantidad: 0 };
        ventanas.set(id, ventana);
      }
      return ++ventana.cantidad <= 12;
    },
    ocupar(id) { if (ocupadas.has(id)) return false; ocupadas.add(id); return true; },
    liberar(id) { ocupadas.delete(id); },
  };
}

module.exports = { validarLoteSicar, validarSobreSicar, crearLlaveSicar, autenticarLlaveSicar, crearControlSicar, hashSicar, UUID };
