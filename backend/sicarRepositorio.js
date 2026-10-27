const { esPublicoSicar } = require('./sicarVinculos');

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
  CREATE TABLE IF NOT EXISTS sicar_estados (
    sucursal_id INTEGER NOT NULL, cli_id TEXT NOT NULL, estado TEXT NOT NULL,
    usuario_id INTEGER NOT NULL, fecha_hora TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, cli_id),
    FOREIGN KEY (sucursal_id, cli_id) REFERENCES sicar_clientes(sucursal_id, cli_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_estados_historial (
    id INTEGER PRIMARY KEY, sucursal_id INTEGER NOT NULL, cli_id TEXT NOT NULL,
    anterior TEXT, nuevo TEXT NOT NULL, usuario_id INTEGER NOT NULL, fecha_hora TEXT NOT NULL,
    FOREIGN KEY (sucursal_id, cli_id) REFERENCES sicar_clientes(sucursal_id, cli_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_internas (
    sucursal_id INTEGER NOT NULL, cli_id TEXT NOT NULL, motivo TEXT NOT NULL,
    usuario_id INTEGER NOT NULL, fecha_hora TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, cli_id),
    FOREIGN KEY (sucursal_id, cli_id) REFERENCES sicar_clientes(sucursal_id, cli_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_internas_historial (
    id INTEGER PRIMARY KEY, sucursal_id INTEGER NOT NULL, cli_id TEXT NOT NULL,
    accion TEXT NOT NULL CHECK (accion IN ('marcar','desmarcar')), motivo TEXT NOT NULL,
    usuario_id INTEGER NOT NULL, fecha_hora TEXT NOT NULL,
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
    renglon INTEGER NOT NULL,
    clave TEXT, descripcion TEXT NOT NULL, cantidad TEXT NOT NULL,
    precio_con TEXT NOT NULL, precio_sin TEXT NOT NULL,
    importe_centavos INTEGER NOT NULL CHECK (typeof(importe_centavos) = 'integer' AND importe_centavos BETWEEN 0 AND 9007199254740991),
    descuento_centavos INTEGER NOT NULL CHECK (typeof(descuento_centavos) = 'integer' AND descuento_centavos BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY (sucursal_id, ven_id, renglon),
    FOREIGN KEY (sucursal_id, ven_id) REFERENCES sicar_ventas(sucursal_id, ven_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_articulos (
    sucursal_id INTEGER NOT NULL, art_id TEXT NOT NULL, clave TEXT, descripcion TEXT NOT NULL,
    categoria TEXT, departamento TEXT, actualizado_en TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, art_id),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_proveedores (
    sucursal_id INTEGER NOT NULL, prv_id TEXT NOT NULL, nombre TEXT NOT NULL, actualizado_en TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, prv_id),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_existencias (
    sucursal_id INTEGER NOT NULL, art_id TEXT NOT NULL,
    existencia_diezmilesimas INTEGER NOT NULL CHECK (typeof(existencia_diezmilesimas) = 'integer'),
    actualizado_en TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, art_id),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_cortes (
    sucursal_id INTEGER NOT NULL, cor_id TEXT NOT NULL, caj_id TEXT NOT NULL, fecha_local TEXT NOT NULL, usu_id TEXT,
    contado_centavos INTEGER NOT NULL CHECK (typeof(contado_centavos) = 'integer'),
    calculado_centavos INTEGER NOT NULL CHECK (typeof(calculado_centavos) = 'integer'),
    diferencia_centavos INTEGER NOT NULL CHECK (typeof(diferencia_centavos) = 'integer'),
    retiro_centavos INTEGER NOT NULL CHECK (typeof(retiro_centavos) = 'integer'),
    actualizado_en TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, cor_id),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_cortes_pagos (
    sucursal_id INTEGER NOT NULL, cor_id TEXT NOT NULL, tpa_id TEXT NOT NULL,
    contado_centavos INTEGER NOT NULL CHECK (typeof(contado_centavos) = 'integer'),
    calculado_centavos INTEGER NOT NULL CHECK (typeof(calculado_centavos) = 'integer'),
    diferencia_centavos INTEGER NOT NULL CHECK (typeof(diferencia_centavos) = 'integer'),
    retiro_centavos INTEGER NOT NULL CHECK (typeof(retiro_centavos) = 'integer'),
    PRIMARY KEY (sucursal_id, cor_id, tpa_id),
    FOREIGN KEY (sucursal_id, cor_id) REFERENCES sicar_cortes(sucursal_id, cor_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_cortes_cobros (
    sucursal_id INTEGER NOT NULL, cor_id TEXT NOT NULL, usu_id TEXT NOT NULL DEFAULT '',
    ventas INTEGER NOT NULL, total_centavos INTEGER NOT NULL CHECK (typeof(total_centavos) = 'integer'),
    canceladas INTEGER NOT NULL, total_canceladas_centavos INTEGER NOT NULL CHECK (typeof(total_canceladas_centavos) = 'integer'),
    PRIMARY KEY (sucursal_id, cor_id, usu_id),
    FOREIGN KEY (sucursal_id, cor_id) REFERENCES sicar_cortes(sucursal_id, cor_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_cajeros (
    sucursal_id INTEGER NOT NULL, usu_id TEXT NOT NULL, nombre TEXT NOT NULL, asignado_por TEXT, asignado_en TEXT,
    PRIMARY KEY (sucursal_id, usu_id),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_cajeros_historial (
    id INTEGER PRIMARY KEY, sucursal_id INTEGER NOT NULL, usu_id TEXT NOT NULL,
    nombre_anterior TEXT, nombre_nuevo TEXT NOT NULL, actor TEXT NOT NULL, fecha TEXT NOT NULL,
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_ventas_mostrador (
    sucursal_id INTEGER NOT NULL, ven_id TEXT NOT NULL, fecha_local TEXT NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('vigente', 'cancelada')),
    total_centavos INTEGER NOT NULL CHECK (typeof(total_centavos) = 'integer'),
    actualizado_en TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, ven_id),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_detalles_mostrador (
    sucursal_id INTEGER NOT NULL, ven_id TEXT NOT NULL, renglon INTEGER NOT NULL, art_id TEXT NOT NULL, cantidad TEXT NOT NULL,
    importe_centavos INTEGER NOT NULL CHECK (typeof(importe_centavos) = 'integer'),
    descuento_centavos INTEGER NOT NULL CHECK (typeof(descuento_centavos) = 'integer'),
    PRIMARY KEY (sucursal_id, ven_id, renglon),
    FOREIGN KEY (sucursal_id, ven_id) REFERENCES sicar_ventas_mostrador(sucursal_id, ven_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_traspasos (
    sucursal_id INTEGER NOT NULL, tra_id TEXT NOT NULL, folio TEXT NOT NULL, suc_origen TEXT NOT NULL, suc_destino TEXT NOT NULL,
    fecha TEXT NOT NULL, estado TEXT NOT NULL, fecha_aplicado TEXT, fecha_cancelado TEXT,
    total_centavos INTEGER NOT NULL CHECK (typeof(total_centavos) = 'integer'),
    actualizado_en TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, tra_id),
    FOREIGN KEY (sucursal_id) REFERENCES sicar_tiendas(sucursal_id)
  );
  CREATE TABLE IF NOT EXISTS sicar_traspasos_detalle (
    sucursal_id INTEGER NOT NULL, tra_id TEXT NOT NULL, art_id TEXT NOT NULL, cantidad TEXT NOT NULL,
    precio_sin_centavos INTEGER NOT NULL CHECK (typeof(precio_sin_centavos) = 'integer'),
    precio_con_centavos INTEGER NOT NULL CHECK (typeof(precio_con_centavos) = 'integer'),
    PRIMARY KEY (sucursal_id, tra_id, art_id),
    FOREIGN KEY (sucursal_id, tra_id) REFERENCES sicar_traspasos(sucursal_id, tra_id)
  );
  -- Sin llave foranea a sicar_tiendas a proposito: no va en el respaldo SICAR y la restauracion borra sicar_tiendas con las
  -- llaves activas; los omitidos tienen que sobrevivir a una restauracion (la vuelta semanal del agente los vuelve a mandar).
  CREATE TABLE IF NOT EXISTS sicar_traspasos_omitidos (
    sucursal_id INTEGER NOT NULL, tra_id TEXT NOT NULL, codigo TEXT NOT NULL, primera_vez TEXT NOT NULL, ultima_vez TEXT NOT NULL,
    PRIMARY KEY (sucursal_id, tra_id)
  );
  CREATE INDEX IF NOT EXISTS sicar_traspasos_punta ON sicar_traspasos (folio, suc_origen, suc_destino);
  CREATE TABLE IF NOT EXISTS sicar_sucursales_mapa (
    sicar_sucursal TEXT PRIMARY KEY, sucursal_id INTEGER, asignado_por TEXT, asignado_en TEXT
  );
  CREATE TABLE IF NOT EXISTS sicar_sucursales_mapa_historial (
    id INTEGER PRIMARY KEY, sicar_sucursal TEXT, anterior TEXT, nuevo TEXT, actor TEXT, fecha TEXT
  );
  CREATE TABLE IF NOT EXISTS facturas_por_llegar (
    id INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE, rfc_emisor TEXT, nombre_emisor TEXT, fecha_emision TEXT,
    total_centavos INTEGER NOT NULL, conceptos_json TEXT NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('por_llegar', 'llego', 'cancelada')),
    creada_por TEXT NOT NULL, creada_en TEXT NOT NULL, llego_en TEXT, llego_por TEXT, motivo TEXT,
    moneda TEXT NOT NULL DEFAULT 'MXN', tipo_cambio TEXT
  );
  CREATE TABLE IF NOT EXISTS facturas_por_llegar_historial (
    id INTEGER PRIMARY KEY, factura_id INTEGER NOT NULL, accion TEXT NOT NULL, actor TEXT NOT NULL,
    fecha TEXT NOT NULL, detalle TEXT, FOREIGN KEY (factura_id) REFERENCES facturas_por_llegar(id)
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
  CREATE INDEX IF NOT EXISTS sicar_ventas_fecha ON sicar_ventas(sucursal_id, estado, fecha_local);
  CREATE INDEX IF NOT EXISTS sicar_ventas_mostrador_fecha ON sicar_ventas_mostrador(sucursal_id, estado, fecha_local);
  CREATE INDEX IF NOT EXISTS sicar_vinculos_cliente ON sicar_vinculos(cliente_id);
  CREATE INDEX IF NOT EXISTS sicar_decisiones_identidad ON sicar_decisiones(sucursal_id, cli_id, bloquear_union);
  CREATE INDEX IF NOT EXISTS sicar_intentos_hora ON sicar_intentos(hora);
  CREATE INDEX IF NOT EXISTS sicar_intentos_sucursal ON sicar_intentos(sucursal_id, id);
  INSERT OR IGNORE INTO sicar_esquema(version, aplicada) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`;

// Codigos que el agente produce al omitir un traspaso (formato.js, DATOS_RAROS). Cualquier otro se guarda como OTRO.
const CODIGOS_TRASPASO_OMITIDO = new Set(['ID_INVALIDO', 'DECIMAL_INVALIDO', 'PRECISION_NO_PACTADA', 'IMPORTE_EXCESIVO', 'TEXTO_INVALIDO',
  'TEXTO_VACIO', 'FECHA_INVALIDA', 'DETALLE_FUERA_DE_LIMITE', 'ESTADO_TRASPASO_DESCONOCIDO', 'OTRO']);

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

// Texto validado (signo opcional, enteros y cuatro decimales) a enteros de diezmilesimas, con BigInt sobre el texto sin punto (nunca parseFloat). "-0.0000" es 0.
function diezmilesimas(texto) {
  return Number(BigInt(texto.replace('.', '')));
}

// Importe con signo y dos decimales a centavos enteros, con BigInt sobre el texto sin punto (nunca parseFloat). "-0.00" es 0.
function centavosConSigno(texto) {
  return Number(BigInt(texto.replace('.', '')));
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
      (sucursal_id, ven_id, renglon, art_id, clave, descripcion, cantidad, precio_con, precio_sin, importe_centavos, descuento_centavos)
      VALUES (@sucursal_id, @ven_id, @renglon, @art_id, @clave, @descripcion, @cantidad,
        @precio_con, @precio_sin, @importe_centavos, @descuento_centavos)`),
    articulo: sqlite.prepare(`INSERT INTO sicar_articulos
      (sucursal_id, art_id, clave, descripcion, categoria, departamento, actualizado_en)
      VALUES (@sucursal_id, @art_id, @clave, @descripcion, @categoria, @departamento, @actualizado_en)
      ON CONFLICT(sucursal_id, art_id) DO UPDATE SET clave=excluded.clave, descripcion=excluded.descripcion,
        categoria=excluded.categoria, departamento=excluded.departamento, actualizado_en=excluded.actualizado_en`),
    proveedor: sqlite.prepare(`INSERT INTO sicar_proveedores (sucursal_id, prv_id, nombre, actualizado_en)
      VALUES (@sucursal_id, @prv_id, @nombre, @actualizado_en)
      ON CONFLICT(sucursal_id, prv_id) DO UPDATE SET nombre=excluded.nombre, actualizado_en=excluded.actualizado_en`),
    existencia: sqlite.prepare(`INSERT INTO sicar_existencias (sucursal_id, art_id, existencia_diezmilesimas, actualizado_en)
      VALUES (@sucursal_id, @art_id, @existencia_diezmilesimas, @actualizado_en)
      ON CONFLICT(sucursal_id, art_id) DO UPDATE SET existencia_diezmilesimas=excluded.existencia_diezmilesimas,
        actualizado_en=excluded.actualizado_en`),
    borrarExistencia: sqlite.prepare('DELETE FROM sicar_existencias WHERE sucursal_id=? AND art_id=?'),
    corte: sqlite.prepare(`INSERT INTO sicar_cortes (sucursal_id, cor_id, caj_id, fecha_local, usu_id, contado_centavos,
        calculado_centavos, diferencia_centavos, retiro_centavos, actualizado_en)
      VALUES (@sucursal_id, @cor_id, @caj_id, @fecha_local, @usu_id, @contado, @calculado, @diferencia, @retiro, @actualizado_en)
      ON CONFLICT(sucursal_id, cor_id) DO UPDATE SET caj_id=excluded.caj_id, fecha_local=excluded.fecha_local, usu_id=excluded.usu_id,
        contado_centavos=excluded.contado_centavos, calculado_centavos=excluded.calculado_centavos,
        diferencia_centavos=excluded.diferencia_centavos, retiro_centavos=excluded.retiro_centavos, actualizado_en=excluded.actualizado_en`),
    borrarCortePagos: sqlite.prepare('DELETE FROM sicar_cortes_pagos WHERE sucursal_id=? AND cor_id=?'),
    borrarCorteCobros: sqlite.prepare('DELETE FROM sicar_cortes_cobros WHERE sucursal_id=? AND cor_id=?'),
    cortePago: sqlite.prepare(`INSERT INTO sicar_cortes_pagos (sucursal_id, cor_id, tpa_id, contado_centavos, calculado_centavos,
        diferencia_centavos, retiro_centavos)
      VALUES (@sucursal_id, @cor_id, @tpa_id, @contado, @calculado, @diferencia, @retiro)`),
    corteCobro: sqlite.prepare(`INSERT INTO sicar_cortes_cobros (sucursal_id, cor_id, usu_id, ventas, total_centavos, canceladas,
        total_canceladas_centavos)
      VALUES (@sucursal_id, @cor_id, @usu_id, @ventas, @total, @canceladas, @total_canceladas)`),
    mostrador: sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
      VALUES (@sucursal_id, @ven_id, @fecha_local, @estado, @total_centavos, @actualizado_en)
      ON CONFLICT(sucursal_id, ven_id) DO UPDATE SET fecha_local=excluded.fecha_local, estado=excluded.estado,
        total_centavos=excluded.total_centavos, actualizado_en=excluded.actualizado_en`),
    cancelarMostrador: sqlite.prepare(`UPDATE sicar_ventas_mostrador SET estado='cancelada', actualizado_en=?
      WHERE sucursal_id=? AND ven_id=?`),
    borrarDetalleMostrador: sqlite.prepare('DELETE FROM sicar_detalles_mostrador WHERE sucursal_id=? AND ven_id=?'),
    ventaConCliente: sqlite.prepare(`SELECT 1 FROM sicar_ventas WHERE sucursal_id=? AND ven_id=? AND estado IN ('vigente', 'cancelada')`),
    borrarMostrador: sqlite.prepare('DELETE FROM sicar_ventas_mostrador WHERE sucursal_id=? AND ven_id=?'),
    detalleMostrador: sqlite.prepare(`INSERT INTO sicar_detalles_mostrador
      (sucursal_id, ven_id, renglon, art_id, cantidad, importe_centavos, descuento_centavos)
      VALUES (@sucursal_id, @ven_id, @renglon, @art_id, @cantidad, @importe_centavos, @descuento_centavos)`),
    traspaso: sqlite.prepare(`INSERT INTO sicar_traspasos (sucursal_id, tra_id, folio, suc_origen, suc_destino, fecha, estado,
        fecha_aplicado, fecha_cancelado, total_centavos, actualizado_en)
      VALUES (@sucursal_id, @tra_id, @folio, @suc_origen, @suc_destino, @fecha, @estado, @fecha_aplicado, @fecha_cancelado, @total, @actualizado_en)
      ON CONFLICT(sucursal_id, tra_id) DO UPDATE SET folio=excluded.folio, suc_origen=excluded.suc_origen,
        suc_destino=excluded.suc_destino, fecha=excluded.fecha, estado=excluded.estado, fecha_aplicado=excluded.fecha_aplicado,
        fecha_cancelado=excluded.fecha_cancelado, total_centavos=excluded.total_centavos, actualizado_en=excluded.actualizado_en`),
    borrarTraspasoDetalle: sqlite.prepare('DELETE FROM sicar_traspasos_detalle WHERE sucursal_id=? AND tra_id=?'),
    traspasoDetalle: sqlite.prepare(`INSERT INTO sicar_traspasos_detalle (sucursal_id, tra_id, art_id, cantidad, precio_sin_centavos,
        precio_con_centavos) VALUES (@sucursal_id, @tra_id, @art_id, @cantidad, @precio_sin, @precio_con)`),
    traspasoOmitido: sqlite.prepare(`INSERT INTO sicar_traspasos_omitidos (sucursal_id, tra_id, codigo, primera_vez, ultima_vez)
      VALUES (@sucursal_id, @tra_id, @codigo, @fecha, @fecha)
      ON CONFLICT(sucursal_id, tra_id) DO UPDATE SET codigo=excluded.codigo, ultima_vez=excluded.ultima_vez`),
    borrarTraspasoOmitido: sqlite.prepare('DELETE FROM sicar_traspasos_omitidos WHERE sucursal_id=? AND tra_id=?'),
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
  for (const [renglon, detalle] of venta.detalle.entries()) {
    sentencias.detalle.run({
      sucursal_id: sucursalId, ven_id: venta.ven_id, renglon, art_id: detalle.art_id, clave: detalle.clave ?? null,
      descripcion: detalle.descripcion, cantidad: detalle.cantidad, precio_con: detalle.precio_con, precio_sin: detalle.precio_sin,
      importe_centavos: centavos(detalle.importe_con), descuento_centavos: centavos(detalle.descuento_total),
    });
  }
}

// Venta de mostrador: solo ids de artículo, cantidad e importes; nunca cliente, nombre, clave ni descripción.
// La cancelación corta cambia el estado de una fila ya recibida sin tocar su total; si no existía, no hay nada que cancelar.
function escribirMostrador(sentencias, sucursalId, m, actualizado_en, seExcluyen = new Set()) {
  if (m.fecha_local === undefined) {
    sentencias.cancelarMostrador.run(actualizado_en, sucursalId, m.ven_id);
    return;
  }
  // Ya llego como venta con cliente: no se cuenta dos veces.
  if (!seExcluyen.has(m.ven_id) && sentencias.ventaConCliente.get(sucursalId, m.ven_id)) return;
  sentencias.mostrador.run({ sucursal_id: sucursalId, ven_id: m.ven_id, fecha_local: m.fecha_local, estado: m.estado,
    total_centavos: centavos(m.total), actualizado_en });
  sentencias.borrarDetalleMostrador.run(sucursalId, m.ven_id);
  for (const [renglon, d] of m.detalle.entries()) {
    sentencias.detalleMostrador.run({ sucursal_id: sucursalId, ven_id: m.ven_id, renglon, art_id: d.art_id, cantidad: d.cantidad,
      importe_centavos: centavos(d.importe_con), descuento_centavos: centavos(d.descuento_total) });
  }
}

function limpiarTexto(valor) {
  if (valor === null || valor === undefined) return null;
  const limpio = valor.trim();
  return limpio || null;
}

const MAX_INTENTOS_POR_TIENDA = 5000;
const DIAS_RETENCION_INTENTOS = 30;

function crearRepositorioSicar(sqlite, { clientesNativos } = {}) {
  sqlite.pragma('foreign_keys = ON');
  if (sqlite.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new ErrorSicar('FK_DESACTIVADAS', 'No se pudieron activar las claves foráneas.');
  }
  sqlite.transaction(() => {
    sqlite.exec(ESQUEMA);
    if (!sqlite.pragma('table_info(sicar_detalles)').some(c => c.name === 'renglon')) {
      sqlite.exec('ALTER TABLE sicar_detalles RENAME TO sicar_detalles_anteriores');
      sqlite.exec(ESQUEMA);
      sqlite.exec(`INSERT INTO sicar_detalles
        (sucursal_id, ven_id, art_id, clave, descripcion, cantidad, precio_con, precio_sin,
          importe_centavos, descuento_centavos, renglon)
        SELECT sucursal_id, ven_id, art_id, clave, descripcion, cantidad, precio_con, precio_sin,
          importe_centavos, descuento_centavos,
          ROW_NUMBER() OVER (PARTITION BY sucursal_id, ven_id ORDER BY rowid) - 1
        FROM sicar_detalles_anteriores;
        DROP TABLE sicar_detalles_anteriores;`);
    }
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
    const identidades = [];
    const descartados = { clientes: 0, ventas: 0, renglones: 0 };
    const publicos = new Set(sqlite.prepare('SELECT sucursal_id, cli_id, nombre FROM sicar_clientes WHERE sucursal_id=?')
      .all(sucursalId).filter(esPublicoSicar).map(c => c.cli_id));
    for (const cliente of lote.clientes) {
      if (esPublicoSicar({ ...cliente, sucursal_id: sucursalId })) {
        publicos.add(cliente.cli_id);
        descartados.clientes++;
        continue;
      }
      const anterior = sqlite.prepare('SELECT telefono, celular FROM sicar_clientes WHERE sucursal_id=? AND cli_id=?')
        .get(sucursalId, cliente.cli_id);
      identidades.push({ sucursal_id: sucursalId, cli_id: cliente.cli_id,
        telefonosCambiaron: !!anterior && (anterior.telefono !== (cliente.telefono ?? null) || anterior.celular !== (cliente.celular ?? null)) });
      sentencias.cliente.run({
        sucursal_id: sucursalId, cli_id: cliente.cli_id, nombre: cliente.nombre,
        telefono: cliente.telefono ?? null, celular: cliente.celular ?? null, email: cliente.email ?? null,
        rfc: cliente.rfc ?? null, status: cliente.status ?? null, clave: cliente.clave ?? null,
      });
    }
    if (clientesNativos) {
      const { resolverVinculosSicar } = require('./sicarVinculos');
      resolverVinculosSicar(repositorio, clientesNativos(), identidades);
    }
    const actualizadoMostrador = new Date().toISOString();
    // Mostrador va antes que las ventas: si el mismo lote trae la venta con cliente, esa gana y la fila de mostrador se borra.
    // Las ventas que este mismo lote deja excluidas (ya no son de un cliente real) no bloquean a su fila de mostrador.
    const seExcluyen = new Set(lote.ventas.filter(v => v.estado === 'excluida' || (v.cli_id != null
      && (publicos.has(v.cli_id) || esPublicoSicar({ sucursal_id: sucursalId, cli_id: v.cli_id })))).map(v => v.ven_id));
    for (const m of lote.mostrador || []) escribirMostrador(sentencias, sucursalId, m, actualizadoMostrador, seExcluyen);
    for (const venta of lote.ventas) {
      if (venta.cli_id != null && (publicos.has(venta.cli_id) || esPublicoSicar({ sucursal_id: sucursalId, cli_id: venta.cli_id }))) {
        descartados.ventas++;
        descartados.renglones += venta.detalle?.length || 0;
        // Si ya se había recibido a nombre de alguien, se quita de su ficha; si es nueva, no se guarda nada.
        escribirVenta(sentencias, sucursalId, { ven_id: venta.ven_id, estado: 'excluida' }, lote.sequence, hash);
        continue;
      }
      if (venta.cli_id !== undefined && ['vigente', 'cancelada'].includes(venta.estado)) {
        // Una venta nunca cuenta dos veces: guardada con cliente real deja de ser de mostrador (la descartada como publico no).
        sentencias.borrarDetalleMostrador.run(sucursalId, venta.ven_id);
        sentencias.borrarMostrador.run(sucursalId, venta.ven_id);
      }
      escribirVenta(sentencias, sucursalId, venta, lote.sequence, hash);
    }
    const actualizado_en = new Date().toISOString();
    for (const articulo of lote.articulos || []) {
      sentencias.articulo.run({ sucursal_id: sucursalId, art_id: articulo.art_id,
        clave: limpiarTexto(articulo.clave), descripcion: limpiarTexto(articulo.descripcion),
        categoria: limpiarTexto(articulo.categoria), departamento: limpiarTexto(articulo.departamento), actualizado_en });
    }
    for (const proveedor of lote.proveedores || []) {
      sentencias.proveedor.run({ sucursal_id: sucursalId, prv_id: proveedor.prv_id, nombre: limpiarTexto(proveedor.nombre), actualizado_en });
    }
    for (const e of lote.existencias || []) {
      if (e.existencia === null) sentencias.borrarExistencia.run(sucursalId, e.art_id);
      else {
        sentencias.existencia.run({ sucursal_id: sucursalId, art_id: e.art_id,
          existencia_diezmilesimas: diezmilesimas(e.existencia), actualizado_en });
      }
    }
    for (const c of lote.cortes || []) {
      const ids = { sucursal_id: sucursalId, cor_id: c.cor_id };
      sentencias.corte.run({ ...ids, caj_id: c.caj_id, fecha_local: c.fecha_local, usu_id: c.usu_id, actualizado_en,
        contado: centavosConSigno(c.contado), calculado: centavosConSigno(c.calculado),
        diferencia: centavosConSigno(c.diferencia), retiro: centavosConSigno(c.retiro) });
      sentencias.borrarCortePagos.run(sucursalId, c.cor_id);
      sentencias.borrarCorteCobros.run(sucursalId, c.cor_id);
      for (const p of c.pagos) {
        sentencias.cortePago.run({ ...ids, tpa_id: p.tpa_id, contado: centavosConSigno(p.contado),
          calculado: centavosConSigno(p.calculado), diferencia: centavosConSigno(p.diferencia), retiro: centavosConSigno(p.retiro) });
      }
      for (const b of c.cobros) {
        sentencias.corteCobro.run({ ...ids, usu_id: b.usu_id ?? '', ventas: b.ventas, total: centavosConSigno(b.total),
          canceladas: b.canceladas, total_canceladas: centavosConSigno(b.total_canceladas) });
      }
    }
    // Los omitidos van antes que los traspasos: si el mismo lote trae el traspaso valido, ese gana y la alerta se borra.
    for (const o of lote.traspasos_omitidos || []) {
      const codigo = CODIGOS_TRASPASO_OMITIDO.has(o.codigo) ? o.codigo : 'OTRO';
      sentencias.traspasoOmitido.run({ sucursal_id: sucursalId, tra_id: o.tra_id, codigo, fecha: actualizado_en });
    }
    for (const t of lote.traspasos || []) {
      sentencias.borrarTraspasoOmitido.run(sucursalId, t.tra_id);
      sentencias.traspaso.run({ sucursal_id: sucursalId, tra_id: t.tra_id, folio: t.folio.trim(), suc_origen: t.suc_origen,
        suc_destino: t.suc_destino, fecha: t.fecha, estado: t.estado, fecha_aplicado: t.fecha_aplicado, fecha_cancelado: t.fecha_cancelado,
        total: centavos(t.total), actualizado_en });
      sentencias.borrarTraspasoDetalle.run(sucursalId, t.tra_id);
      for (const d of t.detalle) {
        sentencias.traspasoDetalle.run({ sucursal_id: sucursalId, tra_id: t.tra_id, art_id: d.art_id, cantidad: d.cantidad,
          precio_sin: centavos(d.precio_sin), precio_con: centavos(d.precio_con) });
      }
    }
    const recibo = {
      schema_version: 1, batch_id: lote.batch_id, sequence: lote.sequence,
      aceptados: { clientes: lote.clientes.length - descartados.clientes, ventas: lote.ventas.length - descartados.ventas,
        ...(lote.articulos !== undefined ? { articulos: lote.articulos.length } : {}),
        ...(lote.proveedores !== undefined ? { proveedores: lote.proveedores.length } : {}),
        ...(lote.existencias !== undefined ? { existencias: lote.existencias.length } : {}),
        ...(lote.cortes !== undefined ? { cortes: lote.cortes.length } : {}),
        ...(lote.mostrador !== undefined ? { mostrador: lote.mostrador.length } : {}),
        ...(lote.traspasos !== undefined ? { traspasos: lote.traspasos.length } : {}),
        ...(lote.traspasos_omitidos !== undefined ? { traspasos_omitidos: lote.traspasos_omitidos.length } : {}) }, rechazados: 0,
      ...(descartados.clientes || descartados.ventas ? { descartados } : {}),
      next_sequence: (BigInt(lote.sequence) + 1n).toString(), received_at: new Date().toISOString(),
    };
    sentencias.envio.run(sucursalId, lote.batch_id, lote.sequence, hash, JSON.stringify(recibo),
      recibo.aceptados.clientes, recibo.aceptados.ventas, recibo.received_at);
    sentencias.avanzar.run(recibo.next_sequence, recibo.received_at, lote.mapping_version, sucursalId);
    return recibo;
  });

  // Retención por tienda (auditoría sicar-crm 2026-10, A1): al pasar de
  // MAX_INTENTOS_POR_TIENDA filas se borran las más viejas. `IS` y no `=` para
  // que las filas sin sucursal también tengan tope.
  const insertarIntento = sqlite.prepare(`INSERT INTO sicar_intentos
    (sucursal_id, key_id, batch_id, recibidos, aceptados, rechazados, bytes, codigo, hora, duracion_ms)
    VALUES (@sucursal_id, @key_id, @batch_id, @recibidos, @aceptados, @rechazados, @bytes, @codigo, @hora, @duracion_ms)`);
  const contarIntentos = sqlite.prepare('SELECT count(*) AS n FROM sicar_intentos WHERE sucursal_id IS ?');
  const recortarIntentos = sqlite.prepare(`DELETE FROM sicar_intentos WHERE sucursal_id IS @s AND id NOT IN
    (SELECT id FROM sicar_intentos WHERE sucursal_id IS @s ORDER BY id DESC LIMIT @tope)`);
  const registrarIntento = sqlite.transaction(intento => {
    insertarIntento.run(intento);
    const s = intento.sucursal_id ?? null;
    if (contarIntentos.get(s).n > MAX_INTENTOS_POR_TIENDA) recortarIntentos.run({ s, tope: MAX_INTENTOS_POR_TIENDA });
  });

  const guardarLlave = sqlite.transaction(llave => {
    sentencias.tienda.run(llave.sucursal_id);
    sqlite.prepare(`INSERT INTO sicar_llaves(key_id, sucursal_id, secreto_hash, creada, actor)
      VALUES (@key_id, @sucursal_id, @secreto_hash, @creada, @actor)`).run(llave);
  });
  const guardarEstadoCliente = sqlite.transaction(datos => {
    const anterior = sqlite.prepare('SELECT estado FROM sicar_estados WHERE sucursal_id=? AND cli_id=?')
      .get(datos.sucursal_id, datos.cli_id)?.estado ?? null;
    sqlite.prepare(`INSERT INTO sicar_estados(sucursal_id, cli_id, estado, usuario_id, fecha_hora)
      VALUES (@sucursal_id, @cli_id, @estado, @usuario_id, @fecha_hora)
      ON CONFLICT(sucursal_id, cli_id) DO UPDATE SET estado=excluded.estado,
        usuario_id=excluded.usuario_id, fecha_hora=excluded.fecha_hora`).run(datos);
    sqlite.prepare(`INSERT INTO sicar_estados_historial(sucursal_id, cli_id, anterior, nuevo, usuario_id, fecha_hora)
      VALUES (@sucursal_id, @cli_id, @anterior, @estado, @usuario_id, @fecha_hora)`).run({ ...datos, anterior });
  });
  const guardarCuentaInterna = sqlite.transaction(datos => {
    const anterior = !!sqlite.prepare('SELECT 1 FROM sicar_internas WHERE sucursal_id=? AND cli_id=?')
      .get(datos.sucursal_id, datos.cli_id);
    if (anterior === datos.interna) {
      throw Object.assign(new Error('La cuenta ya tiene esa marca.'), { status: 409 });
    }
    if (datos.interna) {
      sqlite.prepare(`INSERT INTO sicar_internas(sucursal_id, cli_id, motivo, usuario_id, fecha_hora)
        VALUES (@sucursal_id, @cli_id, @motivo, @usuario_id, @fecha_hora)`).run(datos);
    } else {
      sqlite.prepare('DELETE FROM sicar_internas WHERE sucursal_id=? AND cli_id=?').run(datos.sucursal_id, datos.cli_id);
    }
    sqlite.prepare(`INSERT INTO sicar_internas_historial(sucursal_id, cli_id, accion, motivo, usuario_id, fecha_hora)
      VALUES (@sucursal_id, @cli_id, @accion, @motivo, @usuario_id, @fecha_hora)`)
      .run({ ...datos, accion: datos.interna ? 'marcar' : 'desmarcar' });
  });
  const repositorio = {
    guardarCuentaInterna: datos => guardarCuentaInterna.immediate(datos),
    guardarEstadoCliente: datos => guardarEstadoCliente.immediate(datos),
    conexionParaVinculos: () => sqlite,
    clientesNativos: () => clientesNativos?.() ?? [],
    conexionParaRespaldo: () => sqlite,
    estado, reciboAnterior, aplicarLote: datos => aplicar.immediate(datos),
    guardarLlave: llave => guardarLlave.immediate(llave),
    obtenerLlave: id => sqlite.prepare('SELECT * FROM sicar_llaves WHERE key_id=?').get(id),
    // "Agente activo" = la tienda tiene al menos una llave SICAR sin revocar (Q6 del plan).
    tieneAgenteActivo: sucursalId => !!sqlite.prepare('SELECT 1 FROM sicar_llaves WHERE sucursal_id=? AND revocada IS NULL LIMIT 1')
      .get(Number(sucursalId)),
    listarLlaves: () => sqlite.prepare('SELECT key_id, sucursal_id, creada, revocada, actor FROM sicar_llaves ORDER BY creada DESC').all(),
    revocarLlave: id => sqlite.prepare('UPDATE sicar_llaves SET revocada=COALESCE(revocada, ?) WHERE key_id=?').run(new Date().toISOString(), id),
    listarEnvios: sucursalId => sqlite.prepare(`SELECT sucursal_id, batch_id, secuencia, clientes, ventas, rechazados, fecha, resultado
      FROM sicar_envios WHERE (? IS NULL OR sucursal_id=?) ORDER BY fecha DESC, rowid DESC LIMIT 100`).all(sucursalId, sucursalId),
    listarIntentos: sucursalId => sqlite.prepare(`SELECT * FROM sicar_intentos
      WHERE (? IS NULL OR sucursal_id=?) ORDER BY id DESC LIMIT 100`).all(sucursalId, sucursalId),
    // Lista cruda de todas las tiendas para el Radar de Demanda; la pantalla la junta por nombre.
    listarProveedores: () => sqlite.prepare('SELECT sucursal_id, prv_id, nombre FROM sicar_proveedores ORDER BY sucursal_id, prv_id').all(),
    consultarExistencias: (params, ahora, nombres) => require('./sicarExistencias')
      .consultarExistenciasSicar(sqlite, params, ahora, nombres),
    listarExistencias: () => sqlite.prepare(`SELECT sucursal_id, art_id, existencia_diezmilesimas, actualizado_en
      FROM sicar_existencias ORDER BY sucursal_id, art_id`).all(),
    // Lista simple de traspasos para pruebas; las pantallas la leen con sus propias consultas.
    listarTraspasos: () => sqlite.prepare(`SELECT sucursal_id, tra_id, folio, suc_origen, suc_destino, fecha, estado, fecha_aplicado,
      fecha_cancelado, total_centavos, actualizado_en FROM sicar_traspasos ORDER BY sucursal_id, tra_id`).all(),
    // Lista simple de cortes para pruebas; las pantallas la leen con sus propias consultas.
    listarCortes: () => sqlite.prepare(`SELECT sucursal_id, cor_id, caj_id, fecha_local, usu_id, contado_centavos, calculado_centavos,
      diferencia_centavos, retiro_centavos, actualizado_en FROM sicar_cortes ORDER BY sucursal_id, cor_id`).all(),
    consultarCortes: (filtros, alcance) => require('./sicarCortes').consultarCortesSicar(sqlite, filtros, alcance),
    listarPersonal: (alcance, nombreUsuario) => require('./sicarCortes').listarPersonalSicar(sqlite, alcance, nombreUsuario),
    asignarNombre: (datos, actor, alcance) => require('./sicarCortes').asignarNombreSicar(sqlite, datos, actor, alcance),
    // Lista simple de ventas de mostrador para pruebas; las pantallas la leen con sus propias consultas.
    listarMostrador: () => sqlite.prepare(`SELECT sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en
      FROM sicar_ventas_mostrador ORDER BY sucursal_id, ven_id`).all(),
    registrarIntento: intento => registrarIntento.immediate(intento),
  };
  // Al arrancar: los intentos de más de 30 días ya no diagnostican nada y ocupan disco.
  sqlite.prepare('DELETE FROM sicar_intentos WHERE hora < ?')
    .run(new Date(Date.now() - DIAS_RETENCION_INTENTOS * 24 * 60 * 60 * 1000).toISOString());
  return repositorio;
}

module.exports = { crearRepositorioSicar, ErrorSicar };
