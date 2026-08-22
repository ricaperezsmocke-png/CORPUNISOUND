/**
 * Persistencia relacional del Centro Omnicanal de Leads.
 *
 * Comparte la misma conexión y el mismo archivo datos.sqlite que el resto de
 * CORPUNISOUND, pero no modifica la tabla `estado` ni migra el documento JSON
 * actual. Los IDs de cliente, vendedor, usuario, sucursal, producto, venta y
 * cotización son referencias lógicas porque esas entidades todavía viven en
 * dicho JSON. Solo las relaciones entre tablas propias de Centro de Leads usan
 * claves foráneas SQLite.
 */

const VERSION_ESQUEMA = 1;

function aplicarVersion1(sqlite) {
  sqlite.exec(`
    CREATE TABLE lead_fuentes (
      id INTEGER PRIMARY KEY,
      canal TEXT NOT NULL,
      proveedor TEXT NOT NULL,
      identificador_externo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      sucursal_responsable_id INTEGER,
      activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
      creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (proveedor, identificador_externo)
    );

    CREATE TABLE lead_contenidos (
      id INTEGER PRIMARY KEY,
      fuente_id INTEGER NOT NULL,
      canal TEXT NOT NULL,
      tipo TEXT NOT NULL,
      identificador_externo TEXT NOT NULL,
      titulo TEXT,
      url TEXT,
      campana_externa_id TEXT,
      vendedor_origen_id INTEGER,
      sucursal_origen_id INTEGER,
      publicado_en TEXT,
      creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fuente_id) REFERENCES lead_fuentes(id) ON DELETE RESTRICT,
      UNIQUE (fuente_id, identificador_externo)
    );

    CREATE TABLE lead_eventos_externos (
      id INTEGER PRIMARY KEY,
      fuente_id INTEGER,
      proveedor TEXT NOT NULL,
      identificador_evento_externo TEXT NOT NULL,
      tipo TEXT NOT NULL,
      recibido_en TEXT NOT NULL,
      ocurrido_en TEXT,
      payload_json TEXT,
      procesado_en TEXT,
      error_procesamiento TEXT,
      FOREIGN KEY (fuente_id) REFERENCES lead_fuentes(id) ON DELETE RESTRICT,
      UNIQUE (proveedor, identificador_evento_externo)
    );

    CREATE TABLE lead_conversaciones (
      id INTEGER PRIMARY KEY,
      fuente_id INTEGER NOT NULL,
      canal TEXT NOT NULL,
      identificador_conversacion_externa TEXT NOT NULL,
      iniciada_en TEXT NOT NULL,
      ultima_interaccion_en TEXT NOT NULL,
      cerrada_en TEXT,
      FOREIGN KEY (fuente_id) REFERENCES lead_fuentes(id) ON DELETE RESTRICT,
      UNIQUE (fuente_id, canal, identificador_conversacion_externa)
    );

    CREATE TABLE lead_identidades_externas (
      id INTEGER PRIMARY KEY,
      fuente_id INTEGER,
      proveedor TEXT NOT NULL,
      identificador_externo TEXT NOT NULL,
      nombre_mostrado TEXT,
      telefono_normalizado TEXT,
      email_normalizado TEXT,
      cliente_id INTEGER,
      creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fuente_id) REFERENCES lead_fuentes(id) ON DELETE RESTRICT,
      UNIQUE (proveedor, identificador_externo)
    );

    CREATE TABLE leads (
      id INTEGER PRIMARY KEY,
      conversacion_principal_id INTEGER,
      identidad_principal_id INTEGER,
      cliente_id INTEGER,
      producto_id INTEGER,
      estado TEXT NOT NULL,
      prioridad TEXT,
      vendedor_origen_id INTEGER,
      vendedor_asignado_id INTEGER,
      sucursal_origen_id INTEGER,
      sucursal_asignada_id INTEGER,
      creado_por_usuario_id INTEGER,
      creado_en TEXT NOT NULL,
      actualizado_en TEXT NOT NULL,
      ultima_interaccion_en TEXT,
      cerrado_en TEXT,
      FOREIGN KEY (conversacion_principal_id) REFERENCES lead_conversaciones(id) ON DELETE RESTRICT,
      FOREIGN KEY (identidad_principal_id) REFERENCES lead_identidades_externas(id) ON DELETE RESTRICT
    );

    CREATE TABLE lead_interacciones (
      id INTEGER PRIMARY KEY,
      conversacion_id INTEGER NOT NULL,
      lead_id INTEGER,
      evento_externo_id INTEGER,
      identidad_externa_id INTEGER,
      tipo TEXT NOT NULL,
      direccion TEXT NOT NULL CHECK (direccion IN ('entrante', 'saliente', 'sistema')),
      texto TEXT,
      ocurrida_en TEXT NOT NULL,
      creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversacion_id) REFERENCES lead_conversaciones(id) ON DELETE RESTRICT,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT,
      FOREIGN KEY (evento_externo_id) REFERENCES lead_eventos_externos(id) ON DELETE RESTRICT,
      FOREIGN KEY (identidad_externa_id) REFERENCES lead_identidades_externas(id) ON DELETE RESTRICT
    );

    CREATE TABLE lead_atribuciones (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      fuente_id INTEGER,
      contenido_id INTEGER,
      metodo TEXT NOT NULL,
      evidencia_json TEXT,
      vendedor_origen_id INTEGER,
      sucursal_origen_id INTEGER,
      detectada_por_usuario_id INTEGER,
      detectada_en TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT,
      FOREIGN KEY (fuente_id) REFERENCES lead_fuentes(id) ON DELETE RESTRICT,
      FOREIGN KEY (contenido_id) REFERENCES lead_contenidos(id) ON DELETE RESTRICT
    );

    CREATE TABLE lead_asignaciones (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      vendedor_asignado_id INTEGER,
      sucursal_asignada_id INTEGER,
      regla TEXT NOT NULL,
      motivo TEXT,
      asignada_por_usuario_id INTEGER,
      asignada_en TEXT NOT NULL,
      finalizada_en TEXT,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT
    );

    CREATE TABLE lead_historial (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      actor_tipo TEXT NOT NULL,
      actor_usuario_id INTEGER,
      origen TEXT,
      datos_json TEXT,
      correlacion_id TEXT,
      ocurrido_en TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT
    );

    CREATE TABLE lead_posibles_duplicados (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      posible_duplicado_lead_id INTEGER NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      evidencia_json TEXT NOT NULL,
      detectado_en TEXT NOT NULL,
      revisado_por_usuario_id INTEGER,
      revisado_en TEXT,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT,
      FOREIGN KEY (posible_duplicado_lead_id) REFERENCES leads(id) ON DELETE RESTRICT,
      CHECK (lead_id <> posible_duplicado_lead_id),
      UNIQUE (lead_id, posible_duplicado_lead_id)
    );

    CREATE TABLE lead_fusiones (
      id INTEGER PRIMARY KEY,
      lead_canonico_id INTEGER NOT NULL,
      lead_absorbido_id INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      fusionado_por_usuario_id INTEGER NOT NULL,
      fusionado_en TEXT NOT NULL,
      revertido_por_usuario_id INTEGER,
      revertido_en TEXT,
      FOREIGN KEY (lead_canonico_id) REFERENCES leads(id) ON DELETE RESTRICT,
      FOREIGN KEY (lead_absorbido_id) REFERENCES leads(id) ON DELETE RESTRICT,
      CHECK (lead_canonico_id <> lead_absorbido_id)
    );

    CREATE TABLE lead_seguimientos (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      responsable_usuario_id INTEGER,
      responsable_vendedor_id INTEGER,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      programado_para TEXT NOT NULL,
      completado_en TEXT,
      nota TEXT,
      creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT
    );

    CREATE TABLE lead_zonas (
      id INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
      creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE lead_reglas_zona (
      id INTEGER PRIMARY KEY,
      zona_id INTEGER NOT NULL,
      codigo_postal TEXT,
      localidad TEXT,
      ciudad TEXT,
      municipio TEXT,
      estado_geografico TEXT,
      sucursal_responsable_id INTEGER NOT NULL,
      prioridad INTEGER NOT NULL DEFAULT 0,
      vigente_desde TEXT,
      vigente_hasta TEXT,
      activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
      FOREIGN KEY (zona_id) REFERENCES lead_zonas(id) ON DELETE RESTRICT
    );

    CREATE TABLE lead_reglas_asignacion (
      id INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      prioridad INTEGER NOT NULL,
      fuente_id INTEGER,
      zona_id INTEGER,
      sucursal_asignada_id INTEGER,
      vendedor_asignado_id INTEGER,
      activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
      configuracion_json TEXT,
      FOREIGN KEY (fuente_id) REFERENCES lead_fuentes(id) ON DELETE RESTRICT,
      FOREIGN KEY (zona_id) REFERENCES lead_zonas(id) ON DELETE RESTRICT
    );

    CREATE TABLE lead_sla_configuracion (
      id INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      canal TEXT,
      fuente_id INTEGER,
      sucursal_id INTEGER,
      minutos_primera_respuesta INTEGER NOT NULL CHECK (minutos_primera_respuesta > 0),
      minutos_escalamiento INTEGER CHECK (minutos_escalamiento IS NULL OR minutos_escalamiento > 0),
      activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
      FOREIGN KEY (fuente_id) REFERENCES lead_fuentes(id) ON DELETE RESTRICT
    );

    CREATE TABLE lead_relaciones_cotizaciones (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      cotizacion_id INTEGER NOT NULL,
      vinculada_por_usuario_id INTEGER,
      vinculada_en TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT,
      UNIQUE (lead_id, cotizacion_id)
    );

    CREATE TABLE lead_relaciones_ventas (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      venta_id INTEGER NOT NULL,
      vinculada_por_usuario_id INTEGER,
      vinculada_en TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT,
      UNIQUE (lead_id, venta_id)
    );

    CREATE INDEX idx_lead_fuentes_canal
      ON lead_fuentes (canal, activa);
    CREATE INDEX idx_lead_contenidos_fuente_canal
      ON lead_contenidos (fuente_id, canal);
    CREATE INDEX idx_lead_eventos_fecha
      ON lead_eventos_externos (recibido_en);
    CREATE INDEX idx_lead_conversaciones_externa
      ON lead_conversaciones (canal, fuente_id, identificador_conversacion_externa);
    CREATE INDEX idx_leads_estado_fecha
      ON leads (estado, ultima_interaccion_en, creado_en);
    CREATE INDEX idx_leads_sucursal_estado_fecha
      ON leads (sucursal_asignada_id, estado, ultima_interaccion_en);
    CREATE INDEX idx_leads_vendedor_estado_fecha
      ON leads (vendedor_asignado_id, estado, ultima_interaccion_en);
    CREATE INDEX idx_lead_interacciones_conversacion_fecha
      ON lead_interacciones (conversacion_id, ocurrida_en);
    CREATE INDEX idx_lead_atribuciones_lead
      ON lead_atribuciones (lead_id, detectada_en);
    CREATE INDEX idx_lead_asignaciones_actual
      ON lead_asignaciones (lead_id, finalizada_en, asignada_en);
    CREATE INDEX idx_lead_historial_lead_fecha
      ON lead_historial (lead_id, ocurrido_en);
    CREATE INDEX idx_lead_posibles_duplicados_estado
      ON lead_posibles_duplicados (estado, detectado_en);
    CREATE INDEX idx_lead_seguimientos_fecha_estado
      ON lead_seguimientos (programado_para, estado);
  `);
}

const MIGRACIONES = Object.freeze([
  Object.freeze({ version: 1, aplicar: aplicarVersion1 }),
]);

function inicializarPersistenciaCentroLeads(sqlite, { migraciones = MIGRACIONES } = {}) {
  if (!sqlite || typeof sqlite.exec !== "function" || typeof sqlite.transaction !== "function") {
    throw new TypeError("Se requiere una conexión better-sqlite3 abierta");
  }

  sqlite.pragma("foreign_keys = ON");

  const migrar = sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS centro_leads_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL CHECK (version >= 0),
        actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const fila = sqlite.prepare(
      "SELECT version FROM centro_leads_schema_version WHERE id = 1"
    ).get();
    let versionActual = fila ? Number(fila.version) : 0;
    const ordenadas = [...migraciones].sort((a, b) => a.version - b.version);

    for (const migracion of ordenadas) {
      if (migracion.version <= versionActual) continue;
      if (migracion.version !== versionActual + 1) {
        throw new Error(
          `Migración de Centro de Leads fuera de secuencia: versión actual ${versionActual}, siguiente ${migracion.version}`
        );
      }
      migracion.aplicar(sqlite);
      sqlite.prepare(`
        INSERT INTO centro_leads_schema_version (id, version, actualizado_en)
        VALUES (1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          version = excluded.version,
          actualizado_en = CURRENT_TIMESTAMP
      `).run(migracion.version);
      versionActual = migracion.version;
    }

    return versionActual;
  });

  return { version: migrar() };
}

module.exports = {
  VERSION_ESQUEMA,
  MIGRACIONES,
  inicializarPersistenciaCentroLeads,
};
