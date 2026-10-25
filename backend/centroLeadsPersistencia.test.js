const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");

const {
  VERSION_ESQUEMA,
  MIGRACIONES,
  inicializarPersistenciaCentroLeads,
} = require("./centroLeads/persistencia");

function baseTemporal(nombre = "centro-leads.sqlite") {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "centro-leads-"));
  return { carpeta, ruta: path.join(carpeta, nombre) };
}

function conBase(fn) {
  const temporal = baseTemporal();
  const sqlite = new Database(temporal.ruta);
  try {
    return fn(sqlite, temporal);
  } finally {
    sqlite.close();
    fs.rmSync(temporal.carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function tablas(sqlite) {
  return sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((fila) => fila.name);
}

function indices(sqlite) {
  return sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((fila) => fila.name);
}

const TABLAS_ESPERADAS = [
  "centro_leads_schema_version",
  "lead_asignaciones",
  "lead_atribuciones",
  "lead_contenidos",
  "lead_conversaciones",
  "lead_enlaces_rastreados",
  "lead_eventos_externos",
  "lead_fuentes",
  "lead_fusiones",
  "lead_historial",
  "lead_identidades_externas",
  "lead_interacciones",
  "lead_posibles_duplicados",
  "lead_reglas_asignacion",
  "lead_reglas_zona",
  "lead_relaciones_cotizaciones",
  "lead_relaciones_ventas",
  "lead_seguimientos",
  "lead_sla_configuracion",
  "lead_zonas",
  "leads",
].sort();

const INDICES_ESPERADOS = [
  "idx_lead_asignaciones_actual",
  "idx_lead_atribuciones_contenido_metodo",
  "idx_lead_atribuciones_lead",
  "idx_lead_atribuciones_rol_estado",
  "idx_lead_contenidos_fuente_canal",
  "idx_lead_contenidos_producto_activa",
  "idx_lead_contenidos_vendedor_fecha",
  "idx_lead_conversaciones_externa",
  "idx_lead_conversaciones_identidad",
  "idx_lead_conversaciones_ultima",
  "idx_lead_enlaces_contenido_activa",
  "idx_lead_eventos_fecha",
  "idx_lead_fuentes_canal",
  "idx_lead_fuentes_plataforma_activa",
  "idx_lead_historial_lead_fecha",
  "idx_lead_identidades_cliente",
  "idx_lead_interacciones_conversacion_fecha",
  "idx_lead_interacciones_identidad",
  "idx_lead_posibles_duplicados_estado",
  "idx_lead_seguimientos_fecha_estado",
  "idx_leads_estado_fecha",
  "idx_leads_sucursal_estado_fecha",
  "idx_leads_vendedor_estado_fecha",
  "ux_lead_asignacion_activa",
  "ux_lead_atribucion_origen_activa",
  "ux_lead_atribuciones_clave_idempotencia",
  "ux_lead_interaccion_evento_externo",
  "ux_leads_cliente",
].sort();

test("una base nueva obtiene la versión y las tablas estructurales de Centro de Leads", () => {
  conBase((sqlite) => {
    const resultado = inicializarPersistenciaCentroLeads(sqlite);

    assert.strictEqual(resultado.version, VERSION_ESQUEMA);
    assert.deepStrictEqual(tablas(sqlite), TABLAS_ESPERADAS);
    assert.strictEqual(
      sqlite.prepare("SELECT version FROM centro_leads_schema_version WHERE id = 1").pluck().get(),
      VERSION_ESQUEMA
    );
  });
});

test("la migración crea solamente los índices justificados y la clave idempotente externa", () => {
  conBase((sqlite) => {
    inicializarPersistenciaCentroLeads(sqlite);

    assert.deepStrictEqual(indices(sqlite), INDICES_ESPERADOS);
    sqlite.prepare(`
      INSERT INTO lead_fuentes (canal, proveedor, identificador_externo, nombre)
      VALUES ('facebook', 'meta', 'pagina-1', 'Página principal')
    `).run();
    const insertar = sqlite.prepare(`
      INSERT INTO lead_eventos_externos
        (fuente_id, proveedor, identificador_evento_externo, tipo, recibido_en)
      VALUES (1, 'meta', 'evento-123', 'comentario', '2026-08-21T10:00:00.000Z')
    `);
    insertar.run();

    assert.throws(() => insertar.run(), /UNIQUE constraint failed/);
  });
});

test("dos inicializaciones consecutivas son idempotentes y conservan datos", () => {
  conBase((sqlite) => {
    inicializarPersistenciaCentroLeads(sqlite);
    sqlite.prepare(`
      INSERT INTO lead_fuentes (canal, proveedor, identificador_externo, nombre)
      VALUES ('whatsapp', 'meta', 'numero-1', 'WhatsApp sucursal')
    `).run();
    const antes = { tablas: tablas(sqlite), indices: indices(sqlite) };

    inicializarPersistenciaCentroLeads(sqlite);

    assert.deepStrictEqual(tablas(sqlite), antes.tablas);
    assert.deepStrictEqual(indices(sqlite), antes.indices);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_fuentes").pluck().get(), 1);
  });
});

test("una base existente conserva intacto el documento JSON antes y después de migrar", () => {
  conBase((sqlite) => {
    const documento = JSON.stringify({ pos: { ventas: [{ id: 91 }] }, crm: { clientes: [{ id: 8 }] } });
    sqlite.exec(`
      CREATE TABLE estado (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        datos TEXT NOT NULL,
        actualizado TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    sqlite.prepare("INSERT INTO estado (id, datos) VALUES (1, ?)").run(documento);

    inicializarPersistenciaCentroLeads(sqlite);

    assert.strictEqual(sqlite.prepare("SELECT datos FROM estado WHERE id = 1").pluck().get(), documento);
    assert.deepStrictEqual(
      sqlite.prepare("PRAGMA table_info(estado)").all().map((c) => c.name),
      ["id", "datos", "actualizado"]
    );
  });
});

test("los datos relacionales permanecen después de cerrar y volver a abrir SQLite", () => {
  const temporal = baseTemporal();
  try {
    let sqlite = new Database(temporal.ruta);
    inicializarPersistenciaCentroLeads(sqlite);
    sqlite.prepare(`
      INSERT INTO lead_fuentes (canal, proveedor, identificador_externo, nombre)
      VALUES ('instagram', 'meta', 'cuenta-7', 'Instagram tienda')
    `).run();
    sqlite.close();

    sqlite = new Database(temporal.ruta);
    inicializarPersistenciaCentroLeads(sqlite);
    assert.deepStrictEqual(
      sqlite.prepare("SELECT canal, identificador_externo FROM lead_fuentes").get(),
      { canal: "instagram", identificador_externo: "cuenta-7" }
    );
    sqlite.close();
  } finally {
    fs.rmSync(temporal.carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("una transacción fallida no conserva escrituras parciales", () => {
  conBase((sqlite) => {
    inicializarPersistenciaCentroLeads(sqlite);
    const operacion = sqlite.transaction(() => {
      sqlite.prepare(`
        INSERT INTO lead_fuentes (canal, proveedor, identificador_externo, nombre)
        VALUES ('tiktok', 'tiktok', 'cuenta-1', 'TikTok')
      `).run();
      throw new Error("fallo deliberado");
    });

    assert.throws(() => operacion(), /fallo deliberado/);
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_fuentes").pluck().get(), 0);
  });
});

test("un fallo de migración revierte la versión y todo el esquema de esa migración", () => {
  conBase((sqlite) => {
    const migracionesConFallo = [
      {
        version: 1,
        aplicar(db) {
          db.exec("CREATE TABLE no_debe_quedar (id INTEGER PRIMARY KEY)");
          throw new Error("migración rota");
        },
      },
    ];

    assert.throws(
      () => inicializarPersistenciaCentroLeads(sqlite, { migraciones: migracionesConFallo }),
      /migración rota/
    );
    assert.deepStrictEqual(tablas(sqlite), []);
  });
});

test("las relaciones propias aceptan padres válidos y rechazan FKs internas inválidas", () => {
  conBase((sqlite) => {
    inicializarPersistenciaCentroLeads(sqlite);
    sqlite.prepare(`
      INSERT INTO lead_fuentes (canal, proveedor, identificador_externo, nombre)
      VALUES ('facebook', 'meta', 'pagina-2', 'Página dos')
    `).run();
    sqlite.prepare(`
      INSERT INTO lead_conversaciones
        (fuente_id, canal, identificador_conversacion_externa, iniciada_en, ultima_interaccion_en)
      VALUES (1, 'messenger', 'hilo-1', '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:00.000Z')
    `).run();

    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) FROM lead_conversaciones").pluck().get(), 1);
    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO lead_conversaciones
          (fuente_id, canal, identificador_conversacion_externa, iniciada_en, ultima_interaccion_en)
        VALUES (999, 'messenger', 'hilo-invalido', '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:00.000Z')
      `).run(),
      /FOREIGN KEY constraint failed/
    );
  });
});

test("los IDs de entidades del JSON son referencias lógicas sin FK SQLite", () => {
  conBase((sqlite) => {
    inicializarPersistenciaCentroLeads(sqlite);
    sqlite.prepare(`
      INSERT INTO leads (
        estado, creado_en, actualizado_en,
        cliente_id, producto_id,
        vendedor_origen_id, vendedor_asignado_id,
        sucursal_origen_id, sucursal_asignada_id
      ) VALUES (
        'nuevo', '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:00.000Z',
        900001, 900002, 900003, 900004, 900005, 900006
      )
    `).run();

    const lead = sqlite.prepare(`
      SELECT cliente_id, producto_id, vendedor_origen_id, vendedor_asignado_id,
             sucursal_origen_id, sucursal_asignada_id
      FROM leads
    `).get();
    assert.deepStrictEqual(lead, {
      cliente_id: 900001,
      producto_id: 900002,
      vendedor_origen_id: 900003,
      vendedor_asignado_id: 900004,
      sucursal_origen_id: 900005,
      sucursal_asignada_id: 900006,
    });
  });
});

test("persistencia.js inicializa Centro de Leads en el mismo archivo DB_PATH", () => {
  const temporal = baseTemporal("corpunisound.sqlite");
  try {
    const script = `
      const persistencia = require(${JSON.stringify(path.join(__dirname, "persistencia.js"))});
      persistencia.guardar({ marcador: "json-existente" });
    `;
    const ejecucion = spawnSync(process.execPath, ["-e", script], {
      env: { ...process.env, NODE_ENV: "test", DB_PATH: temporal.ruta },
      encoding: "utf8",
    });
    assert.strictEqual(ejecucion.status, 0, ejecucion.stderr || ejecucion.stdout);

    const sqlite = new Database(temporal.ruta);
    assert.ok(tablas(sqlite).includes("estado"));
    assert.ok(tablas(sqlite).includes("leads"));
    assert.strictEqual(
      JSON.parse(sqlite.prepare("SELECT datos FROM estado WHERE id = 1").pluck().get()).marcador,
      "json-existente"
    );
    sqlite.close();
  } finally {
    fs.rmSync(temporal.carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("el proyecto usa la migración real declarada y no agrega dependencias", () => {
  assert.ok(Array.isArray(MIGRACIONES));
  assert.strictEqual(MIGRACIONES.at(-1).version, VERSION_ESQUEMA);
  const dependencias = require("./package.json").dependencies;
  assert.ok(dependencias["better-sqlite3"]);
  assert.strictEqual(dependencias.sequelize, undefined);
  assert.strictEqual(dependencias.typeorm, undefined);
  assert.strictEqual(dependencias.prisma, undefined);
});

test("V4: la conversación sabe su identidad y un cliente tiene un solo expediente", () => {
  conBase((sqlite) => {
    inicializarPersistenciaCentroLeads(sqlite);
    assert.ok(sqlite.prepare("PRAGMA table_info(lead_conversaciones)").all().some((c) => c.name === "identidad_externa_id"));
    const insertar = sqlite.prepare(`INSERT INTO leads (cliente_id, estado, creado_en, actualizado_en) VALUES (?, 'NUEVO', 'x', 'x')`);
    insertar.run(7);
    insertar.run(null);
    insertar.run(null);
    assert.throws(() => insertar.run(7), /UNIQUE/);
  });
});
