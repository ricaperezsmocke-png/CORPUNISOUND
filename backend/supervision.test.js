const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("./supervision");

const AHORA = "2026-09-10T16:00:00.000Z";
const SUP = { id: 80, nombre: "Sup" };
const ENCARGADA = { id: 90, nombre: "Encargada" };
const FOTO = { drive_id: "d1", nombre: "f.jpg", huella: "h1" };
const EN_TIENDA = { sucursal_id: 1, lat: 16.9, lng: -92.1 };

function prepararDB() {
  const DB = {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo", lat: 16.9, lng: -92.1 }, { id: 2, nombre: "Yajalón", lat: null, lng: null }] },
    admin: { usuarios: [
      { id: 80, nombre: "Sup", activo: true, sucursal_id: 1 },
      { id: 90, nombre: "Encargada", activo: true, sucursal_id: 1 },
      { id: 91, nombre: "Otra tienda", activo: true, sucursal_id: 2 },
      { id: 92, nombre: "Baja", activo: false, sucursal_id: 1 },
    ] },
    supervision: { checklist: [], visitas: [], fallas: [], encargado_sugerido: {} },
  };
  S.asegurarChecklistInicial(DB);
  return DB;
}

const falla = (extra = {}) => ({ resultado: "falla", nota: "Sucio", responsable_id: 90, pasos: ["Barrer"], ...extra });

function visitaTerminadaConFalla(DB) {
  const v = S.iniciarVisita(DB, EN_TIENDA, SUP, AHORA);
  const [primero, ...resto] = DB.supervision.checklist;
  S.marcarPunto(DB, v.id, { checklist_id: primero.id, ...falla({ pasos: ["Barrer", "Trapear"] }) }, SUP, FOTO);
  for (const p of resto) S.marcarPunto(DB, v.id, { checklist_id: p.id, resultado: "bien" }, SUP, null);
  return S.terminarVisita(DB, v.id, SUP, AHORA);
}

test("checklist inicial: 15 puntos en 3 secciones, siembra una vez", () => {
  const DB = prepararDB();
  S.asegurarChecklistInicial(DB);
  assert.equal(DB.supervision.checklist.length, 15);
  assert.deepEqual([...new Set(DB.supervision.checklist.map((p) => p.seccion))], ["imagen", "sistemas", "funcionamiento"]);
});

test("visita: dentro de 300 m comprobada; lejos o tienda sin coordenadas no comprobada", () => {
  const DB = prepararDB();
  assert.equal(S.iniciarVisita(DB, { ...EN_TIENDA, lat: 16.9005 }, SUP, AHORA).ubicacion.comprobada, true);
  assert.equal(S.iniciarVisita(DB, { ...EN_TIENDA, lat: 16.95 }, { id: 81, nombre: "Sup2" }, AHORA).ubicacion.comprobada, false);
  const sinCoordenadas = S.iniciarVisita(DB, { sucursal_id: 2, lat: 16.9, lng: -92.1 }, SUP, AHORA);
  assert.equal(sinCoordenadas.ubicacion.comprobada, false);
  assert.equal(sinCoordenadas.ubicacion.distancia_m, null);
  assert.equal(sinCoordenadas.mes, "2026-09");
});

test("visita: una en curso por supervisor y tienda; ubicacion o tienda invalidas se rechazan", () => {
  const DB = prepararDB();
  S.iniciarVisita(DB, EN_TIENDA, SUP, AHORA);
  assert.throws(() => S.iniciarVisita(DB, EN_TIENDA, SUP, AHORA), /en curso/);
  assert.throws(() => S.iniciarVisita(DB, { ...EN_TIENDA, lat: "x" }, { id: 81 }, AHORA), /ubicación/);
  assert.throws(() => S.iniciarVisita(DB, { ...EN_TIENDA, lat: null }, { id: 81 }, AHORA), /ubicación/);
  assert.throws(() => S.iniciarVisita(DB, { ...EN_TIENDA, sucursal_id: 77 }, { id: 81 }, AHORA), /tienda no existe/);
});

test("falla exige nota, foto, responsable activo de esa tienda y al menos un paso", () => {
  const DB = prepararDB();
  const v = S.iniciarVisita(DB, EN_TIENDA, SUP, AHORA);
  const checklist_id = DB.supervision.checklist[0].id;
  assert.throws(() => S.marcarPunto(DB, v.id, { checklist_id, ...falla() }, SUP, null), /foto/);
  assert.throws(() => S.marcarPunto(DB, v.id, { checklist_id, ...falla({ nota: " " }) }, SUP, FOTO), /nota/);
  assert.throws(() => S.marcarPunto(DB, v.id, { checklist_id, ...falla({ responsable_id: 91 }) }, SUP, FOTO), /de esta tienda/);
  assert.throws(() => S.marcarPunto(DB, v.id, { checklist_id, ...falla({ responsable_id: 92 }) }, SUP, FOTO), /de esta tienda/);
  assert.throws(() => S.marcarPunto(DB, v.id, { checklist_id, ...falla({ pasos: [] }) }, SUP, FOTO), /paso/);
  assert.throws(() => S.marcarPunto(DB, v.id, { checklist_id, ...falla({ pasos: [" "] }) }, SUP, FOTO), /paso/);
  assert.throws(() => S.marcarPunto(DB, v.id, { checklist_id, resultado: "regular" }, SUP, null), /resultado/);
  S.marcarPunto(DB, v.id, { checklist_id: String(checklist_id), ...falla({ responsable_id: "90", pasos: ["Barrer", "Trapear"] }) }, SUP, FOTO);
  assert.equal(DB.supervision.encargado_sugerido[1], 90);
  assert.equal(DB.supervision.visitas[0].puntos.length, 1);
  S.marcarPunto(DB, v.id, { checklist_id, resultado: "bien" }, SUP, null);
  assert.equal(DB.supervision.visitas[0].puntos.length, 1);
  assert.equal(DB.supervision.visitas[0].puntos[0].resultado, "bien");
});

test("otro supervisor no toca la visita ajena (404)", () => {
  const DB = prepararDB();
  const v = S.iniciarVisita(DB, EN_TIENDA, SUP, AHORA);
  assert.throws(() => S.marcarPunto(DB, v.id, { checklist_id: DB.supervision.checklist[0].id, resultado: "bien" }, { id: 81 }, null),
    (e) => e.status === 404);
});

test("terminar exige todos los puntos activos y crea fallas con limite a 7 dias", () => {
  const DB = prepararDB();
  const v = S.iniciarVisita(DB, EN_TIENDA, SUP, AHORA);
  assert.throws(() => S.terminarVisita(DB, v.id, SUP, AHORA), /Faltan 15/);
  const DB2 = prepararDB();
  const { visita, fallas } = visitaTerminadaConFalla(DB2);
  assert.equal(visita.estado, "terminada");
  assert.equal(visita.terminada_en, AHORA);
  assert.equal(fallas.length, 1);
  assert.equal(fallas[0].limite, "2026-09-17");
  assert.equal(fallas[0].responsable_id, 90);
  assert.deepEqual(fallas[0].pasos.map((p) => p.texto), ["Barrer", "Trapear"]);
  assert.throws(() => S.marcarPunto(DB2, visita.id, { checklist_id: DB2.supervision.checklist[0].id, resultado: "bien" }, SUP, null),
    /terminada/);
});

test("un punto desactivado no se exige al terminar", () => {
  const DB = prepararDB();
  const [primero, ...resto] = DB.supervision.checklist;
  S.editarChecklist(DB, { accion: "desactivar", id: primero.id, motivo: "Ya no aplica" }, SUP);
  const v = S.iniciarVisita(DB, EN_TIENDA, SUP, AHORA);
  for (const p of resto) S.marcarPunto(DB, v.id, { checklist_id: p.id, resultado: "bien" }, SUP, null);
  assert.equal(S.terminarVisita(DB, v.id, SUP, AHORA).visita.estado, "terminada");
  assert.throws(() => S.editarChecklist(DB, { accion: "desactivar", id: resto[0].id, motivo: "" }, SUP), /motivo/);
  const nuevo = S.editarChecklist(DB, { accion: "agregar", seccion: "imagen", texto: "Vitrina", motivo: "Nueva vitrina" }, SUP);
  assert.equal(nuevo.activo, true);
  assert.throws(() => S.editarChecklist(DB, { accion: "agregar", seccion: "otra", texto: "X", motivo: "x" }, SUP), /sección/);
});

test("solo el responsable resuelve, con foto; reasignar y cancelar piden motivo; atrasada al octavo dia", () => {
  const DB = prepararDB();
  const [f] = visitaTerminadaConFalla(DB).fallas;
  const foto = { drive_id: "d2", nombre: "r.jpg", huella: "h2" };
  assert.throws(() => S.resolverFalla(DB, f.id, { nota: "Listo" }, { id: 91, nombre: "X" }, foto), /responsable/);
  assert.throws(() => S.resolverFalla(DB, f.id, { nota: "Listo" }, ENCARGADA, null), /foto/);
  assert.throws(() => S.reasignarFalla(DB, f.id, { responsable_id: 90, motivo: "" }, SUP), /motivo/);
  assert.throws(() => S.reasignarFalla(DB, f.id, { responsable_id: 91, motivo: "Cambio" }, SUP), /de esta tienda/);
  assert.equal(S.fallaAtrasada(f, "2026-09-17"), false);
  assert.equal(S.fallaAtrasada(f, "2026-09-18"), true);
  S.marcarPaso(DB, f.id, 0, ENCARGADA);
  assert.throws(() => S.marcarPaso(DB, f.id, 5, ENCARGADA), /paso/);
  const r = S.resolverFalla(DB, f.id, { nota: "Listo" }, ENCARGADA, foto);
  assert.equal(r.estado, "resuelta");
  assert.deepEqual(r.historial.map((h) => h.accion), ["abierta", "paso", "resuelta"]);
  assert.equal(S.fallaAtrasada(r, "2026-12-01"), false);
  assert.throws(() => S.resolverFalla(DB, f.id, { nota: "Otra" }, ENCARGADA, foto), /abierta/);
});

test("reasignar y cancelar dejan historial con motivo", () => {
  const DB = prepararDB();
  DB.admin.usuarios.push({ id: 93, nombre: "Encargado 2", activo: true, sucursal_id: 1 });
  const [f] = visitaTerminadaConFalla(DB).fallas;
  S.reasignarFalla(DB, f.id, { responsable_id: "93", motivo: "Ella está de vacaciones" }, SUP);
  assert.equal(f.responsable_id, 93);
  assert.throws(() => S.resolverFalla(DB, f.id, { nota: "x" }, ENCARGADA, FOTO), /responsable/);
  S.cancelarFalla(DB, f.id, { motivo: "Se cerró la tienda" }, SUP);
  assert.equal(f.estado, "cancelada");
  assert.deepEqual(f.historial.map((h) => h.accion), ["abierta", "reasignada", "cancelada"]);
  assert.equal(f.historial[1].nota, "Ella está de vacaciones");
});
