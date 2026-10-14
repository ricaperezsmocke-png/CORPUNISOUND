class ErrorSicar extends Error {
  constructor(codigo, mensaje, siguienteSecuencia) {
    super(mensaje);
    this.name = 'ErrorSicar';
    this.codigo = codigo;
    if (siguienteSecuencia !== undefined) this.siguiente_secuencia = siguienteSecuencia;
  }
}

const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS sicar_esquema (
    version INTEGER PRIMARY KEY, aplicada TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sicar_tiendas (
    sucursal_id INTEGER PRIMARY KEY, habilitada INTEGER NOT NULL DEFAULT 0 CHECK (habilitada IN (0, 1)),
    mapping_version TEXT, siguiente_secuencia TEXT NOT NULL DEFAULT '1',
    ultima_recepcion TEXT, ultima_conciliacion TEXT
  );
  CREATE TABLE IF NOT EXISTS sicar_llaves (
    key_id TEXT PRIMARY KEY NOT NULL, sucursal_id INTEGER NOT NULL, secreto_hash TEXT NOT NULL,
    creada TEXT NOT NULL, revocada TEXT, actor TEXT NOT NULL,
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_clientes (
    sucursal_id INTEGER NOT NULL, cli_id TEXT NOT NULL, nombre TEXT NOT NULL,
    telefono TEXT, celular TEXT, email TEXT, rfc TEXT, status TEXT, clave TEXT,
    PRIMARY KEY (sucursal_id, cli_id),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_vinculos (
    sucursal_id INTEGER NOT NULL, cli_id TEXT NOT NULL, cliente_id INTEGER,
    estado TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, motivo TEXT, actor TEXT,
    creada TEXT NOT NULL, actualizada TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, cli_id),
    FOREIGN KEY (sucursal_id, cli_id) REFERENCES sicar_clientes(sucursal_id, cli_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_decisiones (
    id INTEGER PRIMARY KEY, sucursal_id INTEGER NOT NULL, cli_id TEXT NOT NULL,
    cliente_id INTEGER, accion TEXT NOT NULL, version INTEGER NOT NULL,
    bloquear_union INTEGER NOT NULL DEFAULT 0 CHECK (bloquear_union IN (0, 1)),
    motivo TEXT, actor TEXT NOT NULL, fecha TEXT NOT NULL,
    FOREIGN KEY (sucursal_id, cli_id) REFERENCES sicar_clientes(sucursal_id, cli_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_ventas (
    sucursal_id INTEGER NOT NULL, ven_id TEXT NOT NULL, cli_id TEXT,
    fecha_local TEXT NOT NULL, estado TEXT NOT NULL CHECK (estado IN ('vigente', 'cancelada', 'excluida')),
    total_centavos INTEGER NOT NULL CHECK (typeof(total_centavos) = 'integer' AND total_centavos BETWEEN 0 AND 9007199254740991),
    revision TEXT NOT NULL, hash TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, ven_id),
    CHECK (cli_id IS NOT NULL OR estado = 'excluida'),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id),
    FOREIGN KEY (sucursal_id, cli_id) REFERENCES sicar_clientes(sucursal_id, cli_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_detalles (
    sucursal_id INTEGER NOT NULL, ven_id TEXT NOT NULL, art_id TEXT NOT NULL,
    clave TEXT, descripcion TEXT NOT NULL, cantidad TEXT NOT NULL,
    precio_con TEXT NOT NULL, precio_sin TEXT NOT NULL,
    importe_centavos INTEGER NOT NULL CHECK (typeof(importe_centavos) = 'integer' AND importe_centavos BETWEEN 0 AND 9007199254740991),
    descuento_centavos INTEGER NOT NULL CHECK (typeof(descuento_centavos) = 'integer' AND descuento_centavos BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY (sucursal_id, ven_id, art_id),
    FOREIGN KEY (sucursal_id, ven_id) REFERENCES sicar_ventas(sucursal_id, ven_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_envios (
    sucursal_id INTEGER NOT NULL, batch_id TEXT NOT NULL, secuencia TEXT NOT NULL,
    hash TEXT NOT NULL, respuesta TEXT NOT NULL, clientes INTEGER NOT NULL, ventas INTEGER NOT NULL,
    rechazados INTEGER NOT NULL, fecha TEXT NOT NULL, resultado TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, batch_id), UNIQUE (sucursal_id, secuencia),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_intentos (
    id INTEGER PRIMARY KEY, sucursal_id INTEGER, key_id TEXT, batch_id TEXT,
    recibidos INTEGER, aceptados INTEGER, rechazados INTEGER, bytes INTEGER,
    codigo TEXT NOT NULL, hora TEXT NOT NULL, duracion_ms INTEGER,
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id),
    FOREIGN KEY (key_id) REFERENCES sicar_llaves(key_id)
  );
  CREATE INDEX IF NOT EXISTS sicar_ventas_cliente ON sicar_ventas(sucursal_id, cli_id, estado, fecha_local, ven_id);
  CREATE INDEX IF NOT EXISTS sicar_vinculos_cliente ON sicar_vinculos(cliente_id);
  CREATE INDEX IF NOT EXISTS sicar_intentos_hora ON sicar_intentos(hora);
  INSERT OR IGNORE INTO sicar_esquema(version, aplicada) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`;

// Los importes se convierten sin aritmética decimal binaria. Los precios unitarios
// conservan sus cuatro decimales exactos como texto, conforme al contrato v1.
function centavos(decimal) {
  if (typeof decimal !== 'string' || !/^\d+\.\d{2}$/.test(decimal)) {
    throw new ErrorSicar('IMPORTE_INVALIDO', 'El importe debe tener dos decimales.');
  }
  const valor = BigInt(decimal.replace('.', ''));
  if (valor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ErrorSicar('IMPORTE_INVALIDO', 'El importe excede el máximo entero seguro.');
  }
  return Number(valor);
}

function prepararEscrituras(sqlite) {
  return {
    tienda: sqlite.prepare('INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (?)'),
    cliente: sqlite.prepare(`INSERT INTO sicar_clientes
      (sucursal_id, cli_id, nombre, telefono, celular, email, rfc, status, clave)
      VALUES (@sucursal_id, @cli_id, @nombre, @telefono, @celular, @email, @rfc, @status, @clave)
      ON CONFLICT(sucursal_id, cli_id) DO UPDATE SET nombre=excluded.nombre, telefono=excluded.telefono,
        celular=excluded.celular, email=excluded.email, rfc=excluded.rfc, status=excluded.status, clave=excluded.clave`),
    venta: sqlite.prepare(`INSERT INTO sicar_ventas
      (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash, cuadra)
      VALUES (@sucursal_id, @ven_id, @cli_id, @fecha_local, @estado, @total_centavos, @revision, @hash, @cuadra)
      ON CONFLICT(sucursal_id, ven_id) DO UPDATE SET cli_id=excluded.cli_id, fecha_local=excluded.fecha_local,
        estado=excluded.estado, total_centavos=excluded.total_centavos, revision=excluded.revision, hash=excluded.hash, cuadra=excluded.cuadra`),
    tombstone: sqlite.prepare(`UPDATE sicar_ventas SET estado=@estado, revision=@revision, hash=@hash,
      cli_id=CASE WHEN @estado='excluida' THEN NULL ELSE cli_id END WHERE sucursal_id=@sucursal_id AND ven_id=@ven_id`),
    borrarDetalle: sqlite.prepare('DELETE FROM sicar_detalles WHERE sucursal_id=? AND ven_id=?'),
    detalle: sqlite.prepare(`INSERT INTO sicar_detalles
      (sucursal_id, ven_id, art_id, clave, descripcion, cantidad, precio_con, precio_sin, importe_centavos, descuento_centavos)
      VALUES (@sucursal_id, @ven_id, @art_id, @clave, @descripcion, @cantidad, @precio_con, @precio_sin, @importe_centavos, @descuento_centavos)`),
    envio: sqlite.prepare(`INSERT INTO sicar_envios
      (sucursal_id, batch_id, secuencia, hash, respuesta, clientes, ventas, rechazados, fecha, resultado)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'aceptado')`),
    avanzar: sqlite.prepare(`UPDATE sicar_tiendas SET siguiente_secuencia=?, ultima_recepcion=?,
      mapping_version=COALESCE(?, mapping_version) WHERE sucursal_id=?`),
  };
}

function escribirVenta(sentencias, sucursalId, venta, revision, hash) {
  const identidad = { sucursal_id: sucursalId, ven_id: venta.ven_id, estado: venta.estado, revision, hash };
  if (venta.estado === 'excluida' || (venta.estado === 'cancelada' && venta.cli_id === undefined)) {
    sentencias.tombstone.run(identidad);
    if (venta.estado === 'excluida') sentencias.borrarDetalle.run(sucursalId, venta.ven_id);
    return;
  }
  const total = centavos(venta.total);
  const suma = venta.detalle.reduce((acumulado, d) => acumulado + BigInt(centavos(d.importe_con)), 0n);
  sentencias.venta.run({ ...identidad, cli_id: venta.cli_id, fecha_local: venta.fecha_local,
    total_centavos: total, cuadra: suma === BigInt(total) ? 1 : 0 });
  sentencias.borrarDetalle.run(sucursalId, venta.ven_id);
  for (const detalle of venta.detalle) {
    sentencias.detalle.run({
      sucursal_id: sucursalId, ven_id: venta.ven_id, art_id: detalle.art_id, clave: detalle.clave ?? null,
      descripcion: detalle.descripcion, cantidad: detalle.cantidad, precio_con: detalle.precio_con, precio_sin: detalle.precio_sin,
      importe_centavos: centavos(detalle.importe_con), descuento_centavos: centavos(detalle.descuento_total),
    });
  }
}

function crearRepositorioSicar(sqlite) {
  sqlite.pragma('foreign_keys = ON');
  if (sqlite.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new ErrorSicar('FK_DESACTIVADAS', 'No se pudieron activar las claves foráneas.');
  }
  sqlite.transaction(() => {
    sqlite.exec(ESQUEMA);
    if (!sqlite.prepare('SELECT 1 FROM sicar_esquema WHERE version=2').get()) {
      sqlite.exec('ALTER TABLE sicar_ventas ADD COLUMN cuadra INTEGER NOT NULL DEFAULT 0 CHECK (cuadra IN (0, 1))');
      // BigInt evita desbordar al conciliar detalles históricos; el total fuente nunca se ajusta.
      const detalles = sqlite.prepare('SELECT importe_centavos FROM sicar_detalles WHERE sucursal_id=? AND ven_id=?');
      const marcar = sqlite.prepare('UPDATE sicar_ventas SET cuadra=? WHERE sucursal_id=? AND ven_id=?');
      for (const venta of sqlite.prepare('SELECT sucursal_id, ven_id, total_centavos FROM sicar_ventas').all()) {
        const suma = detalles.all(venta.sucursal_id, venta.ven_id).reduce((n, d) => n + BigInt(d.importe_centavos), 0n);
        marcar.run(suma === BigInt(venta.total_centavos) ? 1 : 0, venta.sucursal_id, venta.ven_id);
      }
      sqlite.prepare('INSERT INTO sicar_esquema(version, aplicada) VALUES (2, ?)').run(new Date().toISOString());
    }
  })();
  const sentencias = prepararEscrituras(sqlite);
  const leerEstado = sqlite.prepare('SELECT siguiente_secuencia, ultima_recepcion FROM sicar_tiendas WHERE sucursal_id=?');
  const leerEnvio = sqlite.prepare('SELECT hash, respuesta FROM sicar_envios WHERE sucursal_id=? AND batch_id=?');

  function estado(sucursalId) {
    return leerEstado.get(sucursalId) ?? { siguiente_secuencia: '1', ultima_recepcion: null };
  }

  function reciboAnterior(sucursalId, batchId, hash) {
    const anterior = leerEnvio.get(sucursalId, batchId);
    if (!anterior) return null;
    if (anterior.hash !== hash) throw new ErrorSicar('CONFLICTO_BATCH', 'El lote ya existe con otro hash.');
    return JSON.parse(anterior.respuesta);
  }

  // T1b valida el contrato HTTP. Aquí solo se reciben lotes ya validados.
  const aplicar = sqlite.transaction(({ sucursalId, lote, hash }) => {
    const anterior = reciboAnterior(sucursalId, lote.batch_id, hash);
    if (anterior) return anterior;
    const siguiente = estado(sucursalId).siguiente_secuencia;
    if (lote.sequence !== siguiente) {
      throw new ErrorSicar('SECUENCIA_INCORRECTA', 'La secuencia no es la siguiente esperada.', siguiente);
    }
    sentencias.tienda.run(sucursalId);
    for (const cliente of lote.clientes) {
      sentencias.cliente.run({
        sucursal_id: sucursalId, cli_id: cliente.cli_id, nombre: cliente.nombre,
        telefono: cliente.telefono ?? null, celular: cliente.celular ?? null, email: cliente.email ?? null,
        rfc: cliente.rfc ?? null, status: cliente.status ?? null, clave: cliente.clave ?? null,
      });
    }
    for (const venta of lote.ventas) escribirVenta(sentencias, sucursalId, venta, lote.sequence, hash);
    const recibo = {
      schema_version: 1, batch_id: lote.batch_id, sequence: lote.sequence,
      aceptados: { clientes: lote.clientes.length, ventas: lote.ventas.length }, rechazados: 0,
      next_sequence: (BigInt(lote.sequence) + 1n).toString(), received_at: new Date().toISOString(),
    };
    sentencias.envio.run(sucursalId, lote.batch_id, lote.sequence, hash, JSON.stringify(recibo),
      recibo.aceptados.clientes, recibo.aceptados.ventas, recibo.received_at);
    sentencias.avanzar.run(recibo.next_sequence, recibo.received_at, lote.mapping_version, sucursalId);
    return recibo;
  });

  const guardarLlave = sqlite.transaction(llave => {
    sentencias.tienda.run(llave.sucursal_id);
    sqlite.prepare(`INSERT INTO sicar_llaves(key_id, sucursal_id, secreto_hash, creada, actor)
      VALUES (@key_id, @sucursal_id, @secreto_hash, @creada, @actor)`).run(llave);
  });
  return {
    conexionParaRespaldo: () => sqlite,
    estado, reciboAnterior, aplicarLote: datos => aplicar.immediate(datos),
    guardarLlave: llave => guardarLlave.immediate(llave),
    obtenerLlave: id => sqlite.prepare('SELECT * FROM sicar_llaves WHERE key_id=?').get(id),
    listarLlaves: () => sqlite.prepare('SELECT key_id, sucursal_id, creada, revocada, actor FROM sicar_llaves ORDER BY creada DESC').all(),
    revocarLlave: id => sqlite.prepare('UPDATE sicar_llaves SET revocada=COALESCE(revocada, ?) WHERE key_id=?').run(new Date().toISOString(), id),
    listarEnvios: sucursalId => sqlite.prepare(`SELECT sucursal_id, batch_id, secuencia, clientes, ventas, rechazados, fecha, resultado
      FROM sicar_envios WHERE (? IS NULL OR sucursal_id=?) ORDER BY fecha DESC, rowid DESC LIMIT 100`).all(sucursalId, sucursalId),
    listarIntentos: sucursalId => sqlite.prepare(`SELECT * FROM sicar_intentos
      WHERE (? IS NULL OR sucursal_id=?) ORDER BY id DESC LIMIT 100`).all(sucursalId, sucursalId),
    registrarIntento: intento => sqlite.prepare(`INSERT INTO sicar_intentos
      (sucursal_id, key_id, batch_id, recibidos, aceptados, rechazados, bytes, codigo, hora, duracion_ms)
      VALUES (@sucursal_id, @key_id, @batch_id, @recibidos, @aceptados, @rechazados, @bytes, @codigo, @hora, @duracion_ms)`).run(intento),
  };
}

module.exports = { crearRepositorioSicar, ErrorSicar };
