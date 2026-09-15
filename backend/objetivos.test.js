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

const { registrarEnPlantilla, plantillaDelMes } = require("./objetivos");

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
