// Pruebas de la revision independiente de feature/cinco-caminos-p5 (2026-10-27).
// NO son parte de la suite: cada una DEMUESTRA un hallazgo (pasa = el defecto existe).
// Correr desde la raiz del repo:  node --test docs/revisiones/2026-10-27-cinco-caminos-p5/cierreMes.revision.js
// La raiz del repo es "type": "module": este archivo es ESM y carga el backend (CommonJS) con createRequire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backend');
const desde = rel => require(path.join(BACKEND, rel));
const Database = require(path.join(BACKEND, 'node_modules', 'better-sqlite3'));
const { crearRepositorioSicar } = desde('sicarRepositorio');
const manual = desde('cincoCaminos/manual');
const M = desde('metasPersonalizadas');
const { cerrarMesesPendientes, evaluarTactica, avanceEvidencias } = desde('cincoCaminos/cierreMes');

// ---- Mismo arreglo que backend/cincoCaminos/cierreMes.test.js (copiado, no importado) ----
const SEPT = '2026-09';
const GRACIA = '2026-10-08';
const VICTOR = { id: 1, nombre: 'Victor' };
const sumar = (dia, dias) => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
let folio = 0;
// 8 semanas base: 50 % con cliente y 30 clientes nuevos por semana. Septiembre: 66.7 % con cliente, 30 nuevos (0 %).
function sembrarTienda(sqlite, suc) {
  sqlite.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (?)').run(suc);
  for (let lunes = '2026-07-13'; lunes <= '2026-09-28'; lunes = sumar(lunes, 7)) {
    const mostrador = lunes >= '2026-09-07' ? 15 : 30;
    for (let j = 0; j < mostrador; j++) {
      sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
        VALUES (?, ?, ?, 'vigente', 10000, 'x')`).run(suc, String(++folio), `${sumar(lunes, j % 7)}T10:00:00`);
    }
    for (let j = 0; j < 30; j++) {
      const cli = `c${++folio}`;
      sqlite.prepare('INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (?, ?, ?)').run(suc, cli, cli);
      sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
        VALUES (?, ?, ?, ?, 'vigente', 10000, '1', 'h')`).run(suc, String(++folio), cli, `${sumar(lunes, j % 7)}T12:00:00`);
    }
  }
}
function prepararCierre(t) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  crearRepositorioSicar(sqlite);
  sembrarTienda(sqlite, 1);
  const DB = { pos: { cinco_caminos: { categorias: [], planes_mes: [] }, sucursales: [{ id: 1, nombre: 'Tienda 1' }], vendedores: [],
    metas_personalizadas: [], meta_capturas: [], meta_sellos: [], okrs: [], planes_ia: [] }, radar_demanda: { registros: [] },
  admin: { usuarios: [] } };
  manual.sembrarManual(DB);
  return { sqlite, DB };
}
function plan(DB, { tacticas, evidencias = [] }) {
  const p = { id: DB.pos.cinco_caminos.planes_mes.length + 1, sucursal_id: 1, mes: SEPT, camino: 'prospectos', tacticas, metas: [], evidencias };
  DB.pos.cinco_caminos.planes_mes.push(p);
  return p;
}
// La meta de evidencia como la crea validarPlanMes (planMes.js:419-424), con M.crearMeta real.
function metaDeEvidencia(DB, veces) {
  return M.crearMeta(DB, { nombre: 'Táctica: prueba', descripcion: 'Comprueba con foto que se hizo.', unidad: 'veces', fuente: 'manual',
    prueba: 'foto', valor_meta: veces, periodo: 'mensual', inicio: `${SEPT}-01`, alcance: 'tienda', sucursal_id: 1 }, VICTOR,
  { origen: { tipo: 'plan_mes', plan_id: 1 } }).clave;
}
const captura = (DB, clave, fecha, extra = {}) => DB.pos.meta_capturas.push({ id: DB.pos.meta_capturas.length + 1, meta_clave: clave, fecha,
  cantidad: 1, anulada: null, ...extra });
const cierreDe = DB => DB.pos.cinco_caminos.cierres[0].tacticas;

// H1: el cierre califica con la definicion ACTUAL de la tactica, no con la que tenia al aprobar el plan.
test('H1a: cambiar como_se_mide de evidencia a sistema despues de aprobar convierte un no_se_hizo en calificacion', t => {
  // Control: tactica 4 (evidencia, mueve clientes nuevos) con su meta de evidencia y CERO capturas -> no_se_hizo.
  const control = prepararCierre(t);
  plan(control.DB, { tacticas: [4], evidencias: [{ tactica_id: 4, meta_clave: metaDeEvidencia(control.DB, 3) }] });
  cerrarMesesPendientes(control.sqlite, control.DB, { hoy: GRACIA });
  assert.equal(cierreDe(control.DB)[0].resultado, 'no_se_hizo');

  // Mismo plan; a mitad del mes alguien con administrar_manual_tacticas cambia la tactica (PUT /api/cinco-caminos/manual/4).
  const { sqlite, DB } = prepararCierre(t);
  plan(DB, { tacticas: [4], evidencias: [{ tactica_id: 4, meta_clave: metaDeEvidencia(DB, 3) }] });
  manual.cambiarTactica(DB, 4, { como_se_mide: 'sistema', numero_que_mueve: 'pct_con_cliente', candado: null }, 1);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const [r] = cierreDe(DB);
  assert.equal(r.resultado, 'probada', 'nadie subio una sola foto y la tactica queda probada');
  assert.equal(DB.pos.cinco_caminos.tacticas.find(x => x.id === 4).etiquetas['1'].estado, 'probada');
});

test('H1b: cambiar el numero que mueve despues de aprobar cambia lo que se califica (igual pasa con el candado)', t => {
  // Tactica 1 aprobada para mover % con cliente; antes del cierre se edita para mover clientes nuevos.
  const { sqlite, DB } = prepararCierre(t);
  plan(DB, { tacticas: [1] });
  manual.cambiarTactica(DB, 1, { numero_que_mueve: 'clientes_nuevos' }, 1);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  assert.equal(cierreDe(DB)[0].numero, 'clientes_nuevos', 'el cierre usa el numero editado, no el aprobado');
});

// H2: la meta de evidencia se puede editar (valor_meta y prueba) con POST /api/metas/:clave/editar; el cierre usa la ultima version.
test('H2a: bajar valor_meta de la meta de evidencia de 4 a 1 hace "hecha" una tactica con 1 sola foto', t => {
  const { sqlite, DB } = prepararCierre(t);
  const clave = metaDeEvidencia(DB, 4);
  plan(DB, { tacticas: [4], evidencias: [{ tactica_id: 4, meta_clave: clave }] });
  captura(DB, clave, '2026-09-10');
  M.editarMeta(DB, clave, { valor_meta: 1, motivo: 'Ajuste' }, VICTOR);
  cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  const [r] = cierreDe(DB);
  assert.deepEqual(r.evidencia, { meta_clave: clave, requeridas: 1, capturas_contadas: [1] });
  assert.notEqual(r.resultado, 'no_se_hizo', 'el gerente aprobo 4 veces; con 1 foto ya cuenta como hecha');
});

test('H2b: cambiar la prueba a "ninguna" deja comprobar la tactica con una captura sin foto que vale hasta 1000', t => {
  const { DB } = prepararCierre(t);
  const clave = metaDeEvidencia(DB, 31);
  const v2 = M.editarMeta(DB, clave, { prueba: 'ninguna', motivo: 'Sin foto' }, VICTOR);
  assert.equal(v2.prueba, 'ninguna', 'editarMeta acepta quitarle la prueba a la meta de evidencia');
  // metasCapturas.js:53-61: sin prueba, la cantidad va de 1 a 1000 y evidencia null. Una sola captura asi:
  const r = evaluarTactica({ id: 4, como_se_mide: 'evidencia', mes: SEPT, numero: 'clientes_nuevos', valor: 40, base: 30, base_tipo: 'promedio_8',
    candado: null, candado_valor: null, candado_base: null,
    evidencia: { meta_clave: clave, requeridas: 31, capturas: [{ id: 1, meta_clave: clave, fecha: '2026-09-10', cantidad: 31, evidencia: null, anulada: null }] } });
  assert.equal(r.resultado, 'probada', 'una captura sin foto con cantidad 31 vale por 31 fotos');
});

// H3: el cierre corre aunque SICAR no haya mandado las ultimas ventas del mes, y el cierre no se recalcula nunca.
test('H3: con el agente SICAR atrasado el mes se cierra igual, con un valor distinto y congelado', t => {
  const completo = prepararCierre(t);
  plan(completo.DB, { tacticas: [1] });
  manual.cambiarTactica(completo.DB, 1, { numero_que_mueve: 'clientes_nuevos' }, 1);
  cerrarMesesPendientes(completo.sqlite, completo.DB, { hoy: GRACIA });

  const { sqlite, DB } = prepararCierre(t);
  plan(DB, { tacticas: [1] });
  manual.cambiarTactica(DB, 1, { numero_que_mueve: 'clientes_nuevos' }, 1);
  // El agente dejo de enviar el 26 de septiembre: ultima_recepcion vieja y faltan las ventas del 24 en adelante.
  sqlite.prepare("UPDATE sicar_tiendas SET ultima_recepcion = '2026-09-25T23:00:00Z' WHERE sucursal_id = 1").run();
  sqlite.prepare("DELETE FROM sicar_ventas WHERE fecha_local >= '2026-09-26'").run();
  sqlite.prepare("DELETE FROM sicar_ventas_mostrador WHERE fecha_local >= '2026-09-26'").run();
  const hechos = cerrarMesesPendientes(sqlite, DB, { hoy: GRACIA });
  assert.equal(hechos.length, 1, 'cierra aunque la ultima recepcion de SICAR sea anterior al fin del mes');
  assert.deepEqual([cierreDe(completo.DB)[0].valor, cierreDe(DB)[0].valor], [30, 27], '30 clientes nuevos por semana se vuelven 27 (-10 %)');
  assert.notEqual(cierreDe(DB)[0].valor, cierreDe(completo.DB)[0].valor, 'el valor del mes sale con datos incompletos');
  // Cuando el agente se pone al dia, el cierre no cambia: nunca se recalcula.
  assert.deepEqual(cerrarMesesPendientes(sqlite, DB, { hoy: sumar(GRACIA, 10) }), []);
});

// H4: el texto redondea a una decima y puede decir +5.0 % en una tactica que sale no_funciono.
test('H4: +4.96 % se escribe "+5.0 %" pero la tactica sale no_funciono', () => {
  const r = evaluarTactica({ id: 24, como_se_mide: 'sistema', mes: '2026-10', numero: 'ticket_promedio_centavos', valor: 10496, base: 10000,
    base_tipo: 'mismo_mes', candado: null, candado_valor: null, candado_base: null, evidencia: null });
  assert.equal(r.resultado, 'no_funciono');
  assert.equal(r.cambio_pct, 5);
  assert.match(r.texto, /\(\+5\.0 %\)/);
});

// H5: "Evidencia: x de y" (pantalla) suma cantidades; el texto del cierre cuenta capturas.
test('H5: pantalla dice 3 de 3 y el cierre dice 1 de 3 con la misma captura', () => {
  const DB = { pos: { metas_personalizadas: [{ id: 9, clave: 9, version: 1, prueba: 'ninguna', valor_meta: 4 }],
    meta_capturas: [{ id: 1, meta_clave: 9, fecha: '2026-09-10', cantidad: 3, anulada: null }] } };
  const planMes = { mes: SEPT, evidencias: [{ tactica_id: 4, meta_clave: 9 }] };
  assert.equal(avanceEvidencias(DB, planMes)[0].hechas, 3);
  const r = evaluarTactica({ id: 4, como_se_mide: 'evidencia', mes: SEPT, numero: 'clientes_nuevos', valor: 30, base: 30, base_tipo: 'promedio_8',
    candado: null, evidencia: { meta_clave: 9, requeridas: 4, capturas: DB.pos.meta_capturas } });
  assert.equal(r.texto, 'No se hizo: evidencia 1 de 4');
});
