const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./metasPersonalizadas");
const { porcentaje, semaforo, resultadoMeta, tablero } = require("./metasAvance");
const { registrarEnPlantilla } = require("./objetivos");
const { capturarMeta } = require("./metasCapturas");

beforeEach((t) => t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-20T18:00:00Z") }));

const VICTOR = { id: 1, nombre: "Victor" };
function DBPrueba() {
  return { pos: {
    sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 4, nombre: "Palenque" }],
    vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 4 }, { id: 2, nombre: "Luis", sucursal_id: 4 }, { id: 3, nombre: "Eva", sucursal_id: 1 }],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [], objetivo_plantilla: [],
  } };
}
const BASE = { periodo: "mensual", inicio: "2026-10-01" };
const captura = (DB, meta, vendedor_id, cantidad, extra = {}) => DB.pos.meta_capturas.push({
  id: DB.pos.meta_capturas.length + 1, meta_clave: meta.clave, meta_id: meta.id, ...BASE, fecha: "2026-10-03",
  vendedor_id, sucursal_id: 4, cantidad, evidencia: null, nota: null, anulada: null, ...extra });
const JEFE_GLOBAL = { vendedor_id: null, jefatura: true, verTodas: true, sucursalId: null };

const ANA = { vendedor_id: 1, jefatura: false, verTodas: false, sucursalId: 4 };
const PASADO = { periodo: "mensual", inicio: "2026-09-01" };
function metaDeTienda(DB, periodo = PASADO) {
  return M.crearMeta(DB, { ...periodo, nombre: "Videos", unidad: "videos", prueba: "ninguna",
    valor_meta: 10, alcance: "tienda", sucursal_id: 1 }, VICTOR);
}
function plantillaAna(DB, mes, desde, hasta = null) {
  DB.pos.vendedores[0].sucursal_id = 1;
  registrarEnPlantilla(DB, { mes, desde, hasta, sucursal_id: 1, vendedor_id: 1 });
  DB.pos.vendedores[0].sucursal_id = 4;
}

for (const anulada of [null, { motivo: "Duplicada" }]) {
  test(`trasladada conserva la meta y su captura histórica, anulada: ${Boolean(anulada)}`, () => {
    const DB = DBPrueba();
    const meta = metaDeTienda(DB);
    captura(DB, meta, 1, 3, { ...PASADO, fecha: "2026-09-03", sucursal_id: 1, anulada });
    const t = tablero(DB, ANA, PASADO, "2026-10-09");
    assert.equal(t.sueltas.length, 1);
    assert.equal(t.sueltas[0].mis_capturas[0].cantidad, 3);
    assert.equal(t.sueltas[0].puede_capturar, false);
    assert.equal(tablero(DB, { ...ANA, vendedor_id: 2 }, PASADO, "2026-10-09").sueltas.length, 0);
    const gerente = { ...ANA, jefatura: true };
    assert.equal(tablero(DB, gerente, PASADO, "2026-10-09").sueltas.length, 0);
  });
}

test("plantilla histórica permite ver y capturar al final del periodo después del traslado", async () => {
  const DB = DBPrueba();
  const meta = metaDeTienda(DB);
  plantillaAna(DB, "2026-09", "2026-09-01");
  const t = tablero(DB, ANA, PASADO, "2026-10-09");
  assert.equal(t.sueltas.length, 1);
  assert.equal(t.sueltas[0].puede_capturar, true);
  const c = await capturarMeta(DB, meta.clave, { fecha: "2026-09-30", cantidad: 1 }, { usuario: VICTOR, vendedor_id: 1 });
  assert.equal(c.sucursal_id, 1);
});

test("visibilidad cruza meses del trimestre y respeta los días de una semana", () => {
  const DB = DBPrueba();
  plantillaAna(DB, "2026-08", "2026-08-15", "2026-08-20");
  const trimestre = { periodo: "trimestral", inicio: "2026-07-01" };
  metaDeTienda(DB, trimestre);
  assert.equal(tablero(DB, ANA, trimestre, "2026-10-09").sueltas.length, 1);
  const semana = { periodo: "semanal", inicio: "2026-08-24" };
  metaDeTienda(DB, semana);
  assert.equal(tablero(DB, ANA, semana, "2026-10-09").sueltas.length, 0);
});

test("tienda actual no ofrece Hecho si la plantilla rechaza esa fecha", async () => {
  const DB = DBPrueba();
  const meta = metaDeTienda(DB);
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 4, vendedor_id: 1 });
  DB.pos.vendedores[0].sucursal_id = 1;
  assert.equal(tablero(DB, ANA, PASADO, "2026-10-09").sueltas[0].puede_capturar, false);
  await assert.rejects(capturarMeta(DB, meta.clave, { fecha: "2026-09-30", cantidad: 1 },
    { usuario: VICTOR, vendedor_id: 1 }), /plantilla/);
});

test("Hecho queda desactivado para periodos futuros y sellados", () => {
  const DB = DBPrueba();
  const futuro = { periodo: "mensual", inicio: "2026-11-01" };
  metaDeTienda(DB, futuro);
  const eva = { ...ANA, vendedor_id: 3 };
  assert.equal(tablero(DB, eva, futuro, "2026-10-09").sueltas[0].puede_capturar, false);
  metaDeTienda(DB);
  DB.pos.meta_sellos.push({ ...PASADO, foto: { resultados: [] } });
  assert.equal(tablero(DB, eva, PASADO, "2026-10-09").sueltas[0].puede_capturar, false);
});

test("retirada conserva tres capturas propias sin Drive ni efecto en OKR", () => {
  const DB = DBPrueba();
  const okr = M.crearOkr(DB, { ...PASADO, titulo: "Redes", alcance: "tienda", sucursal_id: 1 }, VICTOR);
  const meta = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 10 }, VICTOR);
  const vigente = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Visitas", unidad: "visitas", prueba: "ninguna", valor_meta: 10 }, VICTOR);
  plantillaAna(DB, "2026-09", "2026-09-01");
  captura(DB, vigente, 1, 5);
  captura(DB, meta, 1, 1);
  captura(DB, meta, 1, 1, { anulada: { motivo: "Duplicada" } });
  captura(DB, meta, 1, 1, { evidencia: { tipo: "foto", drive_file_id: "privado", drive_link: "https://drive/foto" } });
  captura(DB, meta, 3, 9);
  M.retirarMeta(DB, meta.clave, "Cambio de campaña", VICTOR);
  const t = tablero(DB, ANA, PASADO, "2026-10-09");
  assert.equal(t.retiradas?.length, 1);
  assert.equal(t.retiradas[0].mis_capturas.length, 3);
  assert.equal(t.retiradas[0].retirada.motivo, "Cambio de campaña");
  assert.equal(t.retiradas[0].mis_capturas[2].evidencia.drive_file_id, undefined);
  assert.equal(t.retiradas[0].resultado, undefined);
  assert.equal(t.okrs[0].porcentaje, 50);
  assert.deepEqual(t.okrs[0].metas.map((m) => m.clave), [vigente.clave]);
  assert.equal(t.sueltas.length, 0);
  DB.pos.vendedores[1].sucursal_id = 1;
  assert.deepEqual(tablero(DB, { ...ANA, vendedor_id: 2 }, PASADO, "2026-10-09").retiradas, []);
  assert.equal(tablero(DB, JEFE_GLOBAL, PASADO, "2026-10-09").retiradas.length, 1);
  assert.deepEqual(tablero(DB, { ...ANA, jefatura: true }, PASADO, "2026-10-09").retiradas, []);
});

test("mis capturas incluye las anuladas propias con auditoría, sin sumarlas ni exponer Drive o capturas ajenas", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, {
    ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4,
  }, VICTOR);
  const otra = M.crearMeta(DB, {
    ...BASE, nombre: "Otra", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4,
  }, VICTOR);
  const anulada = { por_id: 1, por_nombre: "Victor", en: "2026-10-09T18:00:00.000Z", motivo: "Foto equivocada" };
  captura(DB, meta, 1, 2);
  captura(DB, meta, 1, 1, { anulada, evidencia: { tipo: "foto", drive_file_id: "privado", drive_link: "https://drive/foto" } });
  captura(DB, meta, 2, 3);
  captura(DB, meta, 2, 4, { anulada });
  captura(DB, otra, 1, 1, { anulada });
  const ana = { vendedor_id: 1, jefatura: false, verTodas: false, sucursalId: 4 };
  const avance = tablero(DB, ana, BASE, "2026-10-09").sueltas[0];
  assert.deepEqual(avance.mis_capturas.map((c) => c.id), [1, 2]);
  assert.deepEqual(avance.mis_capturas[1].anulada, anulada);
  assert.equal(avance.mis_capturas[1].evidencia.drive_file_id, undefined);
  assert.equal(avance.mis_capturas[1].evidencia.drive_link, "https://drive/foto");
  assert.equal(avance.resultado, 5);
  assert.equal(avance.por_persona, undefined);
  assert.deepEqual(tablero(DB, JEFE_GLOBAL, BASE, "2026-10-09").sueltas[0].por_persona, [
    { vendedor_id: 1, nombre: "Ana", resultado: 2 }, { vendedor_id: 2, nombre: "Luis", resultado: 3 },
  ]);
  assert.equal(DB.pos.meta_capturas[1].evidencia.drive_file_id, "privado");
});

test("porcentaje topado a 100 y semáforo contra el ritmo", () => {
  assert.equal(porcentaje(6, 12), 50);
  assert.equal(porcentaje(30, 12), 100);
  assert.equal(porcentaje(1, 3), 33.3);
  assert.equal(semaforo(50, 0.5), "verde");
  assert.equal(semaforo(36, 0.5), "amarillo");
  assert.equal(semaforo(34, 0.5), "rojo");
  assert.equal(semaforo(0, 0), "verde");
});

test("las capturas anuladas no suman", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  captura(DB, meta, 1, 3);
  captura(DB, meta, 2, 2, { anulada: { motivo: "x" } });
  assert.equal(resultadoMeta(DB, meta), 3);
});

test("editar la meta no pierde lo capturado con la versión anterior", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  captura(DB, meta, 1, 3);
  const v2 = M.editarMeta(DB, meta.clave, { valor_meta: 6, motivo: "Ajuste" }, VICTOR);
  assert.equal(resultadoMeta(DB, v2), 3);
  assert.equal(tablero(DB, JEFE_GLOBAL, BASE, "2026-10-15").sueltas[0].porcentaje, 50);
});

test("OKR = promedio de sus metas vigentes, cada una topada a 100", () => {
  const DB = DBPrueba();
  const okr = M.crearOkr(DB, { ...BASE, titulo: "Redes Palenque", alcance: "tienda", sucursal_id: 4 }, VICTOR);
  const a = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 10 }, VICTOR);
  const b = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Reseñas", unidad: "reseñas", prueba: "ninguna", valor_meta: 10 }, VICTOR);
  const c = M.crearMeta(DB, { okr_clave: okr.clave, nombre: "Talleres", unidad: "talleres", prueba: "ninguna", valor_meta: 2 }, VICTOR);
  captura(DB, a, 1, 20); captura(DB, b, 1, 5);
  M.retirarMeta(DB, c.clave, "ya no", VICTOR);
  const t = tablero(DB, JEFE_GLOBAL, BASE, "2026-10-15");
  assert.equal(t.okrs[0].porcentaje, 75);
  assert.equal(t.okrs[0].metas.length, 2);
  assert.equal(t.sueltas.length, 0);
});

test("vendedora: ve sus metas, las de su tienda y empresa donde participa; sin desglose ni capturas ajenas", () => {
  const DB = DBPrueba();
  const tienda = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Otra tienda", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "tienda", sucursal_id: 1 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "De Luis", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "persona", vendedor_id: 2 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Empresa ajena", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "empresa", participantes: [3] }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Empresa mía", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "empresa", participantes: [1, 3] }, VICTOR);
  captura(DB, tienda, 1, 2); captura(DB, tienda, 2, 4);
  const ana = { vendedor_id: 1, jefatura: false, verTodas: false, sucursalId: 4 };
  const t = tablero(DB, ana, { ...BASE, sucursal_id: 4 }, "2026-10-15");
  assert.deepEqual(t.sueltas.map((m) => m.nombre), ["Videos", "Empresa mía"]);
  assert.equal(t.sueltas[1].puede_capturar, true);
  assert.equal(t.sueltas[0].resultado, 6);
  assert.equal(t.sueltas[0].por_persona, undefined);
  assert.deepEqual(t.sueltas[0].mis_capturas.map((c) => c.vendedor_id), [1]);
});

test("jefatura de tienda: solo su tienda, con desglose por persona; sin empresa", () => {
  const DB = DBPrueba();
  const tienda = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Otra tienda", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "tienda", sucursal_id: 1 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "Empresa", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "empresa", participantes: [1] }, VICTOR);
  captura(DB, tienda, 1, 2); captura(DB, tienda, 2, 4);
  const gerente = { vendedor_id: null, jefatura: true, verTodas: false, sucursalId: 4 };
  const t = tablero(DB, gerente, { ...BASE, sucursal_id: 4 }, "2026-10-15");
  assert.deepEqual(t.sueltas.map((m) => m.nombre), ["Videos"]);
  assert.deepEqual(t.sueltas[0].por_persona, [{ vendedor_id: 1, nombre: "Ana", resultado: 2 }, { vendedor_id: 2, nombre: "Luis", resultado: 4 }]);
});

test("periodo sellado: el tablero usa el resultado rectificado", () => {
  const DB = DBPrueba();
  const meta = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 10, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  captura(DB, meta, 1, 4);
  DB.pos.meta_sellos.push({ id: 1, ...BASE, foto: { resultados: [{ clave: meta.clave, resultado: 4 }] },
    rectificaciones: [{ meta_clave: meta.clave, valor_nuevo: 5 }] });
  const t = tablero(DB, JEFE_GLOBAL, BASE, "2026-11-05");
  assert.equal(t.sellado, true);
  assert.equal(t.sueltas[0].resultado, 5);
  assert.equal(t.sueltas[0].porcentaje, 50);
});

test("puede_capturar: la gerente que vende no puede capturar la meta personal de su compañera", () => {
  const DB = DBPrueba();
  const tienda = M.crearMeta(DB, { ...BASE, nombre: "Videos", unidad: "videos", prueba: "ninguna", valor_meta: 12, alcance: "tienda", sucursal_id: 4 }, VICTOR);
  M.crearMeta(DB, { ...BASE, nombre: "De Luis", unidad: "x", prueba: "ninguna", valor_meta: 1, alcance: "persona", vendedor_id: 2 }, VICTOR);
  const gerenteQueVende = { vendedor_id: 1, jefatura: true, verTodas: false, sucursalId: 4 };
  const t = tablero(DB, gerenteQueVende, BASE, "2026-10-15");
  assert.deepEqual(t.sueltas.map((m) => [m.nombre, m.puede_capturar]), [["Videos", true], ["De Luis", false]]);
  assert.ok(tienda);
});

test("fase2: trasladada a media mes conserva Hecho para los dias que estuvo en la tienda", () => {
  const DB = { pos: { sucursales: [{ id: 1 }, { id: 4 }], vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 1 }],
    okrs: [], metas_personalizadas: [], meta_capturas: [], meta_sellos: [], objetivo_plantilla: [] } };
  M.crearMeta(DB, { periodo: "mensual", inicio: "2026-10-01", nombre: "V", unidad: "v", prueba: "ninguna",
    valor_meta: 10, alcance: "tienda", sucursal_id: 1 }, VICTOR);
  registrarEnPlantilla(DB, { mes: "2026-10", desde: "2026-10-01", hasta: "2026-10-15", sucursal_id: 1, vendedor_id: 1 });
  DB.pos.vendedores[0].sucursal_id = 4;
  registrarEnPlantilla(DB, { mes: "2026-10", desde: "2026-10-16", hasta: null, sucursal_id: 4, vendedor_id: 1 });
  const visor = { vendedor_id: 1, jefatura: false, verTodas: false, sucursalId: 4 };
  const tb = tablero(DB, visor, { periodo: "mensual", inicio: "2026-10-01" }, "2026-10-20");
  assert.equal(tb.sueltas.length, 1);
  assert.equal(tb.sueltas[0].puede_capturar, true);
  const antes = tablero(DB, visor, { periodo: "mensual", inicio: "2026-10-01" }, "2026-09-30");
  assert.equal(antes.sueltas[0].puede_capturar, false); // periodo que no ha empezado
});
