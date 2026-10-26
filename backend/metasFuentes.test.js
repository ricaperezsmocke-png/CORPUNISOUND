const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { contarFuente, configurarFuentes, FUENTES } = require("./metasFuentes");

const MES = { periodo: "mensual", inicio: "2026-09-01" };
const meta = (fuente, extra = {}) => ({ clave: 1, alcance: "corporativo", usuario_id: 80, sucursal_id: null, fuente, ...MES, ...extra });
const DBBase = () => ({
  pos: { sucursales: [{ id: 1 }, { id: 2 }], meta_capturas: [] },
  crm: { clientes: [{ id: 5, sucursal_id: 1 }, { id: 6, sucursal_id: 2 }], estados_historial: [] },
  radar_demanda: { registros: [], seguimientos: [] },
  supervision: { visitas: [] },
});

test("catalogo cerrado de fuentes", () => {
  assert.deepEqual(FUENTES, ["manual", "radar_seguimiento_a_tiempo", "crm_cambios_estado", "bandeja_respuestas",
    "revisiones_metas_tienda", "visitas_tienda", "cinco_caminos:pct_con_cliente", "cinco_caminos:recompra_90",
    "cinco_caminos:pct_instrumento_con_accesorio", "cinco_caminos:conversion", "cinco_caminos:ticket_promedio_centavos",
    "cinco_caminos:clientes_nuevos", "cinco_caminos:articulos_por_ticket"]);
});

test("radar: cuenta el primer seguimiento propio dentro de 48 h, no el de 3 dias ni el ajeno", () => {
  const DB = DBBase();
  DB.radar_demanda.registros = [
    { id: 1, sucursal_id: 1, fecha_registro: "2026-09-10T15:00:00.000Z" },
    { id: 2, sucursal_id: 1, fecha_registro: "2026-09-10T15:00:00.000Z" },
    { id: 3, sucursal_id: 2, fecha_registro: "2026-09-10T15:00:00.000Z" },
  ];
  DB.radar_demanda.seguimientos = [
    { id: 1, demanda_id: 1, usuario_id: 80, fecha_hora: "2026-09-12T14:00:00.000Z" }, // 47 h: cuenta
    { id: 2, demanda_id: 1, usuario_id: 80, fecha_hora: "2026-09-12T16:00:00.000Z" }, // segundo: no
    { id: 3, demanda_id: 2, usuario_id: 80, fecha_hora: "2026-09-13T16:00:00.000Z" }, // 3 dias: no
    { id: 4, demanda_id: 3, usuario_id: 81, fecha_hora: "2026-09-10T16:00:00.000Z" }, // ajeno: no
  ];
  const r = contarFuente(DB, meta("radar_seguimiento_a_tiempo"));
  assert.equal(r.valor, 1);
  assert.equal(r.detalle[0].clave, "radar:1");
});

test("radar: primer seguimiento ajeno gana aunque luego siga el propio", () => {
  const DB = DBBase();
  DB.radar_demanda.registros = [{ id: 1, sucursal_id: 1, fecha_registro: "2026-09-10T15:00:00.000Z" }];
  DB.radar_demanda.seguimientos = [
    { id: 1, demanda_id: 1, usuario_id: 81, fecha_hora: "2026-09-10T16:00:00.000Z" },
    { id: 2, demanda_id: 1, usuario_id: 80, fecha_hora: "2026-09-10T17:00:00.000Z" },
  ];
  assert.equal(contarFuente(DB, meta("radar_seguimiento_a_tiempo")).valor, 0);
});

test("crm: cuenta cambios propios del periodo, ignora sistema, otros meses y otra tienda", () => {
  const DB = DBBase();
  DB.crm.estados_historial = [
    { id: 1, cliente_id: 5, usuario_id: 80, fecha_hora: "2026-09-03T18:00:00.000Z" },
    { id: 2, cliente_id: 5, usuario_id: null, fecha_hora: "2026-09-03T18:00:00.000Z" },
    { id: 3, cliente_id: 5, usuario_id: 80, fecha_hora: "2026-10-01T18:00:00.000Z" },
    { id: 4, cliente_id: 6, usuario_id: 80, fecha_hora: "2026-09-04T18:00:00.000Z" },
  ];
  assert.equal(contarFuente(DB, meta("crm_cambios_estado")).valor, 2);
  assert.equal(contarFuente(DB, meta("crm_cambios_estado", { sucursal_id: 1 })).valor, 1);
});

test("crm: suma los cambios de clientes SICAR de sqlite", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE sicar_estados_historial (id INTEGER PRIMARY KEY, sucursal_id INTEGER, cli_id TEXT, anterior TEXT, nuevo TEXT,"
    + " usuario_id INTEGER, fecha_hora TEXT)");
  sqlite.prepare("INSERT INTO sicar_estados_historial VALUES (1, 1, 'A', NULL, 'interesado', 80, '2026-09-05T18:00:00.000Z')").run();
  configurarFuentes({ sqlite });
  try {
    assert.equal(contarFuente(DBBase(), meta("crm_cambios_estado")).valor, 1);
  } finally { configurarFuentes({ sqlite: null }); }
});

test("bandeja: cuenta salientes propios; sin bandeja avisa y vale 0", () => {
  assert.deepEqual(contarFuente(DBBase(), meta("bandeja_respuestas")),
    { valor: 0, detalle: [], aviso: "La bandeja de mensajes no está disponible; esta meta no se puede contar ahora" });
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE lead_fuentes (id INTEGER PRIMARY KEY, sucursal_responsable_id INTEGER);
    CREATE TABLE lead_conversaciones (id INTEGER PRIMARY KEY, fuente_id INTEGER);
    CREATE TABLE lead_interacciones (id INTEGER PRIMARY KEY, conversacion_id INTEGER, direccion TEXT, ocurrida_en TEXT, usuario_id INTEGER);
    INSERT INTO lead_fuentes VALUES (1, 1), (2, 2);
    INSERT INTO lead_conversaciones VALUES (10, 1), (11, 2);
    INSERT INTO lead_interacciones VALUES (1, 10, 'saliente', '2026-09-02T18:00:00.000Z', 80),
      (2, 10, 'entrante', '2026-09-02T18:00:00.000Z', NULL), (3, 11, 'saliente', '2026-09-02T18:00:00.000Z', 80),
      (4, 10, 'saliente', '2026-09-02T18:00:00.000Z', 81);`);
  configurarFuentes({ sqlite });
  try {
    assert.equal(contarFuente(DBBase(), meta("bandeja_respuestas")).valor, 2);
    assert.equal(contarFuente(DBBase(), meta("bandeja_respuestas", { sucursal_id: 1 })).valor, 1);
  } finally { configurarFuentes({ sqlite: null }); }
});

test("revisiones: revisada o anulada por la cuenta cuenta una vez por captura", () => {
  const DB = DBBase();
  DB.pos.meta_capturas = [
    { id: 1, sucursal_id: 1, revisada: { por_id: 80, en: "2026-09-05T18:00:00.000Z" }, anulada: { por_id: 80, en: "2026-09-06T18:00:00.000Z" } },
    { id: 2, sucursal_id: 1, revisada: null, anulada: { por_id: 80, en: "2026-09-06T18:00:00.000Z" } },
    { id: 3, sucursal_id: 1, revisada: { por_id: 81, en: "2026-09-06T18:00:00.000Z" }, anulada: null },
  ];
  assert.equal(contarFuente(DB, meta("revisiones_metas_tienda")).valor, 2);
});

test("visitas: una por tienda y mes, solo terminadas y con ubicacion comprobada", () => {
  const DB = DBBase();
  const v = (id, sucursal_id, estado, comprobada) => ({ id, sucursal_id, mes: "2026-09", supervisor_id: 80, estado,
    terminada_en: "2026-09-08T18:00:00.000Z", ubicacion: { comprobada } });
  DB.supervision.visitas = [v(1, 1, "terminada", true), v(2, 1, "terminada", true), v(3, 2, "terminada", false), v(4, 2, "en_curso", true)];
  assert.equal(contarFuente(DB, meta("visitas_tienda")).valor, 1);
});

test("fuente desconocida lanza", () => {
  assert.throws(() => contarFuente(DBBase(), meta("inventada")), /desconocida/);
});

test("I3: revisar o anular capturas propias no cuenta como revision", () => {
  const DB = DBBase();
  DB.pos.meta_capturas = [
    { id: 1, sucursal_id: 1, usuario_id: 80, creado_por_id: 80, revisada: null, anulada: { por_id: 80, en: "2026-09-06T18:00:00.000Z" } },
    { id: 2, sucursal_id: 1, vendedor_id: 3, creado_por_id: 80, revisada: { por_id: 80, en: "2026-09-06T18:00:00.000Z" }, anulada: null },
    { id: 3, sucursal_id: 1, vendedor_id: 3, creado_por_id: 33, revisada: { por_id: 80, en: "2026-09-06T18:00:00.000Z" }, anulada: null },
  ];
  assert.equal(contarFuente(DB, meta("revisiones_metas_tienda")).valor, 1);
});
