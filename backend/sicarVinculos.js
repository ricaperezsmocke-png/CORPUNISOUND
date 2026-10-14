const { normalizarTelefono } = require('./clientes');

// Ids de "Público en general" medidos en F0 por tienda (sección 14 del plan). Solo Ocosingo está medida.
const PUBLICO_POR_TIENDA = new Map([[1, new Set(['2', '3', '13', '21', '33', '4566', '4567', '4572'])]]);

function esPublicoSicar(cliente) {
  const id = String(cliente.cli_id);
  return id === '1' || !!PUBLICO_POR_TIENDA.get(Number(cliente.sucursal_id))?.has(id)
    || /^P.BLICO EN GENERAL/iu.test(String(cliente.nombre).trim());
}

function telefonos(cliente) {
  const numeros = new Set();
  let ambiguo = false;
  for (const valor of [cliente.telefono, cliente.celular]) {
    let texto = String(valor ?? '').trim();
    if (!texto) continue;
    // El único prefijo que se acepta es +52 escrito explícitamente; cualquier otro queda ambiguo.
    if (/^\+52[\s().-]*\d/.test(texto)) texto = texto.replace(/^\+52/, '').trim();
    // Solo números nacionales completos: no recortar un prefijo internacional.
    if (!/^[\d\s().-]+$/.test(texto) || texto.replace(/\D/g, '').length !== 10) {
      ambiguo = true;
      continue;
    }
    numeros.add(normalizarTelefono(texto));
  }
  return { numeros, ambiguo };
}

// Índice teléfono -> clientes nativos, armado una sola vez por lote (5 mil fuentes x miles de nativos).
function indicePorTelefono(clientes) {
  const indice = new Map();
  for (const c of clientes) {
    if (!Number.isSafeInteger(Number(c.id)) || Number(c.id) <= 0) continue;
    for (const n of telefonos(c).numeros) {
      if (!indice.has(n)) indice.set(n, new Map());
      indice.get(n).set(Number(c.id), c);
    }
  }
  return indice;
}

function candidatosPara(fuente, indice) {
  const { numeros, ambiguo } = telefonos(fuente);
  const candidatos = new Map();
  for (const n of numeros) for (const [id, c] of indice.get(n) || []) candidatos.set(id, c);
  return { ambiguo, candidatos: [...candidatos.values()] };
}

function errorVinculo(status, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

function registrarDecision(sqlite, vinculo, accion, bloquear = 0) {
  sqlite.prepare(`INSERT INTO sicar_decisiones
    (sucursal_id, cli_id, cliente_id, accion, version, bloquear_union, motivo, actor, fecha)
    VALUES (@sucursal_id, @cli_id, @cliente_id, @accion, @version, @bloquear, @motivo, @actor, @actualizada)`)
    .run({ ...vinculo, accion, bloquear });
}

function escribirVinculo(sqlite, vinculo) {
  sqlite.prepare(`INSERT INTO sicar_vinculos
    (sucursal_id, cli_id, cliente_id, estado, version, motivo, actor, creada, actualizada)
    VALUES (@sucursal_id, @cli_id, @cliente_id, @estado, @version, @motivo, @actor, @creada, @actualizada)
    ON CONFLICT(sucursal_id, cli_id) DO UPDATE SET cliente_id=excluded.cliente_id, estado=excluded.estado,
      version=excluded.version, motivo=excluded.motivo, actor=excluded.actor, actualizada=excluded.actualizada`).run(vinculo);
}

function resolverVinculosSicar(repo, clientesNativos, identidades) {
  const sqlite = repo.conexionParaVinculos();
  const indice = indicePorTelefono(clientesNativos);
  return sqlite.transaction(() => {
    for (const identidad of identidades) {
      const fuente = sqlite.prepare('SELECT * FROM sicar_clientes WHERE sucursal_id=? AND cli_id=?')
        .get(Number(identidad.sucursal_id), String(identidad.cli_id));
      if (!fuente || esPublicoSicar(fuente)) continue;
      const anterior = sqlite.prepare('SELECT * FROM sicar_vinculos WHERE sucursal_id=? AND cli_id=?')
        .get(fuente.sucursal_id, fuente.cli_id);
      const bloqueada = sqlite.prepare(`SELECT 1 FROM sicar_decisiones
        WHERE sucursal_id=? AND cli_id=? AND bloquear_union=1 LIMIT 1`).get(fuente.sucursal_id, fuente.cli_id);
      if (bloqueada) continue;
      const ahora = new Date().toISOString();
      if (anterior?.estado === 'confirmado') {
        if (identidad.telefonosCambiaron) {
          const aviso = { ...anterior, motivo: 'Teléfono fuente cambiado; revisar la unión confirmada.',
            version: anterior.version + 1, actualizada: ahora };
          escribirVinculo(sqlite, aviso);
          registrarDecision(sqlite, aviso, 'aviso');
        }
        continue;
      }
      const { ambiguo, candidatos } = candidatosPara(fuente, indice);
      const unico = !ambiguo && candidatos.length === 1;
      const clienteId = unico ? Number(candidatos[0].id) : null;
      const estado = unico ? 'pendiente' : ambiguo || candidatos.length > 1 ? 'revision' : 'externo';
      const motivo = unico ? 'Coincidencia única por teléfono; unión pendiente de revisión.'
        : ambiguo ? 'Teléfono incompleto, ambiguo o extranjero; sin unión automática.'
          : candidatos.length > 1 ? 'Varios candidatos por teléfono; sin unión automática.' : 'Sin coincidencia por teléfono.';
      if (anterior?.cliente_id === clienteId && anterior.estado === estado && anterior.motivo === motivo) continue;
      const nuevo = { sucursal_id: fuente.sucursal_id, cli_id: fuente.cli_id, cliente_id: clienteId, estado,
        version: (anterior?.version ?? 0) + 1, motivo, actor: 'automatico', creada: anterior?.creada ?? ahora, actualizada: ahora };
      escribirVinculo(sqlite, nuevo);
      registrarDecision(sqlite, nuevo, 'propuesta');
    }
  }).immediate();
}

function puedeResolver(vinculo, clientes, alcance, actor) {
  const cliente = clientes.find(c => Number(c.id) === vinculo.cliente_id);
  const misma = cliente && Number(cliente.sucursal_id) === vinculo.sucursal_id;
  if (!alcance.verTodas && Number(alcance.sucursalId) !== vinculo.sucursal_id) return false;
  if (vinculo.cliente_id != null && !misma && !actor.administrador) return false;
  return true;
}

function resolverDecisionSicar(repo, identidad, datos, actor, alcance) {
  const sqlite = repo.conexionParaVinculos();
  return sqlite.transaction(() => {
    const vinculo = sqlite.prepare(`SELECT v.*, c.nombre FROM sicar_vinculos v JOIN sicar_clientes c
      USING(sucursal_id, cli_id) WHERE v.sucursal_id=? AND v.cli_id=?`)
      .get(Number(identidad.sucursal_id), String(identidad.cli_id));
    if (!vinculo || esPublicoSicar(vinculo) || !puedeResolver(vinculo, repo.clientesNativos(), alcance, actor)) {
      throw errorVinculo(404, 'Vínculo no encontrado.');
    }
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)
      || Object.keys(datos).some(k => !['accion', 'expected_version', 'motivo'].includes(k))
      || !['confirmar', 'deshacer'].includes(datos.accion) || typeof datos.motivo !== 'string'
      || !datos.motivo.trim() || datos.motivo.length > 500
      || !['number', 'string'].includes(typeof datos.expected_version)
      || !Number.isSafeInteger(Number(datos.expected_version)) || Number(datos.expected_version) < 1) {
      throw errorVinculo(400, 'Indica acción, motivo y versión válidos.');
    }
    if (vinculo.version !== Number(datos.expected_version)) throw errorVinculo(409, 'Otro revisor cambió el vínculo. Actualiza la cola.');
    if (!['pendiente', 'confirmado'].includes(vinculo.estado) || vinculo.cliente_id == null) {
      throw errorVinculo(409, 'Esta identidad no tiene una unión que se pueda resolver.');
    }
    const nuevo = { ...vinculo, cliente_id: datos.accion === 'deshacer' ? null : vinculo.cliente_id,
      estado: datos.accion === 'deshacer' ? 'separado' : 'confirmado', version: vinculo.version + 1,
      motivo: datos.motivo.trim(), actor: String(actor.id), actualizada: new Date().toISOString() };
    escribirVinculo(sqlite, nuevo);
    registrarDecision(sqlite, { ...nuevo, cliente_id: vinculo.cliente_id }, datos.accion, datos.accion === 'deshacer' ? 1 : 0);
    return { estado: nuevo.estado, version: nuevo.version };
  }).immediate();
}

function listarVinculosSicar(repo, alcance, actor, offset = 0) {
  const sqlite = repo.conexionParaVinculos();
  const sucursal = alcance.verTodas ? null : Number(alcance.sucursalId);
  if (!alcance.verTodas && (!Number.isSafeInteger(sucursal) || sucursal < 1)) throw errorVinculo(404, 'Tienda no encontrada.');
  if (!Number.isSafeInteger(offset) || offset < 0) throw errorVinculo(400, 'Página inválida.');
  const filas = sqlite.prepare(`SELECT c.*, v.cliente_id, v.estado, v.version, v.motivo FROM sicar_clientes c
    JOIN sicar_vinculos v USING(sucursal_id, cli_id)
    WHERE (? IS NULL OR c.sucursal_id=?) ORDER BY c.sucursal_id, c.cli_id LIMIT 51 OFFSET ?`).all(sucursal, sucursal, offset);
  const clientes = repo.clientesNativos();
  const resumen = sqlite.prepare(`SELECT COALESCE(SUM(total_centavos), 0) monto_centavos,
    COUNT(*) numero_compras, MAX(fecha_local) ultima_compra FROM sicar_ventas
    WHERE sucursal_id=? AND cli_id=? AND estado='vigente'`);
  return {
    items: filas.slice(0, 50).filter(c => !esPublicoSicar(c)).map(c => {
      const nativo = clientes.find(n => Number(n.id) === c.cliente_id);
      const visible = nativo && (alcance.verTodas || Number(nativo.sucursal_id) === sucursal);
      return { sucursal_id: c.sucursal_id, cli_id: c.cli_id, nombre: c.nombre, telefono: c.telefono, celular: c.celular,
        cliente_ref: visible ? `crm:${c.cliente_id}` : `sicar:${c.sucursal_id}:${c.cli_id}`,
        cliente_nombre: visible ? nativo.nombre : null, estado: c.estado, version: c.version, motivo: c.motivo,
        puede_resolver: puedeResolver(c, clientes, alcance, actor) && c.cliente_id != null,
        ...resumen.get(c.sucursal_id, c.cli_id) };
    }),
    siguiente: filas.length > 50 ? offset + 50 : null,
  };
}

// Solo las altas nativas existentes pasan por aquí; nunca se crean nativos desde SICAR.
// Únicamente se re-evalúan las fuentes SICAR que comparten teléfono con los clientes recién creados.
function crearNativoConVinculos(repo, DB, guardar, crear) {
  if (!repo) return crear();
  const previo = { crm: structuredClone(DB.crm), radar: structuredClone(DB.radar_demanda) };
  const idsPrevios = new Set((DB.crm?.clientes || []).map(c => Number(c.id)));
  const sqlite = repo.conexionParaVinculos();
  let creado = false;
  try {
    const { resultado, nuevos } = sqlite.transaction(() => {
      const resultado = crear();
      creado = true;
      const nuevos = DB.crm.clientes.filter(c => !idsPrevios.has(Number(c.id)));
      const numeros = new Set(nuevos.flatMap(c => [...telefonos(c).numeros]));
      if (numeros.size) {
        const identidades = sqlite.prepare('SELECT sucursal_id, cli_id, telefono, celular FROM sicar_clientes').all()
          .filter(f => [...telefonos(f).numeros].some(n => numeros.has(n)));
        resolverVinculosSicar(repo, DB.crm.clientes, identidades);
      }
      guardar(DB);
      return { resultado, nuevos };
    }).immediate();
    const pendiente = nuevos.length && sqlite.prepare(`SELECT 1 FROM sicar_vinculos WHERE estado='pendiente'
      AND cliente_id IN (${nuevos.map(() => '?').join(',')}) LIMIT 1`).get(...nuevos.map(c => Number(c.id)));
    if (!pendiente || !resultado || typeof resultado !== 'object' || Array.isArray(resultado)) return resultado;
    return { ...resultado, aviso_sicar: 'Unión SICAR pendiente de revisión.' };
  } catch (error) {
    DB.crm = previo.crm;
    if (previo.radar === undefined) delete DB.radar_demanda;
    else DB.radar_demanda = previo.radar;
    // Un error de validación del alta conserva su respuesta; cualquier fallo al ligar o guardar es 503.
    if (creado && !error.status) throw errorVinculo(503, 'No se pudo guardar el cliente y sus vínculos.');
    throw error;
  }
}

module.exports = { resolverVinculosSicar, resolverDecisionSicar, listarVinculosSicar, crearNativoConVinculos, esPublicoSicar };
