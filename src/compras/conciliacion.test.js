import { test } from "node:test";
import assert from "node:assert/strict";
import {
  textoUnion, textoAutor, puedeConciliar, textoViejas, avisosRojos, motivoConciliacionValido, avisosOmitidas, cargarConciliacion,
  fechaDeCompra, puedeMarcarLlego, textoCerrada,
} from "./conciliacion.js";

test("unión muestra fecha, folio y centavos con formato de la app", () => {
  assert.equal(textoUnion({ folio: "A123", fecha: "2026-11-03T12:00:00", total_centavos: 1621800 }),
    "Llegó · compra SICAR A123 del 03/11/2026 · $16,218.00");
});

test("autor distingue unión automática y nombre confirmado por el servidor", () => {
  assert.equal(textoAutor({ modo: "automatica", actor: "sicar" }), "Unida sola");
  assert.equal(textoAutor({ modo: "manual", actor: "992", actor_nombre: "Ana" }), "Confirmada por Ana");
  assert.equal(textoAutor({ modo: "manual", actor_nombre: "Usuario #992" }), "Confirmada por Usuario #992");
});

test("botones de conciliación ocultos con permisos vecinos", () => {
  assert.equal(puedeConciliar(["ver_facturas_por_llegar", "registrar_facturas_por_llegar"]), false);
  assert.equal(puedeConciliar(undefined), false);
  assert.equal(puedeConciliar(["conciliar_facturas"]), true);
});

test("botón Ya llegó solo con conciliar_facturas; registrar no basta", () => {
  assert.equal(puedeMarcarLlego(["ver_facturas_por_llegar", "registrar_facturas_por_llegar"]), false);
  assert.equal(puedeMarcarLlego(undefined), false);
  assert.equal(puedeMarcarLlego(["ver_facturas_por_llegar", "conciliar_facturas"]), true);
});

test("compra cerrada sin factura dice quién la cerró y por qué", () => {
  const c = { folio: "A9", fecha: "2026-10-01T12:00:00", total_centavos: 1621800, actor_nombre: "Ana", motivo: "Mercancía de muestra" };
  assert.equal(textoCerrada(c), "Compra SICAR A9 del 01/10/2026 · $16,218.00 · cerrada por Ana: Mercancía de muestra");
  assert.equal(textoCerrada({ ...c, folio: "" }), "Compra SICAR — del 01/10/2026 · $16,218.00 · cerrada por Ana: Mercancía de muestra");
});

test("motivo de conciliación rechaza vacío y espacios sin imponer el límite de cancelar", () => {
  assert.equal(motivoConciliacionValido("   "), false);
  assert.equal(motivoConciliacionValido(undefined), false);
  assert.equal(motivoConciliacionValido("a"), true);
  assert.equal(motivoConciliacionValido("x".repeat(201)), true);
});

test("rojos conservan selección del servidor y ordenan más días primero sin mutar", () => {
  const resumen = {
    facturas_sin_compra_15: [{ id: 1, creada_en: "2026-10-15T12:00:00Z" }],
    compras_sin_factura_15: [{ com_id: "2", fecha: "2026-10-01T23:00:00" }],
    canceladas_despues: [{ id: 3 }],
    cambiaron: [{ id: 4, total_al_unir_centavos: 123456, total_centavos: 125000 }],
  };
  const copia = structuredClone(resumen);
  const avisos = avisosRojos(resumen, new Date("2026-11-04T05:30:00Z"));
  assert.deepEqual(avisos.map(a => a.texto), [
    "Compra de SICAR sin factura desde hace 33 días",
    "Factura sin compra en SICAR desde hace 19 días",
    "La compra se canceló en SICAR después de unida",
    "La compra cambió en SICAR después de unida: antes $1,234.56, ahora $1,250.00",
  ]);
  assert.deepEqual(resumen, copia);
  assert.deepEqual(avisosRojos(null), []);
});

test("compras históricas se muestran aparte sin rojo", () => {
  assert.equal(textoViejas(1399), "1399 compras anteriores sin factura (no se marcan en rojo)");
  assert.equal(textoViejas(0), "0 compras anteriores sin factura (no se marcan en rojo)");
  assert.equal(textoViejas(1), "1 compra anterior sin factura (no se marca en rojo)");
});

test("unión manual sin nombre del actor dice Confirmada manualmente, nunca undefined", () => {
  for (const actor_nombre of [undefined, null, "", "   "]) {
    assert.equal(textoAutor({ modo: "manual", actor: "992", actor_nombre }), "Confirmada manualmente");
  }
});

test("compras omitidas salen en rojo con el texto exacto", () => {
  const resumen = { compras_omitidas: [
    { sucursal_id: 6, com_id: "9", codigo: "ARTICULO_INVALIDO", ultima_vez: "2026-11-04T10:00:00Z" },
    { sucursal_id: 6, com_id: "41", codigo: "TEXTO_INVALIDO", ultima_vez: "2026-11-03T10:00:00Z" },
  ] };
  assert.deepEqual(avisosOmitidas(resumen), [
    { clave: "6:9", texto: "Compra de SICAR 9 no se pudo leer (ARTICULO_INVALIDO); revísala en SICAR de CEDIS." },
    { clave: "6:41", texto: "Compra de SICAR 41 no se pudo leer (TEXTO_INVALIDO); revísala en SICAR de CEDIS." },
  ]);
  assert.deepEqual(avisosOmitidas({}), []);
  assert.deepEqual(avisosOmitidas(null), []);
});

const respuesta = (ok, cuerpo) => ({ ok, json: async () => cuerpo });
test("si falla el resumen la lista de facturas se carga igual y el error queda en el resumen", async () => {
  const pedidas = [];
  const pedir = async ruta => {
    pedidas.push(ruta);
    return ruta.startsWith("/facturas-compras") ? respuesta(false, { error: "Sin permiso" }) : respuesta(true, { facturas: [{ id: 1 }] });
  };
  assert.deepEqual(await cargarConciliacion(pedir, "por_llegar"),
    { datos: { facturas: [{ id: 1 }] }, error: "", resumen: null, errorResumen: "Sin permiso" });
  assert.deepEqual(pedidas.sort(), ["/facturas-compras/resumen", "/facturas-por-llegar?estado=por_llegar"]);
  const caida = await cargarConciliacion(async ruta => {
    if (ruta.startsWith("/facturas-compras")) throw new Error("Red caída");
    return respuesta(true, { facturas: [] });
  }, "");
  assert.deepEqual(caida, { datos: { facturas: [] }, error: "", resumen: null, errorResumen: "Red caída" });
});

test("si falla la lista el resumen se conserva y cada uno trae su error", async () => {
  const resultado = await cargarConciliacion(async ruta => (ruta.startsWith("/facturas-compras")
    ? respuesta(true, { por_confirmar: [] }) : respuesta(false, {})), "llego");
  assert.deepEqual(resultado, { datos: null, error: "No se pudieron cargar las facturas.", resumen: { por_confirmar: [] }, errorResumen: "" });
  const resumenSinTexto = await cargarConciliacion(async ruta => (ruta.startsWith("/facturas-compras")
    ? respuesta(false, null) : respuesta(true, { facturas: [] })), "");
  assert.equal(resumenSinTexto.errorResumen, "No se pudo cargar la conciliación con compras de SICAR.");
});

test("detalle de compra usa la fecha de la compra en SICAR, no la de la unión", () => {
  assert.equal(fechaDeCompra({ fecha: "2026-11-03T18:00:00Z", fecha_compra: "2026-10-01T12:00:00" }), "2026-10-01T12:00:00");
  assert.equal(fechaDeCompra({ fecha: "2026-10-05T12:00:00" }), "2026-10-05T12:00:00");
});
