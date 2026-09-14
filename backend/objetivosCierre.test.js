const { test } = require("node:test");
const assert = require("node:assert");
const { fijarObjetivo, registrarEnPlantilla } = require("./objetivos");
const { capturarDia, corregirCaptura } = require("./objetivosCaptura");
const { previoCierre, cerrarMes, estaCerrado, rectificarCierre } = require("./objetivosCierre");

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
const ADMINISTRADORA = { id: 3, nombre: "Administración" };
const MES = { mes: "2026-09", sucursal_id: 1 };

function conRelojEn(instante, trabajo) {
  const DateReal = Date;
  global.Date = class extends DateReal {
    constructor(...argumentos) {
      super(...(argumentos.length ? argumentos : [instante]));
    }

    static now() {
      return new DateReal(instante).getTime();
    }
  };
  try {
    return trabajo();
  } finally {
    global.Date = DateReal;
  }
}

function fijar(DB, vendedor_id, monto, periodo = MES) {
  return fijarObjetivo(DB, { ...periodo, tipo: "venta", vendedor_id, monto }, VICTOR);
}

function capturar(DB, vendedor_id, monto, periodo = MES, dia = "03") {
  return conRelojEn("2026-10-02T18:30:00.000Z", () => capturarDia(DB, {
    ...periodo, fecha: `${periodo.mes}-${dia}`, vendedor_id, tipo: "venta", monto,
  }, VICTOR));
}

function prepararMes() {
  const DB = prepararDB();
  for (const vendedor_id of [1, 2]) registrarEnPlantilla(DB, { ...MES, vendedor_id });
  fijar(DB, null, 180000);
  fijar(DB, 1, 100000);
  fijar(DB, 2, 80000);
  capturar(DB, 1, 100000);
  capturar(DB, 2, 20000);
  return DB;
}

function realesDelMes() {
  return [{ vendedor_id: 1, real_sicar: 85000 }, { vendedor_id: 2, real_sicar: 25000 }];
}

test("el previo muestra meta y capturado de cada persona de la plantilla", () => {
  const DB = prepararMes();
  fijar(DB, 1, 110000);
  corregirCaptura(DB, 1, 90000, "Importe correcto", VICTOR);
  capturar(DB, 1, 10000, MES, "04");
  const otraTienda = { mes: "2026-09", sucursal_id: 2 };
  const otroMes = { mes: "2026-08", sucursal_id: 1 };
  registrarEnPlantilla(DB, { ...otraTienda, vendedor_id: 9 });
  registrarEnPlantilla(DB, { ...otroMes, vendedor_id: 1 });
  fijar(DB, 9, 999999, otraTienda);
  fijar(DB, 1, 888888, otroMes);
  capturar(DB, 9, 999999, otraTienda);
  capturar(DB, 1, 888888, otroMes);
  const antes = structuredClone(DB);

  assert.deepEqual(previoCierre(DB, MES), [
    { vendedor_id: 1, nombre: "Juan", meta: 110000, capturado: 100000 },
    { vendedor_id: 2, nombre: "Maria", meta: 80000, capturado: 20000 },
  ]);
  assert.deepEqual(DB, antes, "consultar el previo no escribe nada");

  const sinMovimientos = prepararDB();
  registrarEnPlantilla(sinMovimientos, { ...MES, vendedor_id: 1 });
  assert.deepEqual(previoCierre(sinMovimientos, MES), [
    { vendedor_id: 1, nombre: "Juan", meta: 0, capturado: 0 },
  ]);
});

test("cerrar guarda la diferencia entre lo capturado y lo real de SICAR", () => {
  const DB = prepararMes();
  const reales = realesDelMes().reverse();
  const cierre = cerrarMes(DB, { ...MES, reales }, ADMINISTRADORA);
  assert.deepEqual(cierre.lineas, [
    { vendedor_id: 1, meta: 100000, capturado: 100000, real_sicar: 85000, diferencia: 15000 },
    { vendedor_id: 2, meta: 80000, capturado: 20000, real_sicar: 25000, diferencia: -5000 },
  ]);
  reales[0].real_sicar = 999999;
  assert.equal(DB.pos.objetivo_cierres[0].lineas[1].real_sicar, 25000);

  const conCero = prepararMes();
  const cierreCero = cerrarMes(conCero, { ...MES, reales: [
    { vendedor_id: 1, real_sicar: 0 }, { vendedor_id: 2, real_sicar: 20000 },
  ] }, ADMINISTRADORA);
  assert.equal(cierreCero.lineas[0].real_sicar, 0, "cero es un real válido");
  assert.equal(cierreCero.lineas[0].diferencia, 100000);
  assert.equal(cierreCero.lineas[1].diferencia, 0);
});

test("EL SELLO CONGELA: cambiar una meta despues NO cambia el cierre", () => {
  const DB = prepararMes();
  const vigente = fijar(DB, 1, 110000);
  const otraTienda = { mes: "2026-09", sucursal_id: 2 };
  const otroMes = { mes: "2026-08", sucursal_id: 1 };
  registrarEnPlantilla(DB, { ...otraTienda, vendedor_id: 9 });
  registrarEnPlantilla(DB, { ...otroMes, vendedor_id: 1 });
  fijar(DB, 9, 999999, otraTienda);
  fijar(DB, null, 888888, otroMes);
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  const sellado = structuredClone(cierre);
  assert.deepEqual(cierre.foto.objetivos.map((o) => [o.vendedor_id, o.monto]), [
    [null, 180000], [2, 80000], [1, 110000],
  ], "incluye la meta de tienda y únicamente las versiones vigentes del mes y sucursal");
  assert.deepEqual(cierre.foto.plantilla.map((p) => p.vendedor_id), [1, 2]);
  for (const objetivo of cierre.foto.objetivos) {
    assert.notStrictEqual(objetivo, DB.pos.objetivos.find((o) => o.id === objetivo.id));
  }
  assert.notStrictEqual(cierre.foto.plantilla[0], DB.pos.objetivo_plantilla[0]);

  fijar(DB, 1, 50000);
  fijar(DB, null, 90000);
  assert.equal(vigente.vigente, false, "el cambio sí modifica la versión original");
  vigente.monto = 1;
  DB.pos.objetivo_plantilla[0].hasta = "2026-09-15";
  DB.pos.objetivo_plantilla[0].motivo = "Baja posterior";
  assert.deepEqual(DB.pos.objetivo_cierres[0], sellado, "ni metas ni plantilla alteran la foto sellada");
});

test("EL SELLO CONGELA LAS CAPTURAS: corregir despues no cambia el cierre", () => {
  const DB = prepararMes();
  const vigente = corregirCaptura(DB, 1, 95000, "Revisión antes del cierre", VICTOR);
  capturar(DB, 9, 999999, { mes: "2026-09", sucursal_id: 2 });
  capturar(DB, 1, 888888, { mes: "2026-08", sucursal_id: 1 });
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  const sellado = structuredClone(cierre);
  assert.deepEqual(cierre.foto.capturas.map((c) => [c.vendedor_id, c.monto]), [
    [2, 20000], [1, 95000],
  ], "excluye la captura reemplazada, otros meses y otras sucursales");
  for (const captura of cierre.foto.capturas) {
    assert.notStrictEqual(captura, DB.pos.objetivo_capturas.find((c) => c.id === captura.id));
  }
  corregirCaptura(DB, vigente.id, 70000, "Revisión posterior", VICTOR);
  assert.equal(vigente.vigente, false);
  vigente.monto = 1;
  capturar(DB, 1, 5000, MES, "04");
  assert.deepEqual(DB.pos.objetivo_cierres[0], sellado, "ni correcciones ni altas cambian el cierre");
  assert.equal(cierre.lineas[0].capturado, 95000);
  assert.equal(cierre.lineas[0].diferencia, 10000);
});

test("no se puede cerrar dos veces la misma tienda y mes", () => {
  const DB = prepararMes();
  cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  const antes = structuredClone(DB);
  assert.throws(
    () => cerrarMes(DB, { ...MES, reales: realesDelMes() }, VICTOR),
    /ya (esta|está) cerrado/i
  );
  assert.deepEqual(DB, antes);
});

test("cerrar una tienda NO cierra las otras", () => {
  const DB = prepararMes();
  assert.equal(estaCerrado(DB, "2026-09", 1), false);
  const primero = cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  assert.equal(estaCerrado(DB, "2026-09", 1), true);
  assert.equal(estaCerrado(DB, "2026-09", 2), false);
  assert.equal(estaCerrado(DB, "2026-10", 1), false);
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 9 });
  const segundo = cerrarMes(DB, { mes: "2026-09", sucursal_id: 2,
    reales: [{ vendedor_id: 9, real_sicar: 0 }],
  }, ADMINISTRADORA);
  assert.equal(estaCerrado(DB, "2026-09", 2), true);
  assert.notEqual(primero.id, segundo.id);
  assert.deepEqual(segundo.lineas, [
    { vendedor_id: 9, meta: 0, capturado: 0, real_sicar: 0, diferencia: 0 },
  ]);
  assert.equal(DB.pos.objetivo_cierres.length, 2);
});

test("quien estuvo el mes aparece en el cierre aunque hoy este inactivo", () => {
  const DB = prepararMes();
  DB.pos.vendedores.find((v) => v.id === 2).activo = false;
  assert.ok(previoCierre(DB, MES).some((p) => p.vendedor_id === 2));
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  assert.deepEqual(cierre.lineas[1], {
    vendedor_id: 2, meta: 80000, capturado: 20000, real_sicar: 25000, diferencia: -5000,
  });
  assert.ok(cierre.foto.plantilla.some((p) => p.vendedor_id === 2));
});

test("falta el real de alguien: se rechaza el cierre entero, sin escribir nada", () => {
  const DB = prepararMes();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 9 });
  cerrarMes(DB, { mes: "2026-09", sucursal_id: 2,
    reales: [{ vendedor_id: 9, real_sicar: 0 }],
  }, ADMINISTRADORA);
  const antes = structuredClone(DB);
  const listaOriginal = DB.pos.objetivo_cierres;
  const listasInvalidas = [undefined, null, {}, [], [{ vendedor_id: 1, real_sicar: 85000 }]];
  for (const malo of [undefined, null, NaN, Infinity, -Infinity, -1, "0", "abc", "", false]) {
    listasInvalidas.push([{ vendedor_id: 1, real_sicar: 85000 }, { vendedor_id: 2, real_sicar: malo }]);
  }
  listasInvalidas.push([...realesDelMes(), { vendedor_id: 1, real_sicar: 1 }]);
  listasInvalidas.push([...realesDelMes(), { vendedor_id: 9, real_sicar: 1 }]);
  listasInvalidas.push([...realesDelMes(), null]);
  for (const reales of listasInvalidas) {
    assert.throws(() => cerrarMes(DB, { ...MES, reales }, ADMINISTRADORA), /real|SICAR|plantilla/i);
    assert.strictEqual(DB.pos.objetivo_cierres, listaOriginal);
    assert.deepEqual(DB, antes, "el rechazo no modifica siquiera un cierre anterior");
  }
  for (const mes of [null, "2026-9", "2026-13", "2026-09\n"]) {
    assert.throws(() => cerrarMes(DB, { ...MES, mes, reales: realesDelMes() }, ADMINISTRADORA), /mes/i);
  }
  for (const sucursal_id of [undefined, null, 0, -1, "1", NaN]) {
    assert.throws(() => cerrarMes(DB, { ...MES, sucursal_id, reales: realesDelMes() }, ADMINISTRADORA), /sucursal/i);
  }
  assert.deepEqual(DB, antes);
});

test("queda constancia de quien sello y cuando", () => {
  const DB = prepararMes();
  const antes = structuredClone(DB.pos);
  const cierre = conRelojEn("2026-10-01T18:30:00.000Z", () =>
    cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA)
  );
  assert.deepEqual(cierre, {
    id: 1, mes: "2026-09", sucursal_id: 1,
    cerrado_por: "Administración", cerrado_en: "2026-10-01T18:30:00.000Z",
    lineas: [
      { vendedor_id: 1, meta: 100000, capturado: 100000, real_sicar: 85000, diferencia: 15000 },
      { vendedor_id: 2, meta: 80000, capturado: 20000, real_sicar: 25000, diferencia: -5000 },
    ],
    foto: { objetivos: antes.objetivos, capturas: antes.objetivo_capturas, plantilla: antes.objetivo_plantilla },
    rectificaciones: [],
  });
  assert.deepEqual(DB.pos.objetivo_cierres, [cierre]);
  assert.deepEqual(DB.pos.objetivos, antes.objetivos);
  assert.deepEqual(DB.pos.objetivo_capturas, antes.objetivo_capturas);
  assert.deepEqual(DB.pos.objetivo_plantilla, antes.objetivo_plantilla);
});

/**
 * Task 6 — rectificar despues del cierre, SIN reabrirlo.
 *
 * El caso real: el mes esta cerrado, Victor ya pago la comision, y una semana
 * despues el cliente devuelve el teclado de $12,000. Esa comision se pago sobre
 * una venta que ya no existe.
 *
 * La tentacion es entrar al cierre y corregir el numero. Eso DESTRUYE el sello:
 * si el cierre de septiembre puede cambiar en octubre, la cifra con la que
 * Victor pago deja de ser demostrable. Por eso el cierre no se toca jamas y el
 * efecto tardio se apila aparte, como hacen los cortes de caja.
 */

test("una rectificacion NO cambia el cierre original", () => {
  const DB = prepararMes();
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  const lineasAntes = JSON.stringify(cierre.lineas);
  const fotoAntes = JSON.stringify(cierre.foto);

  rectificarCierre(DB, cierre.id, {
    vendedor_id: 1, campo: "real_sicar", valor_nuevo: 73000, motivo: "Error de dedo al teclear SICAR",
  }, ADMINISTRADORA);

  assert.equal(JSON.stringify(cierre.lineas), lineasAntes, "las lineas del cierre no se tocan");
  assert.equal(JSON.stringify(cierre.foto), fotoAntes, "la foto sellada no se toca");
  assert.equal(cierre.rectificaciones.length, 1, "la rectificacion se apila aparte");
});

test("la rectificacion guarda valor anterior, nuevo, motivo, quien y cuando", () => {
  const DB = prepararMes();
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);

  const r = rectificarCierre(DB, cierre.id, {
    vendedor_id: 1, campo: "real_sicar", valor_nuevo: 73000, motivo: "Error de dedo al teclear SICAR",
  }, ADMINISTRADORA);

  assert.equal(r.vendedor_id, 1);
  assert.equal(r.campo, "real_sicar");
  assert.equal(r.valor_anterior, 85000, "el valor anterior se lee del cierre, no se recibe de fuera");
  assert.equal(r.valor_nuevo, 73000);
  assert.equal(r.motivo, "Error de dedo al teclear SICAR");
  assert.equal(r.rectificado_por, "Administración");
  assert.ok(r.rectificado_en, "sin fecha no se sabe cuando se rectifico");
});

test("una venta cancelada despues del cierre se registra como rectificacion", () => {
  const DB = prepararMes();
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);

  // el cliente devolvio un teclado de $12,000 que ya conto para la comision
  const r = rectificarCierre(DB, cierre.id, {
    vendedor_id: 1, campo: "real_sicar", valor_nuevo: 73000,
    motivo: "Venta cancelada en SICAR, folio 4471: devolucion de teclado",
  }, ADMINISTRADORA);

  assert.equal(r.valor_anterior - r.valor_nuevo, 12000, "queda claro cuanto se fue");
  assert.match(r.motivo, /4471/, "el folio tiene que quedar en el motivo para poder rastrearlo");
  assert.equal(cierre.lineas.find((l) => l.vendedor_id === 1).real_sicar, 85000,
    "el mes pagado conserva su cifra: el ajuste va en la siguiente comision");
});

test("no se rectifica un cierre que no existe", () => {
  const DB = prepararMes();
  cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  assert.throws(() => rectificarCierre(DB, 9999, {
    vendedor_id: 1, campo: "real_sicar", valor_nuevo: 1, motivo: "x",
  }, ADMINISTRADORA), /no existe/i);
});

test("no se rectifica sin motivo", () => {
  const DB = prepararMes();
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  for (const motivo of [undefined, null, "", "   "]) {
    assert.throws(() => rectificarCierre(DB, cierre.id, {
      vendedor_id: 1, campo: "real_sicar", valor_nuevo: 73000, motivo,
    }, ADMINISTRADORA), /motivo/i, `dejo pasar motivo ${JSON.stringify(motivo)}`);
  }
  assert.equal(cierre.rectificaciones.length, 0, "un numero cambiado sin explicacion es lo que estamos evitando");
});
