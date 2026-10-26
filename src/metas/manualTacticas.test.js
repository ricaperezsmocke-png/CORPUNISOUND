import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparPorCamino, textoEtiqueta, textoProbadaEn, cuerpoAlta, cuerpoCambio, formularioDeTactica, formularioVacio,
  errorDelFormulario, entradaHistorial, nombreNumero, textoMes,
} from "./manualTacticas.js";

const T = (id, camino, extra = {}) => ({ id, camino, nombre: `T${id}`, descripcion: "", numero_que_mueve: "recompra_90", candado: null,
  quien: ["cajera", "gerente"], como_se_mide: "sistema", referencia_pdf: "", activa: true, ...extra });

test("agrupa por camino en el orden fijo y no muestra caminos vacíos", () => {
  const g = agruparPorCamino([T(1, "margen"), T(2, "calidad_dato"), T(3, "margen")]);
  assert.deepEqual(g.map((x) => x.camino), ["calidad_dato", "margen"]);
  assert.deepEqual(g[1].tacticas.map((t) => t.id), [1, 3]);
});

test("las retiradas se ocultan por defecto y el filtro de camino funciona", () => {
  const lista = [T(1, "margen"), T(2, "margen", { activa: false }), T(3, "prospectos")];
  assert.equal(agruparPorCamino(lista).flatMap((g) => g.tacticas).length, 2);
  assert.equal(agruparPorCamino(lista, { retiradas: true }).flatMap((g) => g.tacticas).length, 3);
  assert.deepEqual(agruparPorCamino(lista, { camino: "prospectos" }).map((g) => g.camino), ["prospectos"]);
  assert.deepEqual(agruparPorCamino(null), []);
});

test("texto de la etiqueta de la tienda", () => {
  assert.equal(textoEtiqueta({ estado: "por_probar" }), "Por probar");
  assert.equal(textoEtiqueta(undefined), "Por probar");
  assert.equal(textoEtiqueta({ estado: "probada", mes: "2026-09", resultado: "subió 3 puntos" }), "Probada (septiembre 2026, subió 3 puntos)");
  assert.equal(textoEtiqueta({ estado: "probada", mes: null, resultado: null }), "Probada");
  assert.equal(textoEtiqueta({ estado: "no_funciono", mes: "2026-10" }), "No funcionó (octubre 2026)");
  assert.equal(textoEtiqueta({ estado: "sin_dato" }), "Sin dato");
  assert.equal(textoMes("raro"), "raro");
});

test("probada en N tiendas", () => {
  assert.equal(textoProbadaEn(0), "Probada en 0 tiendas");
  assert.equal(textoProbadaEn(1), "Probada en 1 tienda");
  assert.equal(textoProbadaEn(4), "Probada en 4 tiendas");
});

test("nombres legibles de los números son los del tablero", () => {
  assert.equal(nombreNumero("pct_con_cliente"), "Tickets con cliente");
  assert.equal(nombreNumero("margen"), "Margen (fase 3)");
});

test("el PUT lleva solo lo que cambió y nunca etiquetas", () => {
  const t = { ...T(1, "margen"), etiquetas: { 1: { estado: "probada" } }, etiqueta_tienda: { estado: "probada" } };
  const f = formularioDeTactica(t);
  assert.deepEqual(cuerpoCambio(t, f), {});
  f.nombre = " Nombre nuevo ";
  f.quien = ["gerente", "cajera"];
  assert.deepEqual(cuerpoCambio(t, f), { nombre: "Nombre nuevo" });
  f.quien = ["gerente", "compras"];
  f.candado = "margen";
  const c = cuerpoCambio(t, f);
  assert.deepEqual(Object.keys(c).sort(), ["candado", "nombre", "quien"]);
  assert.equal("etiquetas" in c, false);
  f.candado = "";
  assert.equal(cuerpoCambio(t, f).candado, undefined);
});

test("el alta arma solo campos permitidos y candado vacío es null", () => {
  const f = { ...formularioVacio(), nombre: "Táctica nueva" };
  const c = cuerpoAlta(f);
  assert.equal(c.candado, null);
  assert.deepEqual(Object.keys(c).sort(),
    ["camino", "candado", "como_se_mide", "descripcion", "nombre", "numero_que_mueve", "quien", "referencia_pdf"]);
});

test("validación de pantalla", () => {
  const f = { ...formularioVacio(), nombre: "ab" };
  assert.match(errorDelFormulario(f), /nombre/);
  f.nombre = "Nombre ok";
  assert.equal(errorDelFormulario(f), "");
  assert.match(errorDelFormulario({ ...f, quien: [] }), /responsable/);
  assert.match(errorDelFormulario({ ...f, candado: f.numero_que_mueve }), /candado/);
});

test("entrada del historial: quién, cuándo y qué cambió; sin nombre cae a Usuario #N", () => {
  const h = { fecha_hora: "2026-10-26T10:00:00Z", usuario_id: 7, accion: "cambio", antes: { camino: "margen" }, despues: { camino: "prospectos" } };
  const e = entradaHistorial(h);
  assert.equal(e.quien, "Usuario #7");
  assert.equal(e.accion, "Cambio");
  assert.deepEqual(e.cambios, ["Camino: Margen → Prospectos"]);
  assert.equal(entradaHistorial(h, () => "Ana").quien, "Ana");
  const sis = { ...h, usuario_id: null, accion: "etiqueta", despues: { sucursal_id: 2, etiqueta: { estado: "sin_dato" } } };
  assert.equal(entradaHistorial(sis).quien, "El sistema");
});
