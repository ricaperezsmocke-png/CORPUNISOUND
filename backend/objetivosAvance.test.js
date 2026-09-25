const { test } = require("node:test");
const assert = require("node:assert/strict");
const { porcentaje, avancePersona, avanceTienda, soloPorcentajes, avancePorPersona } = require("./objetivosAvance");

const TIENDA = { mes: "2026-09", sucursal_id: 1 };
const PERSONA = { ...TIENDA, vendedor_id: 1 };

function prepararDB() {
  return { pos: {
    objetivos: [], objetivo_capturas: [], objetivo_creditos: [], objetivo_actividades: [],
    objetivo_plantilla: [
      { id: 1, ...PERSONA, desde: "2026-09-01", hasta: "2026-09-10" },
      { id: 2, ...PERSONA, desde: "2026-09-20", hasta: null },
      { id: 3, ...TIENDA, vendedor_id: 2, desde: "2026-09-01", hasta: null },
      { id: 4, ...PERSONA, sucursal_id: 2, desde: "2026-09-11", hasta: "2026-09-19" },
      { id: 5, ...TIENDA, mes: "2026-08", vendedor_id: 9, desde: "2026-08-01", hasta: null },
    ],
    objetivo_marcas: [
      { id: 1, nombre: "Córdoba", activo: false },
      { id: 2, nombre: "Yamaha", activo: true },
      { id: 3, nombre: "Roland", activo: true },
      { id: 4, nombre: "Casio", activo: true },
    ],
    objetivo_productos: [
      { id: 1, nombre: "Guitarrón", activo: false },
      { id: 2, nombre: "Piano", activo: true },
      { id: 3, nombre: "Batería", activo: true },
      { id: 4, nombre: "Bajo", activo: true },
    ],
  } };
}

function meta(DB, datos = {}) {
  DB.pos.objetivos.push({ id: DB.pos.objetivos.length + 1, ...PERSONA, tipo: "venta", monto: 30, vigente: true, ...datos });
}

function captura(DB, datos = {}) {
  DB.pos.objetivo_capturas.push({
    id: DB.pos.objetivo_capturas.length + 1, ...PERSONA, fecha: "2026-09-01",
    tipo: "venta", monto: 0.1, vigente: true, corrige_a: null, ...datos,
  });
}

function credito(DB, datos = {}) {
  DB.pos.objetivo_creditos.push({
    id: DB.pos.objetivo_creditos.length + 1, ...PERSONA, fecha: "2026-09-01",
    financiera: "atrato", monto: 900, vigente: true, ...datos,
  });
}

function actividad(DB, datos = {}) {
  DB.pos.objetivo_actividades.push({
    id: DB.pos.objetivo_actividades.length + 1, ...PERSONA, fecha: "2026-09-01",
    actividad: "grupos", vigente: true, conjunta_con: null, registrado_en: "2026-09-01T18:00:00Z", ...datos,
  });
}

test("porcentaje usa centavos, trunca sin limitar a 100 y admite meta ausente o cero", () => {
  for (const [capturado, objetivo, esperado] of [
    [29.99, 30, 99], [30, 30, 100], [45, 30, 150], [0, 30, 0],
    [0.29, 0.29, 100], [0.1, 0.3, 33], [10, 0, null], [10, null, null], [10, undefined, null],
  ]) assert.equal(porcentaje(capturado, objetivo), esperado);
});

test("sin metas ni capturas devuelve ceros, sin serie y las cuatro actividades", () => {
  const esperado = {
    venta: { meta: 0, capturado: 0, porcentaje: null }, serie: [], marcas: [], productos: [], creditos: [],
    actividades: [
      { actividad: "grupos", etiqueta: "Publicación en grupos", meta: 0, declaradas: 0, porcentaje: null },
      { actividad: "marketplace", etiqueta: "Publicación en Marketplace", meta: 0, declaradas: 0, porcentaje: null },
      { actividad: "iglesia", etiqueta: "Salida a iglesia", meta: 0, declaradas: 0, porcentaje: null },
      { actividad: "volanteo", etiqueta: "Jornada de volanteo", meta: 0, declaradas: 0, porcentaje: null },
    ],
  };
  assert.deepEqual(avancePersona(prepararDB(), PERSONA), esperado);
  assert.deepEqual(avanceTienda(prepararDB(), TIENDA), esperado);
});

test("venta y serie excluyen correcciones anteriores, marcas, otra persona, mes y tienda", () => {
  const DB = prepararDB();
  meta(DB, { monto: 900, vigente: false });
  meta(DB, { monto: 1 });
  captura(DB, { monto: 70, vigente: false });
  captura(DB, { fecha: "2026-09-03", monto: 0.2 });
  captura(DB, { monto: 0.1, corrige_a: 1 });
  captura(DB, { tipo: "marca", marca_id: 1, monto: 0.1 });
  captura(DB, { vendedor_id: 2, monto: 80 });
  captura(DB, { sucursal_id: 2, fecha: "2026-09-15", monto: 90 });
  captura(DB, { mes: "2026-08", fecha: "2026-08-01", monto: 100 });
  const avance = avancePersona(DB, PERSONA);
  assert.deepEqual(avance.venta, { meta: 1, capturado: 0.3, porcentaje: 30 });
  assert.deepEqual(avance.serie, [{ fecha: "2026-09-01", monto: 0.1 }, { fecha: "2026-09-03", monto: 0.2 }]);
  assert.deepEqual(avancePersona(DB, { ...PERSONA, sucursal_id: 2 }).venta, { meta: 0, capturado: 90, porcentaje: null });
});

test("tienda usa su meta propia y suma incluso a quien salió de la plantilla en centavos exactos", () => {
  const DB = prepararDB();
  meta(DB, { monto: 500 });
  meta(DB, { vendedor_id: null, monto: 80, vigente: false });
  meta(DB, { vendedor_id: null, monto: 0.3 });
  captura(DB, { monto: 0.1 });
  captura(DB, { vendedor_id: 8, monto: 0.2 });
  captura(DB, { vendedor_id: 8, monto: 90, vigente: false });
  captura(DB, { sucursal_id: 2, monto: 50 });
  captura(DB, { mes: "2026-08", monto: 60 });
  captura(DB, { tipo: "marca", marca_id: 1, monto: 0.1 });
  captura(DB, { tipo: "producto", producto_meta_id: 1, monto: 1 });
  const avance = avanceTienda(DB, TIENDA);
  assert.deepEqual(avance.venta, { meta: 0.3, capturado: 0.3, porcentaje: 100 });
  assert.deepEqual(avance.serie, [{ fecha: "2026-09-01", monto: 0.3 }]);
});

for (const [tipo, lista, referencia, nombre, monto, total] of [
  ["marca", "marcas", "marca_id", "Córdoba", 0.1, 0.3],
  ["producto", "productos", "producto_meta_id", "Guitarrón", 1, 3],
]) {
  test(`${lista}: une metas vigentes y capturas propias, conserva inactivos y elementos en cero`, () => {
    const DB = prepararDB();
    meta(DB, { tipo, [referencia]: 1, monto: total });
    meta(DB, { tipo, [referencia]: 1, monto: 900, vigente: false });
    meta(DB, { tipo, [referencia]: 2, monto: 0 });
    meta(DB, { tipo, [referencia]: 4, monto: 10, vendedor_id: 2 });
    meta(DB, { tipo, [referencia]: 4, monto: 10, sucursal_id: 2 });
    meta(DB, { tipo, [referencia]: 4, monto: 10, mes: "2026-08" });
    captura(DB, { tipo, [referencia]: 1, monto });
    captura(DB, { tipo, [referencia]: 1, monto: monto * 2, fecha: "2026-09-02" });
    captura(DB, { tipo, [referencia]: 3, monto: 0 });
    captura(DB, { tipo, [referencia]: 4, monto: 10, vigente: false });
    const elementos = avancePersona(DB, PERSONA)[lista];
    assert.deepEqual(elementos, [
      { [referencia]: 1, nombre, meta: total, capturado: total, porcentaje: 100 },
      { [referencia]: 2, nombre: lista === "marcas" ? "Yamaha" : "Piano", meta: 0, capturado: 0, porcentaje: null },
      { [referencia]: 3, nombre: lista === "marcas" ? "Roland" : "Batería", meta: 0, capturado: 0, porcentaje: null },
    ]);
  });

  test(`${lista}: tienda usa metas de tienda y capturas de todas las personas, sin metas personales solas`, () => {
    const DB = prepararDB();
    meta(DB, { tipo, [referencia]: 1, vendedor_id: null, monto: total });
    meta(DB, { tipo, [referencia]: 2, monto: 10 });
    captura(DB, { tipo, [referencia]: 1, monto });
    captura(DB, { tipo, [referencia]: 1, vendedor_id: 8, monto: monto * 2 });
    captura(DB, { tipo, [referencia]: 3, vendedor_id: 8, monto: 0 });
    const elementos = avanceTienda(DB, TIENDA)[lista];
    assert.deepEqual(elementos, [
      { [referencia]: 1, nombre, meta: total, capturado: total, porcentaje: 100 },
      { [referencia]: 3, nombre: lista === "marcas" ? "Roland" : "Batería", meta: 0, capturado: 0, porcentaje: null },
    ]);
  });
}

test("créditos une metas y registros vigentes, cuenta créditos y no pesos, con alcance de persona o tienda", () => {
  const DB = prepararDB();
  meta(DB, { tipo: "credito", financiera: "coppel_pay", monto: 2 });
  meta(DB, { tipo: "credito", financiera: "atrato", vendedor_id: null, monto: 4 });
  credito(DB);
  credito(DB, { vendedor_id: 8 });
  credito(DB, { vigente: false });
  credito(DB, { sucursal_id: 2 });
  credito(DB, { mes: "2026-08" });
  assert.deepEqual(avancePersona(DB, PERSONA).creditos, [
    { financiera: "coppel_pay", etiqueta: "Coppel Pay", meta: 2, registrados: 0, porcentaje: 0 },
    { financiera: "atrato", etiqueta: "Atrato", meta: 0, registrados: 1, porcentaje: null },
  ]);
  assert.deepEqual(avanceTienda(DB, TIENDA).creditos, [
    { financiera: "atrato", etiqueta: "Atrato", meta: 4, registrados: 2, porcentaje: 50 },
  ]);
});

test("financiera con solo meta antigua o registros anulados no aparece; meta cero vigente sí", () => {
  const DB = prepararDB();
  meta(DB, { tipo: "credito", financiera: "atrato", vigente: false });
  credito(DB, { vigente: false });
  meta(DB, { tipo: "credito", financiera: "coppel_pay", monto: 0 });
  assert.deepEqual(avancePersona(DB, PERSONA).creditos, [
    { financiera: "coppel_pay", etiqueta: "Coppel Pay", meta: 0, registrados: 0, porcentaje: null },
  ]);
});

test("actividades conjuntas cuentan una por persona y solo una en tienda, excluyendo anuladas y otros alcances", () => {
  const DB = prepararDB();
  meta(DB, { tipo: "actividad", actividad: "grupos", monto: 2 });
  meta(DB, { tipo: "actividad", actividad: "grupos", monto: 4, vendedor_id: null });
  actividad(DB);
  actividad(DB, { vendedor_id: 2, conjunta_con: 1 });
  actividad(DB, { vigente: false });
  actividad(DB, { sucursal_id: 2 });
  actividad(DB, { mes: "2026-08" });
  assert.deepEqual(avancePersona(DB, PERSONA).actividades[0], {
    actividad: "grupos", etiqueta: "Publicación en grupos", meta: 2, declaradas: 1, porcentaje: 50,
  });
  assert.equal(avancePersona(DB, { ...PERSONA, vendedor_id: 2 }).actividades[0].declaradas, 1);
  assert.deepEqual(avanceTienda(DB, TIENDA).actividades[0], {
    actividad: "grupos", etiqueta: "Publicación en grupos", meta: 4, declaradas: 1, porcentaje: 25,
  });
});

test("avancePorPersona usa personas únicas de la plantilla de ese mes y tienda, sin serie", () => {
  const DB = prepararDB();
  meta(DB, { monto: 1 });
  captura(DB);
  captura(DB, { vendedor_id: 8, monto: 90 });
  const resultado = avancePorPersona(DB, TIENDA);
  assert.deepEqual(resultado.map((fila) => fila.vendedor_id), [1, 2]);
  assert.deepEqual(resultado[0].venta, { meta: 1, capturado: 0.1, porcentaje: 10 });
  assert.deepEqual(resultado[1].venta, { meta: 0, capturado: 0, porcentaje: null });
  for (const fila of resultado) {
    assert.equal(Object.hasOwn(fila, "serie"), false);
    assert.equal(fila.actividades.length, 4);
  }
});

test("soloPorcentajes selecciona únicamente referencias, etiquetas y porcentajes sin cifras anidadas", () => {
  const avance = {
    venta: { meta: 30, capturado: 29.99, porcentaje: 99 }, serie: [{ fecha: "2026-09-01", monto: 29.99 }],
    marcas: [{ marca_id: 1, nombre: "Córdoba", meta: 10, capturado: 15, porcentaje: 150 }],
    productos: [{ producto_meta_id: 1, nombre: "Guitarrón", meta: 0, capturado: 2, porcentaje: null }],
    creditos: [{ financiera: "atrato", etiqueta: "Atrato", meta: 2, registrados: 1, porcentaje: 50 }],
    actividades: [{ actividad: "grupos", etiqueta: "Publicación en grupos", meta: 3, declaradas: 1, porcentaje: 33 }],
  };
  const antes = structuredClone(avance);
  const resultado = soloPorcentajes(avance);
  assert.deepEqual(resultado, {
    venta: 99,
    marcas: [{ marca_id: 1, nombre: "Córdoba", porcentaje: 150 }],
    productos: [{ producto_meta_id: 1, nombre: "Guitarrón", porcentaje: null }],
    creditos: [{ financiera: "atrato", etiqueta: "Atrato", porcentaje: 50 }],
    actividades: [{ actividad: "grupos", etiqueta: "Publicación en grupos", porcentaje: 33 }],
  });
  function comprobarSinCifras(valor) {
    if (!valor || typeof valor !== "object") return;
    for (const [clave, contenido] of Object.entries(valor)) {
      assert.ok(!["meta", "capturado", "registrados", "declaradas", "serie", "monto"].includes(clave), clave);
      comprobarSinCifras(contenido);
    }
  }
  comprobarSinCifras(resultado);
  assert.deepEqual(avance, antes);
});

test("las consultas no mutan DB y los ids de texto producen el mismo alcance", () => {
  const DB = prepararDB();
  meta(DB);
  captura(DB);
  captura(DB, { tipo: "marca", marca_id: 1 });
  credito(DB);
  actividad(DB);
  const antes = structuredClone(DB);
  function congelar(valor) {
    if (!valor || typeof valor !== "object") return;
    Object.freeze(valor);
    Object.values(valor).forEach(congelar);
  }
  congelar(DB);
  assert.deepEqual(avancePersona(DB, { ...PERSONA, sucursal_id: "1", vendedor_id: "1" }), avancePersona(DB, PERSONA));
  assert.deepEqual(avanceTienda(DB, { ...TIENDA, sucursal_id: "1" }), avanceTienda(DB, TIENDA));
  assert.deepEqual(avancePorPersona(DB, { ...TIENDA, sucursal_id: "1" }), avancePorPersona(DB, TIENDA));
  soloPorcentajes(avanceTienda(DB, TIENDA));
  assert.deepEqual(DB, antes);
});

// Decisión de Victor 2026-09-25 (opción A): el % de tienda que ve la vendedora se calcula con lo
// que había al cierre de AYER, y no se muestra en metas de piezas, créditos o actividades de menos
// de 100 unidades (ahí cada unidad mueve el % entero y revela lo de la compañera).
const { porcentajesParaVendedora } = require("./objetivosAvance");
const AHORA = new Date("2026-09-24T18:00:00Z"); // mediodía del 24 en Chiapas; el corte es el 24 a las 00:00

test("el % de tienda de la vendedora ignora lo capturado hoy y las correcciones de hoy", () => {
  const DB = prepararDB();
  meta(DB, { vendedor_id: null, monto: 100 });
  meta(DB, { monto: 50 });
  captura(DB, { vendedor_id: 2, monto: 20, capturado_en: "2026-09-23T20:00:00Z" });
  captura(DB, { vendedor_id: 2, monto: 30, capturado_en: "2026-09-24T15:00:00Z", fecha: "2026-09-24" });
  // La vendedora corrige HOY su captura de ayer: para la tienda sigue contando la versión de ayer.
  captura(DB, { id: 10, monto: 10, capturado_en: "2026-09-23T21:00:00Z", vigente: false });
  captura(DB, { id: 11, monto: 60, capturado_en: "2026-09-24T16:00:00Z", corrige_a: 10 });
  const propio = avancePersona(DB, PERSONA);
  assert.equal(avanceTienda(DB, TIENDA).venta.porcentaje, 110, "sin corte la tienda ya cuenta lo de hoy");
  assert.equal(porcentajesParaVendedora(DB, TIENDA, propio, AHORA).venta, 30, "20 + 10 de ayer sobre 100");
});

test("créditos registrados hoy no cuentan y uno anulado hoy sigue contando para el % de ayer", () => {
  const DB = prepararDB();
  meta(DB, { vendedor_id: null, tipo: "credito", financiera: "atrato", monto: 200 });
  meta(DB, { tipo: "credito", financiera: "atrato", monto: 1 });
  for (let i = 0; i < 100; i++) credito(DB, { vendedor_id: 2, registrado_en: "2026-09-23T10:00:00Z" });
  credito(DB, { vendedor_id: 2, registrado_en: "2026-09-24T10:00:00Z" });
  credito(DB, { vendedor_id: 2, registrado_en: "2026-09-23T10:00:00Z", vigente: false, anulado_en: "2026-09-24T12:00:00Z" });
  const propio = avancePersona(DB, PERSONA);
  const atrato = porcentajesParaVendedora(DB, TIENDA, propio, AHORA).creditos.find((c) => c.financiera === "atrato");
  assert.equal(atrato.porcentaje, 50, "101 de ayer (el anulado hoy aún contaba) sobre 200 = 50");
});

test("metas de tienda de menos de 100 piezas, créditos o actividades no muestran % a la vendedora", () => {
  const DB = prepararDB();
  meta(DB, { vendedor_id: null, tipo: "credito", financiera: "atrato", monto: 3 });
  meta(DB, { tipo: "credito", financiera: "atrato", monto: 1 });
  meta(DB, { vendedor_id: null, tipo: "producto", producto_meta_id: 2, monto: 99 });
  meta(DB, { tipo: "producto", producto_meta_id: 2, monto: 5 });
  meta(DB, { vendedor_id: null, tipo: "actividad", actividad: "grupos", monto: 100 });
  meta(DB, { tipo: "actividad", actividad: "grupos", monto: 5 });
  credito(DB, { vendedor_id: 2, registrado_en: "2026-09-20T10:00:00Z" });
  credito(DB, { vendedor_id: 2, registrado_en: "2026-09-20T10:00:00Z" });
  const propio = avancePersona(DB, PERSONA);
  const pct = porcentajesParaVendedora(DB, TIENDA, propio, AHORA);
  assert.equal(pct.creditos.find((c) => c.financiera === "atrato").porcentaje, null);
  assert.equal(pct.productos.find((p) => p.producto_meta_id === 2).porcentaje, null);
  assert.equal(pct.actividades.find((a) => a.actividad === "grupos").porcentaje, 0, "con 100 o más sí se muestra");
});

test("la vendedora solo recibe el % de tienda de los elementos donde ella tiene meta o captura", () => {
  const DB = prepararDB();
  meta(DB, { vendedor_id: null, tipo: "marca", marca_id: 2, monto: 1000 });
  meta(DB, { tipo: "marca", marca_id: 2, monto: 500 });
  captura(DB, { vendedor_id: 2, tipo: "marca", marca_id: 3, monto: 40, capturado_en: "2026-09-20T10:00:00Z" });
  credito(DB, { vendedor_id: 2, financiera: "coppel_pay", registrado_en: "2026-09-20T10:00:00Z" });
  const propio = avancePersona(DB, PERSONA);
  const pct = porcentajesParaVendedora(DB, TIENDA, propio, AHORA);
  assert.deepEqual(pct.marcas.map((m) => m.marca_id), [2], "Roland la vendió la compañera; la vendedora no se entera");
  assert.deepEqual(pct.creditos, [], "tampoco de que alguien registró un Coppel Pay");
  assert.ok(pct.actividades.every((a) => a.porcentaje === null || a.porcentaje >= 0));
});

test("la foto de ayer usa las metas de ayer: cambiar hoy la meta de tienda no mueve el % de la vendedora", () => {
  const DB = prepararDB();
  meta(DB, { id: 1, vendedor_id: null, monto: 100, creado_en: "2026-09-20T10:00:00Z", vigente: false, reemplaza_a: null });
  meta(DB, { id: 2, vendedor_id: null, monto: 200, creado_en: "2026-09-24T15:00:00Z", reemplaza_a: 1 });
  meta(DB, { id: 3, monto: 50, creado_en: "2026-09-20T10:00:00Z", reemplaza_a: null });
  captura(DB, { vendedor_id: 2, monto: 50, capturado_en: "2026-09-23T10:00:00Z" });
  captura(DB, { monto: 1, capturado_en: "2026-09-23T10:00:00Z" });
  const propio = avancePersona(DB, PERSONA);
  assert.equal(porcentajesParaVendedora(DB, TIENDA, propio, AHORA).venta, 51, "51 de la meta de ayer (100), no de la de hoy (200)");
});

test("sin meta ni venta propia, la vendedora no recibe el % de venta de la tienda", () => {
  const DB = prepararDB();
  meta(DB, { vendedor_id: null, monto: 100 });
  captura(DB, { vendedor_id: 2, monto: 47, capturado_en: "2026-09-23T10:00:00Z" });
  assert.equal(porcentajesParaVendedora(DB, TIENDA, avancePersona(DB, PERSONA), AHORA).venta, null);
  const vacio = porcentajesParaVendedora(DB, TIENDA, null, AHORA);
  assert.equal(vacio.venta, null);
  for (const grupo of ["marcas", "productos", "creditos", "actividades"]) assert.deepEqual(vacio[grupo], []);
});
