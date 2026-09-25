const { test } = require("node:test");
const assert = require("node:assert");
const { fijarObjetivo, objetivoVigente, historialObjetivo } = require("./objetivos");

function prepararDB() {
  return {
    pos: {
      vendedores: [
        { id: 1, nombre: "Juan", sucursal_id: 1, activo: true },
        { id: 2, nombre: "Maria", sucursal_id: 1, activo: true },
        { id: 9, nombre: "Otro", sucursal_id: 2, activo: true },
      ],
      objetivos: [], objetivo_capturas: [], objetivo_cierres: [], objetivo_plantilla: [],
    },
  };
}
const VICTOR = { id: 1, nombre: "Victor" };

test("el catálogo consulta las cuatro clases de actividad y devuelve null para una desconocida", () => {
  const { CLASES_ACTIVIDAD, claseActividad } = require("./objetivosActividadesCatalogo");
  const esperadas = [
    { clave: "grupos", etiqueta: "Publicación en grupos", evidencia: "link", unidad: "publicación" },
    { clave: "marketplace", etiqueta: "Publicación en Marketplace", evidencia: "link", unidad: "publicación" },
    { clave: "iglesia", etiqueta: "Salida a iglesia", evidencia: "foto", unidad: "salida" },
    { clave: "volanteo", etiqueta: "Jornada de volanteo", evidencia: "foto", unidad: "jornada" },
  ];
  assert.deepStrictEqual(CLASES_ACTIVIDAD, esperadas);
  for (const clase of esperadas) assert.deepStrictEqual(claseActividad(clase.clave), clase);
  for (const clave of ["tiktok", "", null, undefined]) assert.strictEqual(claseActividad(clave), null);
});

test("la meta de iglesia de tienda guarda su clase y empieza en versión 1", () => {
  const DB = prepararDB();
  const datos = { tipo: "actividad", actividad: "iglesia", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 3 };
  const meta = fijarObjetivo(DB, datos, VICTOR);
  assert.strictEqual(meta.actividad, "iglesia");
  assert.strictEqual(meta.monto, 3);
  assert.strictEqual(meta.version, 1);
  assert.strictEqual(meta.vigente, true);
  assert.strictEqual(objetivoVigente(DB, datos), meta);
});

test("iglesia, grupos y venta conservan vigencias e historiales independientes", () => {
  const DB = prepararDB();
  const base = { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 };
  const venta = fijarObjetivo(DB, { ...base, tipo: "venta", monto: 80000 }, VICTOR);
  const iglesia = { ...base, tipo: "actividad", actividad: "iglesia" };
  const grupos = { ...base, tipo: "actividad", actividad: "grupos" };
  const primera = fijarObjetivo(DB, { ...iglesia, monto: 3 }, VICTOR);
  const otra = fijarObjetivo(DB, { ...grupos, monto: 20 }, VICTOR);
  assert.strictEqual(primera.vigente, true);
  assert.strictEqual(otra.version, 1);
  const segunda = fijarObjetivo(DB, { ...iglesia, monto: 4, motivo: "Otra salida" }, VICTOR);
  assert.strictEqual(primera.vigente, false);
  assert.strictEqual(segunda.version, 2);
  assert.strictEqual(segunda.reemplaza_a, primera.id);
  assert.strictEqual(segunda.motivo, "Otra salida");
  assert.strictEqual(otra.vigente, true);
  assert.strictEqual(venta.vigente, true);
  assert.strictEqual(objetivoVigente(DB, iglesia), segunda);
  assert.strictEqual(objetivoVigente(DB, grupos), otra);
  assert.strictEqual(objetivoVigente(DB, { ...base, tipo: "venta" }), venta);
  assert.deepStrictEqual(historialObjetivo(DB, iglesia).map((o) => o.monto), [3, 4]);
  assert.deepStrictEqual(historialObjetivo(DB, grupos).map((o) => o.monto), [20]);
  assert.deepStrictEqual(historialObjetivo(DB, { ...base, tipo: "venta" }).map((o) => o.monto), [80000]);
});

for (const actividad of [undefined, null, "tiktok"]) {
  test(`se rechaza la clase de actividad inválida ${actividad} sin modificar metas`, () => {
    const DB = prepararDB();
    const base = { mes: "2026-09", sucursal_id: 1, vendedor_id: null };
    fijarObjetivo(DB, { ...base, tipo: "venta", monto: 100 }, VICTOR);
    const antes = structuredClone(DB.pos);
    assert.throws(() => fijarObjetivo(DB, { ...base, tipo: "actividad", actividad, monto: 3 }, VICTOR), /actividad/i);
    assert.deepStrictEqual(DB.pos, antes);
  });
}

test("las metas de actividad rechazan fracciones sin modificar la base", () => {
  const DB = prepararDB();
  const antes = structuredClone(DB.pos);
  assert.throws(() => fijarObjetivo(DB, {
    tipo: "actividad", actividad: "iglesia", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 2.5,
  }, VICTOR), /entero/i);
  assert.deepStrictEqual(DB.pos, antes);
});

test("las metas de actividad aceptan cero y rechazan montos negativos o no numéricos", () => {
  const DB = prepararDB();
  const datos = { tipo: "actividad", actividad: "marketplace", mes: "2026-09", sucursal_id: 1, vendedor_id: null };
  const meta = fijarObjetivo(DB, { ...datos, monto: 0 }, VICTOR);
  assert.strictEqual(meta.monto, 0);
  const antes = structuredClone(DB.pos);
  for (const monto of [-1, NaN, Infinity, "3", null, undefined]) {
    assert.throws(() => fijarObjetivo(DB, { ...datos, monto }, VICTOR), /monto|número|entero/i);
    assert.deepStrictEqual(DB.pos, antes);
  }
});

test("venta rechaza una clase de actividad y no reemplaza la meta vigente", () => {
  const DB = prepararDB();
  const datos = { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 100 };
  fijarObjetivo(DB, datos, VICTOR);
  const antes = structuredClone(DB.pos);
  assert.throws(() => fijarObjetivo(DB, { ...datos, actividad: "iglesia" }, VICTOR), /actividad/i);
  assert.deepStrictEqual(DB.pos, antes);
});

test("un tipo desconocido se rechaza sin guardar nada", () => {
  const DB = prepararDB();
  assert.throws(() => fijarObjetivo(DB, {
    tipo: "otro", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 3,
  }, VICTOR), /tipo/i);
  assert.deepStrictEqual(DB.pos.objetivos, []);
});

test("una venta histórica sin actividad sigue vigente y se versiona con actividad null", () => {
  const DB = prepararDB();
  const datos = { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null };
  const historica = {
    id: 1, ...datos, monto: 100, version: 1, vigente: true, creado_por: "Victor",
    creado_en: "2026-09-01T12:00:00.000Z", reemplaza_a: null, motivo: null,
  };
  DB.pos.objetivos.push(historica);
  assert.strictEqual(objetivoVigente(DB, datos), historica);
  assert.strictEqual(objetivoVigente(DB, { ...datos, actividad: null }), historica);
  const nueva = fijarObjetivo(DB, { ...datos, actividad: null, monto: 100.5, motivo: "Ajuste" }, VICTOR);
  assert.strictEqual(nueva.actividad, null);
  assert.strictEqual(nueva.monto, 100.5);
  assert.strictEqual(nueva.version, 2);
  assert.strictEqual(nueva.reemplaza_a, historica.id);
  assert.strictEqual(historica.vigente, false);
  assert.deepStrictEqual(historialObjetivo(DB, datos).map((o) => o.monto), [100, 100.5]);
  const sinCampo = fijarObjetivo(DB, { ...datos, monto: 200 }, VICTOR);
  assert.strictEqual(sinCampo.actividad, null);
  assert.strictEqual(sinCampo.version, 3);
});

test("el reparto de volanteo conserva diez jornadas entre tres personas como 3, 3 y 4", () => {
  const DB = prepararDB();
  const base = { mes: "2026-09", sucursal_id: 1 };
  DB.pos.vendedores.push({ id: 3, nombre: "Ana", sucursal_id: 1, activo: true });
  for (const vendedor_id of [1, 2, 3]) registrarEnPlantilla(DB, { ...base, vendedor_id });
  fijarObjetivo(DB, { ...base, tipo: "venta", vendedor_id: null, monto: 300 }, VICTOR);
  const datos = { ...base, tipo: "actividad", actividad: "volanteo" };
  fijarObjetivo(DB, { ...datos, vendedor_id: null, monto: 10 }, VICTOR);
  const reparto = repartoSugerido(DB, datos);
  assert.deepStrictEqual(reparto, [
    { vendedor_id: 1, monto: 3 }, { vendedor_id: 2, monto: 3 }, { vendedor_id: 3, monto: 4 },
  ]);
  assert.strictEqual(reparto.reduce((total, linea) => total + linea.monto, 0), 10);
  assert.deepStrictEqual(repartoSugerido(DB, base).map((linea) => linea.monto), [100, 100, 100]);
});

test("el estado de grupos muestra cuatro sin asignar y sin tipo sigue consultando venta", () => {
  const DB = prepararDB();
  const base = { mes: "2026-09", sucursal_id: 1 };
  for (const vendedor_id of [1, 2]) registrarEnPlantilla(DB, { ...base, vendedor_id });
  for (const datos of [
    { tipo: "actividad", actividad: "iglesia", montos: [3, 1, 1] },
    { tipo: "actividad", actividad: "grupos", montos: [20, 8, 8] },
    { tipo: "venta", montos: [300, 100, 100] },
  ]) {
    for (const [indice, vendedor_id] of [null, 1, 2].entries()) {
      fijarObjetivo(DB, { ...base, tipo: datos.tipo, actividad: datos.actividad, vendedor_id, monto: datos.montos[indice] }, VICTOR);
    }
  }
  assert.deepStrictEqual(estadoDelReparto(DB, { ...base, tipo: "actividad", actividad: "grupos" }), {
    meta_tienda: 20, asignado: 16, sin_asignar: 4,
    lineas: [{ vendedor_id: 1, monto: 8 }, { vendedor_id: 2, monto: 8 }],
  });
  assert.deepStrictEqual(estadoDelReparto(DB, base), {
    meta_tienda: 300, asignado: 200, sin_asignar: 100,
    lineas: [{ vendedor_id: 1, monto: 100 }, { vendedor_id: 2, monto: 100 }],
  });
});

test("fijar un objetivo lo deja vigente, con quien y cuando", () => {
  const DB = prepararDB();
  const o = fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  assert.equal(o.monto, 80000);
  assert.equal(o.vigente, true);
  assert.equal(o.version, 1);
  assert.equal(o.creado_por, "Victor");
  assert.ok(o.creado_en, "sin fecha no se sabe si la meta se movio el dia 28");
});

test("cambiar la meta NO borra la anterior: crea una version nueva", () => {
  const DB = prepararDB();
  const primera = fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  const segunda = fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 50000, motivo: "bajo ventas" }, VICTOR);
  assert.equal(segunda.version, 2);
  assert.equal(segunda.reemplaza_a, primera.id);
  assert.equal(segunda.motivo, "bajo ventas");
  assert.equal(DB.pos.objetivos.length, 2, "la version vieja sigue en la base");
  assert.equal(DB.pos.objetivos.find((x) => x.id === primera.id).vigente, false);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1 }).monto, 50000);
});

test("el historial deja ver que la meta se bajo, y quien", () => {
  const DB = prepararDB();
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 50000 }, { nombre: "Gerente" });
  const h = historialObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((x) => x.monto), [80000, 50000]);
  assert.equal(h[1].creado_por, "Gerente");
});

test("meses distintos no se pisan", () => {
  const DB = prepararDB();
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-10", sucursal_id: 1, vendedor_id: 1, monto: 90000 }, VICTOR);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1 }).monto, 80000);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-10", sucursal_id: 1, vendedor_id: 1 }).monto, 90000);
});

test("meta de TIENDA: vendedor_id null es una meta valida y distinta", () => {
  const DB = prepararDB();
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 300000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null }).monto, 300000);
  assert.equal(objetivoVigente(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1 }).monto, 80000);
});

test("se rechaza lo que no es un numero valido, sin escribir nada", () => {
  for (const malo of [-1, NaN, "abc", null, Infinity, undefined]) {
    const DB = prepararDB();
    assert.throws(
      () => fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: malo }, VICTOR),
      /monto|número|numero/i,
      `dejo pasar ${JSON.stringify(malo)}`
    );
    assert.equal(DB.pos.objetivos.length, 0, "no debe quedar nada escrito");
  }
});

test("el mes tiene que venir con formato AAAA-MM", () => {
  const DB = prepararDB();
  for (const malo of ["2026-9", "septiembre", "", null, "2026-13"]) {
    assert.throws(() => fijarObjetivo(DB, { tipo: "venta", mes: malo, sucursal_id: 1, vendedor_id: 1, monto: 1 }, VICTOR), /mes/i);
  }
  assert.equal(DB.pos.objetivos.length, 0);
});

test("un vendedor de otra sucursal no puede llevar meta de esta tienda", () => {
  const DB = prepararDB();
  assert.throws(
    () => fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 9, monto: 1000 }, VICTOR),
    /sucursal|tienda/i
  );
  assert.equal(DB.pos.objetivos.length, 0);
});

const { registrarEnPlantilla, plantillaDelMes, registroDelDia, tienePlantillaEnMes } = require("./objetivos");

test("quien estuvo el mes aparece aunque hoy este inactivo", () => {
  const DB = prepararDB();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 2 });
  DB.pos.vendedores.find((v) => v.id === 2).activo = false;   // Maria se fue
  const p = plantillaDelMes(DB, "2026-09", 1);
  assert.equal(p.length, 2, "Maria trabajo ese mes: no puede desaparecer del cierre");
  assert.ok(p.some((x) => x.vendedor_id === 2));
});

test("quien entro a mitad de mes queda con su fecha", () => {
  const DB = prepararDB();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1, desde: "2026-09-16", motivo: "alta" });
  const p = plantillaDelMes(DB, "2026-09", 1);
  assert.equal(p[0].desde, "2026-09-16");
  assert.equal(p[0].motivo, "alta");
});

test("la plantilla no mezcla tiendas ni meses", () => {
  const DB = prepararDB();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 9 });
  registrarEnPlantilla(DB, { mes: "2026-10", sucursal_id: 1, vendedor_id: 2 });
  assert.equal(plantillaDelMes(DB, "2026-09", 1).length, 1);
  assert.equal(plantillaDelMes(DB, "2026-10", 1).length, 1);
});

test("la misma persona no se registra dos veces en el mismo mes y tienda", () => {
  const DB = prepararDB();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  assert.throws(() => registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 }), /ya (esta|está)/i);
  assert.equal(DB.pos.objetivo_plantilla.length, 1);
});

const { repartoSugerido, estadoDelReparto } = require("./objetivos");

const { darDeBajaEnPlantilla } = require("./objetivos");

test("dar de baja conserva el registro y guarda fecha, motivo y auditoria", () => {
  const DB = prepararDB();
  const linea = registrarEnPlantilla(DB, {
    mes: "2026-09", sucursal_id: 1, vendedor_id: 1, desde: "2026-09-10", motivo: "Entra a cubrir vacaciones",
  });
  const baja = darDeBajaEnPlantilla(
    DB,
    linea.id,
    { hasta: "2026-09-20", motivo: "  Cambio de tienda  " },
    VICTOR
  );

  assert.equal(baja, linea);
  assert.equal(linea.hasta, "2026-09-20");
  // La baja no sobrescribe el motivo del alta: los dos quedan.
  assert.equal(linea.motivo, "Entra a cubrir vacaciones");
  assert.equal(linea.motivo_baja, "Cambio de tienda");
  assert.equal(linea.baja_por, "Victor");
  assert.ok(linea.baja_en);
  assert.equal(DB.pos.objetivo_plantilla.length, 1);
});

test("dar de baja valida todo antes de modificar el registro", () => {
  for (const datos of [
    { hasta: "2026-08-31", motivo: "Antes del mes" },
    { hasta: "2026-09-09", motivo: "Antes del alta" },
    { hasta: "2026-09-31", motivo: "Fecha inexistente" },
    { hasta: "2026-10-01", motivo: "Otro mes" },
    { hasta: "2026-09-20", motivo: "   " },
    { hasta: "2026-09-20", motivo: 123 },
  ]) {
    const DB = prepararDB();
    const linea = registrarEnPlantilla(DB, {
      mes: "2026-09", sucursal_id: 1, vendedor_id: 1, desde: "2026-09-10",
    });
    const antes = structuredClone(linea);
    assert.throws(() => darDeBajaEnPlantilla(DB, linea.id, datos, VICTOR));
    assert.deepEqual(linea, antes);
  }
});

test("no se puede dar de baja dos veces ni dar de baja un registro inexistente", () => {
  const DB = prepararDB();
  const linea = registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  darDeBajaEnPlantilla(DB, linea.id, { hasta: "2026-09-20", motivo: "Salida" }, VICTOR);
  const antes = structuredClone(DB.pos);

  assert.throws(
    () => darDeBajaEnPlantilla(DB, linea.id, { hasta: "2026-09-21", motivo: "Otra" }, VICTOR),
    /baja|hasta/i
  );
  assert.throws(
    () => darDeBajaEnPlantilla(DB, 999, { hasta: "2026-09-20", motivo: "Salida" }, VICTOR),
    /existe|encontr/i
  );
  assert.deepEqual(DB.pos, antes);
});

test("un traslado no deja a la persona en dos plantillas el mismo dia", () => {
  // Si se solapan, el dia compartido sale "sin capturar" en una tienda y no se
  // puede llenar: la captura ya existe en la otra. Un faltante inventado.
  const DB = prepararDB();
  const origen = registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  DB.pos.vendedores.find((v) => v.id === 1).sucursal_id = 2;
  const antes = structuredClone(DB.pos.objetivo_plantilla);

  // Sin baja en la tienda de origen: rechazado.
  assert.throws(
    () => registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 1, desde: "2026-09-16" }),
    /otra tienda/
  );
  darDeBajaEnPlantilla(DB, origen.id, { hasta: "2026-09-15", motivo: "Traslado" }, VICTOR);
  // "Desde" vacío = día 1: se encima con los días 1 a 15 de la otra tienda.
  assert.throws(
    () => registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 1 }),
    /otra tienda/
  );
  // El mismo día de la baja tampoco.
  assert.throws(
    () => registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 1, desde: "2026-09-15" }),
    /otra tienda/
  );
  assert.deepEqual(DB.pos.objetivo_plantilla.filter((l) => l.sucursal_id === 2), []);
  assert.equal(antes.length, 1);

  const destino = registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 1, desde: "2026-09-16" });
  assert.equal(destino.desde, "2026-09-16");
});

test("la plantilla solo acepta fechas validas dentro de su mes", () => {
  const DB = prepararDB();
  for (const datos of [
    { desde: "2026-10-05" },
    { desde: "2026-09-31" },
    { desde: "16/09/2026" },
    { desde: "2026-09-10", hasta: "2026-09-05" },
    { hasta: "2026-10-01" },
  ]) {
    assert.throws(() => registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1, ...datos }));
  }
  assert.equal(DB.pos.objetivo_plantilla.length, 0);
});

test("dar de baja no toca metas ni capturas", () => {
  const DB = prepararDB();
  const linea = registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  fijarObjetivo(DB, {
    tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 500,
  }, VICTOR);
  DB.pos.objetivo_capturas.push({ id: 1, vendedor_id: 1, monto: 100, vigente: true });
  const objetivos = structuredClone(DB.pos.objetivos);
  const capturas = structuredClone(DB.pos.objetivo_capturas);

  darDeBajaEnPlantilla(DB, linea.id, { hasta: "2026-09-20", motivo: "Salida" }, VICTOR);

  assert.deepEqual(DB.pos.objetivos, objetivos);
  assert.deepEqual(DB.pos.objetivo_capturas, capturas);
});

test("el reparto sugerido divide en partes iguales entre los que estan", () => {
  const DB = prepararDB();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 2 });
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 300000 }, VICTOR);
  const r = repartoSugerido(DB, { mes: "2026-09", sucursal_id: 1 });
  assert.equal(r.length, 2);
  assert.equal(r[0].monto + r[1].monto, 300000, "el reparto sugerido tiene que sumar la meta exacta");
});

test("LO QUE FALTA POR REPARTIR SE VE: no desaparece", () => {
  const DB = prepararDB();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 2 });
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 300000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 100000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 2, monto: 100000 }, VICTOR);
  const e = estadoDelReparto(DB, { mes: "2026-09", sucursal_id: 1 });
  assert.equal(e.meta_tienda, 300000);
  assert.equal(e.asignado, 200000);
  assert.equal(e.sin_asignar, 100000, "los $100,000 que faltan tienen que verse, no esfumarse");
});

test("EL CASO DE CODEX: bajar las metas al final del mes deja el hueco a la vista", () => {
  const DB = prepararDB();
  for (const id of [1, 2]) registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: id });
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 160000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 80000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 2, monto: 80000 }, VICTOR);
  assert.equal(estadoDelReparto(DB, { mes: "2026-09", sucursal_id: 1 }).sin_asignar, 0);

  // el dia 28 alguien baja las dos metas
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 50000, motivo: "ajuste" }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 2, monto: 50000, motivo: "ajuste" }, VICTOR);

  const e = estadoDelReparto(DB, { mes: "2026-09", sucursal_id: 1 });
  assert.equal(e.meta_tienda, 160000, "la meta de tienda NO baja porque se bajen las individuales");
  assert.equal(e.sin_asignar, 60000, "los $60,000 rebajados tienen que aparecer sin asignar");
});

test("sobre-repartir tambien se ve: sin_asignar queda en negativo", () => {
  const DB = prepararDB();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: null, monto: 100000 }, VICTOR);
  fijarObjetivo(DB, { tipo: "venta", mes: "2026-09", sucursal_id: 1, vendedor_id: 1, monto: 150000 }, VICTOR);
  assert.equal(estadoDelReparto(DB, { mes: "2026-09", sucursal_id: 1 }).sin_asignar, -50000);
});

test("sin meta de tienda, el estado lo dice en vez de reventar", () => {
  const DB = prepararDB();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  const e = estadoDelReparto(DB, { mes: "2026-09", sucursal_id: 1 });
  assert.equal(e.meta_tienda, 0);
  assert.equal(e.asignado, 0);
});

test("un traslado permite reingresar a la misma tienda sin duplicar el reparto", () => {
  const DB = prepararDB();
  const ana = DB.pos.vendedores.find((v) => v.id === 1);
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1, desde: "2026-09-01", hasta: "2026-09-10" });
  ana.sucursal_id = 2;
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 1, desde: "2026-09-11", hasta: "2026-09-19" });
  ana.sucursal_id = 1;
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1, desde: "2026-09-20" });
  assert.equal(registroDelDia(DB, { mes: "2026-09", vendedor_id: 1, fecha: "2026-09-15" }).sucursal_id, 2);
  assert.equal(tienePlantillaEnMes(DB, "2026-09", 1), true);
  assert.equal(estadoDelReparto(DB, { mes: "2026-09", sucursal_id: 1 }).lineas.length, 1);
});

test("un alta solapada en la misma tienda se rechaza sin escribir", () => {
  const DB = prepararDB();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1 });
  const antes = structuredClone(DB.pos.objetivo_plantilla);
  assert.throws(
    () => registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1, desde: "2026-09-20" }),
    /plantilla de esta tienda en esas fechas/i
  );
  assert.deepEqual(DB.pos.objetivo_plantilla, antes);
});

const { altaElemento, desactivarElemento } = require("./objetivosCatalogos");
const METAS_NUEVAS = [
  { tipo: "marca", campo: "marca_id", referencias: [1, 2], monto: 10.5 },
  { tipo: "producto", campo: "producto_meta_id", referencias: [1, 2], monto: 10 },
  { tipo: "credito", campo: "financiera", referencias: ["coppel_pay", "atrato"], monto: 10 },
];
const PERIODO_META = { mes: "2026-09", sucursal_id: 1, vendedor_id: null };

function prepararDBConCatalogos() {
  const DB = prepararDB();
  for (const nombre of ["Yamaha", "Casio"]) altaElemento(DB, "marcas", { nombre }, VICTOR);
  for (const nombre of ["Teclados", "Guitarras eléctricas"]) altaElemento(DB, "productos", { nombre }, VICTOR);
  return DB;
}

for (const { tipo, campo, referencias, monto } of METAS_NUEVAS) {
  test(`la meta de ${tipo} guarda su referencia, unidad y auditoría normalizando ids de texto`, () => {
    const DB = prepararDBConCatalogos();
    const datos = { ...PERIODO_META, tipo, [campo]: String(referencias[0]), sucursal_id: "1", vendedor_id: "1", monto };
    const meta = fijarObjetivo(DB, datos, VICTOR);
    assert.strictEqual(meta.tipo, tipo);
    assert.strictEqual(meta[campo], referencias[0]);
    assert.strictEqual(meta.sucursal_id, 1);
    assert.strictEqual(meta.vendedor_id, 1);
    assert.strictEqual(meta.monto, monto);
    assert.strictEqual(meta.version, 1);
    assert.strictEqual(meta.vigente, true);
    assert.strictEqual(meta.creado_por, "Victor");
    assert.ok(meta.creado_en);
    assert.strictEqual(objetivoVigente(DB, datos), meta);
    assert.deepStrictEqual(historialObjetivo(DB, datos), [meta]);
    for (const otroCampo of ["actividad", "marca_id", "producto_meta_id", "financiera"].filter((c) => c !== campo)) {
      assert.strictEqual(meta[otroCampo], null);
    }
  });

  test(`el reparto de ${tipo} conserva el total y consulta solo la referencia solicitada`, () => {
    const DB = prepararDBConCatalogos();
    DB.pos.vendedores.push({ id: 3, nombre: "Ana", sucursal_id: 1, activo: true });
    for (const vendedor_id of [1, 2, 3]) registrarEnPlantilla(DB, { ...PERIODO_META, vendedor_id });
    const datos = { ...PERIODO_META, tipo, [campo]: referencias[1] };
    fijarObjetivo(DB, { ...datos, [campo]: referencias[0], monto: 90 }, VICTOR);
    fijarObjetivo(DB, { ...datos, monto }, VICTOR);
    const consulta = { ...datos, [campo]: String(referencias[1]), sucursal_id: "1" };
    const antes = structuredClone(DB);
    const reparto = repartoSugerido(DB, consulta);
    assert.deepStrictEqual(reparto, [
      { vendedor_id: 1, monto: 3 }, { vendedor_id: 2, monto: 3 }, { vendedor_id: 3, monto: monto - 6 },
    ]);
    assert.strictEqual(reparto.reduce((total, linea) => total + linea.monto, 0), monto);
    if (tipo !== "marca") assert.ok(reparto.every((linea) => Number.isInteger(linea.monto)));
    assert.deepStrictEqual(DB, antes, "sugerir no modifica metas ni plantilla");
    for (const vendedor_id of [1, 2]) {
      fijarObjetivo(DB, { ...datos, vendedor_id, monto: 3 }, VICTOR);
      fijarObjetivo(DB, { ...datos, [campo]: referencias[0], vendedor_id, monto: 40 }, VICTOR);
    }
    const antesDeLeer = structuredClone(DB);
    assert.deepStrictEqual(estadoDelReparto(DB, consulta), {
      meta_tienda: monto, asignado: 6, sin_asignar: monto - 6,
      lineas: [{ vendedor_id: 1, monto: 3 }, { vendedor_id: 2, monto: 3 }, { vendedor_id: 3, monto: 0 }],
    });
    assert.deepStrictEqual(DB, antesDeLeer);
  });

  test(`la meta de ${tipo} acepta cero y rechaza montos inválidos sin mutar la base`, () => {
    const DB = prepararDBConCatalogos();
    const datos = { ...PERIODO_META, tipo, [campo]: referencias[0] };
    assert.strictEqual(fijarObjetivo(DB, { ...datos, monto: 0 }, VICTOR).monto, 0);
    const antes = structuredClone(DB);
    for (const montoInvalido of [-1, NaN, Infinity, "3", null, undefined]) {
      assert.throws(() => fijarObjetivo(DB, { ...datos, monto: montoInvalido }, VICTOR), /monto|número/i);
      assert.deepStrictEqual(DB, antes);
    }
  });
}

test("cada marca, producto y financiera conserva su historial sin reemplazar otras metas ni venta o actividad", () => {
  const DB = prepararDBConCatalogos();
  const llaves = [
    { tipo: "venta" }, { tipo: "actividad", actividad: "iglesia" },
    ...METAS_NUEVAS.flatMap(({ tipo, campo, referencias }) => referencias.map((id) => ({ tipo, [campo]: id }))),
  ].map((llave) => ({ ...PERIODO_META, ...llave }));
  const originales = llaves.map((llave) => fijarObjetivo(DB, { ...llave, monto: 10 }, VICTOR));
  assert.ok(originales.every((meta) => meta.vigente && meta.version === 1));
  for (const [indice, llave] of llaves.entries()) {
    const nueva = fijarObjetivo(DB, { ...llave, monto: 12, motivo: "Ajuste de meta" }, VICTOR);
    assert.strictEqual(nueva.version, 2);
    assert.strictEqual(nueva.reemplaza_a, originales[indice].id);
    assert.strictEqual(nueva.motivo, "Ajuste de meta");
    assert.strictEqual(originales[indice].vigente, false);
    assert.ok(originales.slice(indice + 1).every((meta) => meta.vigente));
    assert.strictEqual(objetivoVigente(DB, llave), nueva);
    assert.deepStrictEqual(historialObjetivo(DB, llave), [originales[indice], nueva]);
  }
  assert.strictEqual(DB.pos.objetivos.filter((meta) => meta.vigente).length, llaves.length);
});

for (const tipo of ["venta", "actividad", "marca", "producto", "credito"]) {
  test(`${tipo} rechaza referencias ajenas en escritura, consulta, historial y reparto`, () => {
    const DB = prepararDBConCatalogos();
    const porTipo = { venta: {}, actividad: { actividad: "iglesia" }, marca: { marca_id: 1 }, producto: { producto_meta_id: 1 } };
    const referencia = tipo === "credito" ? { financiera: "atrato" } : porTipo[tipo];
    const datos = { ...PERIODO_META, tipo, ...referencia, monto: 10 };
    const antes = structuredClone(DB);
    for (const campo of ["actividad", "marca_id", "producto_meta_id", "financiera"].filter((c) => !(c in referencia))) {
      const incompatible = { ...datos, [campo]: campo === "actividad" ? "iglesia" : campo === "financiera" ? "atrato" : 1 };
      for (const consultar of [objetivoVigente, historialObjetivo, repartoSugerido, estadoDelReparto]) {
        assert.throws(() => consultar(DB, incompatible), new RegExp(campo));
      }
      assert.throws(() => fijarObjetivo(DB, incompatible, VICTOR), new RegExp(campo));
      assert.deepStrictEqual(DB, antes);
    }
  });
}

for (const [tipo, campo, lista] of [["marca", "marca_id", "marcas"], ["producto", "producto_meta_id", "productos"]]) {
  test(`${tipo} exige un elemento existente y activo al fijar la meta`, () => {
    const DB = prepararDBConCatalogos();
    desactivarElemento(DB, lista, 2, { motivo: "Fuera de la lista" }, VICTOR);
    const antes = structuredClone(DB);
    for (const id of [undefined, null, 0, -1, 1.5, "abc", true, [], [1], {}, 99, 2]) {
      assert.throws(() => fijarObjetivo(DB, { ...PERIODO_META, tipo, [campo]: id, monto: 10 }, VICTOR), /identificador|existe|activo|activa/i);
      assert.deepStrictEqual(DB, antes);
    }
  });

  test(`desactivar ${tipo} conserva la consulta y el reparto de sus metas pero impide reemplazarlas`, () => {
    const DB = prepararDBConCatalogos();
    const datos = { ...PERIODO_META, tipo, [campo]: 1 };
    registrarEnPlantilla(DB, { ...PERIODO_META, vendedor_id: 1 });
    const meta = fijarObjetivo(DB, { ...datos, monto: 10 }, VICTOR);
    desactivarElemento(DB, lista, 1, { motivo: "Ya no se usará" }, VICTOR);
    const antes = structuredClone(DB);
    assert.strictEqual(objetivoVigente(DB, datos), meta);
    assert.deepStrictEqual(historialObjetivo(DB, datos), [meta]);
    assert.deepStrictEqual(repartoSugerido(DB, datos), [{ vendedor_id: 1, monto: 10 }]);
    assert.strictEqual(estadoDelReparto(DB, datos).meta_tienda, 10);
    assert.throws(() => fijarObjetivo(DB, { ...datos, monto: 20, motivo: "Cambio" }, VICTOR), /activo|activa/i);
    assert.deepStrictEqual(DB, antes);
  });
}

test("crédito solo acepta las claves fijas coppel_pay y atrato", () => {
  const DB = prepararDBConCatalogos();
  const antes = structuredClone(DB);
  for (const financiera of [undefined, null, "", "Coppel Pay", "ATRATO", "otra", 1, {}]) {
    assert.throws(() => fijarObjetivo(DB, { ...PERIODO_META, tipo: "credito", financiera, monto: 10 }, VICTOR), /financiera/i);
    assert.deepStrictEqual(DB, antes);
  }
});

for (const referencia of [{ tipo: "producto", producto_meta_id: 1 }, { tipo: "credito", financiera: "atrato" }]) {
  test(`${referencia.tipo} rechaza montos decimales sin modificar la base`, () => {
    const DB = prepararDBConCatalogos();
    const antes = structuredClone(DB);
    assert.throws(() => fijarObjetivo(DB, { ...PERIODO_META, ...referencia, monto: 2.5 }, VICTOR), /entero/i);
    assert.deepStrictEqual(DB, antes);
  });
}

for (const referencia of [{ tipo: "venta" }, { tipo: "actividad", actividad: "iglesia" }]) {
  test(`la meta histórica de ${referencia.tipo} sin campos nuevos sigue vigente y conserva su versión al cambiarla`, () => {
    const DB = prepararDB();
    const datos = { ...PERIODO_META, ...referencia };
    const antigua = { id: 1, ...datos, monto: 10, version: 1, vigente: true };
    DB.pos.objetivos.push(antigua);
    const consulta = { ...datos, marca_id: null, producto_meta_id: null, financiera: null };
    assert.strictEqual(objetivoVigente(DB, datos), antigua);
    assert.strictEqual(objetivoVigente(DB, consulta), antigua);
    assert.deepStrictEqual(historialObjetivo(DB, consulta), [antigua]);
    const nueva = fijarObjetivo(DB, { ...consulta, monto: 12, motivo: "Ajuste" }, VICTOR);
    assert.strictEqual(nueva.version, 2);
    assert.strictEqual(nueva.reemplaza_a, antigua.id);
    assert.strictEqual(antigua.vigente, false);
    assert.strictEqual(objetivoVigente(DB, datos), nueva);
    assert.deepStrictEqual(historialObjetivo(DB, datos), [antigua, nueva]);
    for (const campo of ["marca_id", "producto_meta_id", "financiera"]) assert.strictEqual(nueva[campo], null);
  });
}
