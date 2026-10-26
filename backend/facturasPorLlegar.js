/**
 * Facturas por llegar: la administradora sube el XML del proveedor y queda pendiente hasta que la mercancia llegue.
 * Viven en la SQLite de SICAR (tablas facturas_por_llegar*). No mueven inventario ni dinero.
 * Registrar y listar son de la empresa (CEDIS), no de una tienda: ese permiso expone costos.
 */
const { parsearFacturaXML } = require('./cfdi');
const { ahora } = require('./fechas');

const DIAS_AVISO = 15;
const ESTADOS = ['por_llegar', 'llego', 'cancelada'];
const DIA_MS = 86400000;

function error(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

function normalizarUuid(valor) {
  return String(valor ?? '').trim().toUpperCase();
}

// Total en texto ("16217.997") a centavos enteros, con BigInt y redondeo a medio centavo hacia arriba.
function centavosDeTexto(texto) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(texto ?? '').trim());
  if (!m) return null;
  const frac = (m[2] || '').padEnd(3, '0');
  let c = BigInt(m[1]) * 100n + BigInt(frac.slice(0, 2));
  if (frac.charCodeAt(2) >= 53) c += 1n;
  return c <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(c) : null;
}

// Moneda del XML en mayusculas y sin espacios; si no la trae se asume MXN (en CFDI 4.0 es obligatoria y lo usual es MXN).
function normalizarMoneda(valor) {
  return String(valor ?? '').replace(/\s+/g, '').toUpperCase() || 'MXN';
}

function crearFacturasPorLlegar({ sqlite, DB }) {
  const compraRecibida = uuid => (DB.inventario?.compras || []).some(c => normalizarUuid(c.uuid_cfdi) === uuid);
  const historial = (id, accion, actor, detalle) => sqlite.prepare(
    'INSERT INTO facturas_por_llegar_historial(factura_id, accion, actor, fecha, detalle) VALUES (?, ?, ?, ?, ?)')
    .run(id, accion, String(actor), ahora(), detalle ?? null);
  const hidratar = f => {
    if (!f) return f;
    const { conceptos_json: json, ...resto } = f;
    return { ...resto, conceptos: JSON.parse(json), moneda_prohibida: resto.moneda !== 'MXN' };
  };
  const obtener = id => hidratar(sqlite.prepare('SELECT * FROM facturas_por_llegar WHERE id = ?').get(id));
  const llegoSola = id => {
    sqlite.prepare("UPDATE facturas_por_llegar SET estado = 'llego', llego_en = ?, llego_por = 'recepcion' WHERE id = ?")
      .run(ahora(), id);
    historial(id, 'llego', 'recepcion', 'La compra con este folio fiscal ya fue recibida');
  };
  const barrer = () => {
    for (const f of sqlite.prepare("SELECT id, uuid FROM facturas_por_llegar WHERE estado = 'por_llegar'").all()) {
      if (compraRecibida(f.uuid)) llegoSola(f.id);
    }
  };

  function registrar(xml, actor) {
    if (typeof xml !== 'string' || !xml.trim()) throw error(400, 'Falta el archivo XML de la factura.');
    let cfdi;
    try { cfdi = parsearFacturaXML(xml); } catch (e) { throw error(400, e.message); }
    const uuid = normalizarUuid(cfdi.folioFiscal);
    if (!uuid) throw error(400, 'La factura no trae folio fiscal (UUID); no está timbrada.');
    if (cfdi.tipoComprobante !== 'I') throw error(400, 'Solo se aceptan facturas de tipo Ingreso (I).');
    const total = centavosDeTexto(cfdi.total);
    if (total === null) throw error(400, 'La factura no trae un total válido.');
    if (sqlite.prepare('SELECT 1 FROM facturas_por_llegar WHERE uuid = ?').get(uuid)) {
      throw error(409, 'Esa factura ya está registrada.');
    }
    const moneda = normalizarMoneda(cfdi.moneda);
    const tipoCambio = cfdi.tipoCambio === null || cfdi.tipoCambio === undefined ? null : String(cfdi.tipoCambio).trim();
    return sqlite.transaction(() => {
      const id = Number(sqlite.prepare(`INSERT INTO facturas_por_llegar(uuid, rfc_emisor, nombre_emisor, fecha_emision,
        total_centavos, conceptos_json, estado, creada_por, creada_en, moneda, tipo_cambio)
        VALUES (?, ?, ?, ?, ?, ?, 'por_llegar', ?, ?, ?, ?)`)
        .run(uuid, cfdi.emisor.rfc, cfdi.emisor.nombre, cfdi.fecha, total, JSON.stringify(cfdi.conceptos),
          String(actor), ahora(), moneda, tipoCambio).lastInsertRowid);
      historial(id, 'registrar', actor, moneda === 'MXN' ? null : `moneda ${moneda} (prohibida)`);
      if (compraRecibida(uuid)) llegoSola(id);
      return obtener(id);
    })();
  }

  function listar({ estado } = {}) {
    if (estado !== undefined && !ESTADOS.includes(estado)) throw error(400, 'Estado no válido.');
    sqlite.transaction(barrer)();
    const filas = estado
      ? sqlite.prepare('SELECT * FROM facturas_por_llegar WHERE estado = ? ORDER BY id DESC').all(estado)
      : sqlite.prepare('SELECT * FROM facturas_por_llegar ORDER BY id DESC').all();
    const ahoraMs = Date.now();
    const facturas = filas.map(hidratar).map(f => {
      const espera = f.estado === 'por_llegar' ? Math.floor((ahoraMs - Date.parse(f.creada_en)) / DIA_MS) : null;
      return { ...f, dias_espera: espera, aviso: espera !== null && espera > DIAS_AVISO };
    });
    return {
      facturas, vencidas: facturas.filter(f => f.aviso).length, dias_aviso: DIAS_AVISO,
      prohibidas: facturas.filter(f => f.moneda_prohibida).length,
    };
  }

  function cambiar(id, accion, actor, estadoNuevo, campos, detalle) {
    const f = sqlite.prepare('SELECT estado FROM facturas_por_llegar WHERE id = ?').get(id);
    if (!f) throw error(404, 'Factura no encontrada.');
    if (f.estado !== 'por_llegar') throw error(409, 'La factura ya no está por llegar.');
    return sqlite.transaction(() => {
      sqlite.prepare('UPDATE facturas_por_llegar SET estado = ?, llego_en = ?, llego_por = ?, motivo = ? WHERE id = ?')
        .run(estadoNuevo, campos.llego_en ?? null, campos.llego_por ?? null, campos.motivo ?? null, id);
      historial(id, accion, actor, detalle);
      return obtener(id);
    })();
  }

  const marcarLlego = (id, actor) => cambiar(id, 'llego', actor, 'llego',
    { llego_en: ahora(), llego_por: String(actor) }, 'Marcada a mano');
  function cancelar(id, motivo, actor) {
    const texto = typeof motivo === 'string' ? motivo.trim() : '';
    if (texto.length < 3 || texto.length > 200) throw error(400, 'El motivo debe tener entre 3 y 200 caracteres.');
    return cambiar(id, 'cancelar', actor, 'cancelada', { motivo: texto }, texto);
  }

  return { registrar, listar, marcarLlego, cancelar };
}

function registrarRutasFacturasPorLlegar(app, { DB, sqlite, requiereLogin, requierePermiso, resolverPermisosDeRol }) {
  const permiso = clave => [requiereLogin, requierePermiso(clave, resolverPermisosDeRol)];
  const ejecutar = (estadoOk, fn) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const modulo = crearFacturasPorLlegar({ sqlite: sqlite(), DB });
      res.status(estadoOk).json(fn(modulo, String(req.usuarioToken.id), req));
    } catch (e) {
      if (!e.status) console.error('Error en facturas por llegar:', e.message);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo completar la operación.' });
    }
  };
  const idDe = req => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : 0);
  app.post('/api/facturas-por-llegar', ...permiso('registrar_facturas_por_llegar'),
    ejecutar(201, (m, actor, req) => m.registrar(req.body?.xml, actor)));
  app.get('/api/facturas-por-llegar', ...permiso('ver_facturas_por_llegar'),
    ejecutar(200, (m, actor, req) => m.listar({ estado: req.query.estado })));
  app.post('/api/facturas-por-llegar/:id/llego', ...permiso('registrar_facturas_por_llegar'),
    ejecutar(200, (m, actor, req) => m.marcarLlego(idDe(req), actor)));
  app.post('/api/facturas-por-llegar/:id/cancelar', ...permiso('registrar_facturas_por_llegar'),
    ejecutar(200, (m, actor, req) => m.cancelar(idDe(req), req.body?.motivo, actor)));
}

module.exports = { crearFacturasPorLlegar, registrarRutasFacturasPorLlegar, normalizarUuid, centavosDeTexto };
