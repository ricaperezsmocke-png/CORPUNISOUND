const { test } = require("node:test");
const assert = require("node:assert");
const { fijarObjetivo, registrarEnPlantilla } = require("./objetivos");
const { capturarDia, corregirCaptura } = require("./objetivosCaptura");
const { previoCierre, cerrarMes, estaCerrado, rectificarCierre } = require("./objetivosCierre");
const { registrarActividad, anularActividad, agregarResultado } = require("./objetivosActividades");
const { altaElemento, desactivarElemento } = require("./objetivosCatalogos");
const { registrarCredito, anularCredito } = require("./objetivosCreditos");

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

test("cierre personal toma últimas correcciones de venta, calcula centavos y no filtra datos ajenos", () => {
  const { cierreDePersona } = require("./objetivosCierre");
  const DB = prepararDB();
  const cierre = { id: 1, ...MES, cerrado_en: "2026-10-02T18:00:00Z", cerrado_por: "Victor",
    lineas: [{ vendedor_id: 1, meta: 120, capturado: 90, real_sicar: 100, diferencia: -10 },
      { vendedor_id: 2, meta: 9000, capturado: 8000, real_sicar: 7000, diferencia: 1000 }],
    rectificaciones: [] };
  DB.pos.objetivo_cierres.push(cierre);
  for (const datos of [
    { vendedor_id: 1, campo: "real_sicar", valor_nuevo: 80 },
    { vendedor_id: 2, campo: "real_sicar", valor_nuevo: 6000 },
    { vendedor_id: 1, campo: "capturado", valor_nuevo: 80.5 },
    { vendedor_id: 1, campo: "meta", valor_nuevo: 110 },
    { vendedor_id: 1, campo: "real_sicar", valor_nuevo: 70.2 },
  ]) rectificarCierre(DB, 1, { ...datos, motivo: "Revisión SICAR" }, VICTOR);
  const antes = structuredClone(DB);
  const propio = cierreDePersona(DB, { ...MES, vendedor_id: "1", sucursal_id: "1" });
  assert.deepStrictEqual(propio.venta, { meta: 110, declarado: 80.5, real_sicar: 70.2, diferencia: 10.3 });
  assert.equal(propio.cerrado_por, "Victor");
  assert.equal(propio.cerrado_en, cierre.cerrado_en);
  assert.equal(propio.rectificaciones.length, 4);
  assert.deepStrictEqual(propio.rectificaciones[0], { campo: "real_sicar", valor_anterior: 100, valor_nuevo: 80,
    motivo: "Revisión SICAR", rectificado_en: cierre.rectificaciones[0].rectificado_en });
  assert.equal(propio.lineas, undefined);
  assert.equal(propio.foto, undefined);
  assert.ok(!JSON.stringify(propio).includes("6000"));
  assert.deepStrictEqual(DB, antes);
});

test("cierre personal omite a quien no fue sellado y respeta mes y tienda", () => {
  const { cierreDePersona } = require("./objetivosCierre");
  const DB = prepararDB();
  DB.pos.objetivo_cierres.push({ ...MES, cerrado_por: "Victor", cerrado_en: "2026-10-02T18:00:00Z",
    lineas: [{ vendedor_id: 1, meta: 120, capturado: 90, real_sicar: 100, diferencia: -10 }] });
  for (const consulta of [{ ...MES, vendedor_id: 9 }, { mes: "2026-08", sucursal_id: 1, vendedor_id: 1 },
    { ...MES, sucursal_id: 2, vendedor_id: 1 }]) assert.equal(cierreDePersona(DB, consulta), null);
  const propio = cierreDePersona(DB, { ...MES, vendedor_id: 1 });
  assert.deepStrictEqual(propio.venta, { meta: 120, declarado: 90, real_sicar: 100, diferencia: -10 });
  assert.deepStrictEqual(propio.rectificaciones, []);
});

test("correcciones de elementos tienen referencia sellada legible y no cambian la venta", () => {
  const { cierreDePersona } = require("./objetivosCierre");
  const DB = prepararNuevos();
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesNuevos() }, VICTOR);
  for (const referencia of [{ marca_id: 1 }, { producto_meta_id: 1 }, { financiera: "coppel_pay" }]) {
    rectificarCierre(DB, cierre.id, { vendedor_id: 1, campo: "meta", ...referencia, valor_nuevo: 2, motivo: "Ajuste" }, VICTOR);
  }
  DB.pos.objetivo_marcas[0].nombre = "Nombre posterior";
  const propio = cierreDePersona(DB, { ...MES, vendedor_id: 1 });
  assert.equal(propio.venta.meta, 100000);
  assert.deepStrictEqual(propio.rectificaciones.map((r) => r.referencia), ["Marca: Yamaha", "Producto: Teclados", "Financiera: Coppel Pay"]);
});

test("fase1: solo cierra después del fin de mes local, incluido diciembre", () => {
  for (const [mes, hoy, siguiente] of [
    ["2026-09", "2026-09-30", "2026-10-01"], ["2030-01", "2026-10-09", "2030-02-01"],
    ["2026-12", "2026-12-31", "2027-01-01"],
  ]) {
    const DB = prepararDB();
    assert.throws(() => cerrarMes(DB, { mes, sucursal_id: 1, reales: [] }, VICTOR, hoy),
      { message: `El mes todavía no termina; se puede cerrar a partir del ${siguiente}` });
    assert.equal(DB.pos.objetivo_cierres.length, 0);
  }
});

test("fase1: cierre exige huella y rechaza capturas posteriores al previo", () => {
  const DB = prepararMes();
  const datos = { ...MES, reales: realesDelMes() };
  const previo = previoCierre(DB, MES);
  assert.throws(() => cerrarMes(DB, datos, VICTOR), { status: 409 });
  capturar(DB, 1, 100, MES, "05");
  assert.throws(() => cerrarMes(DB, { ...datos, huella: previo.huella }, VICTOR), { status: 409 });
  assert.equal(DB.pos.objetivo_cierres.length, 0);
  const actualizado = previoCierre(DB, MES);
  assert.match(actualizado.huella, /^[a-f0-9]{64}$/);
  const cierre = cerrarMes(DB, { ...datos, huella: actualizado.huella }, VICTOR, "2026-10-01");
  assert.equal(cierre.lineas[0].capturado, 100100);
});

test("fase1: rectificaciones encadenan la misma persona, campo y referencia", () => {
  const DB = prepararMes();
  const previo = previoCierre(DB, MES);
  const cierre = cerrarMes(DB, { ...MES, huella: previo.huella, reales: realesDelMes() }, VICTOR);
  const original = structuredClone({ lineas: cierre.lineas, foto: cierre.foto });
  const rectificar = (vendedor_id, campo, valor_nuevo) =>
    rectificarCierre(DB, cierre.id, { vendedor_id, campo, valor_nuevo, motivo: "Corrección" }, VICTOR);
  rectificar(1, "capturado", 90000);
  rectificar(2, "capturado", 15000);
  rectificar(1, "meta", 120000);
  const segunda = rectificar("1", "capturado", 80000);
  assert.equal(segunda.valor_anterior, 90000);
  assert.equal(segunda.valor_sellado, 100000);
  assert.deepEqual({ lineas: cierre.lineas, foto: cierre.foto }, original);
});

function cerrarRevisado(DB, datos, usuario) {
  return cerrarMes(DB, { ...datos, huella: previoCierre(DB, datos).huella }, usuario, "2026-10-02");
}

test("fase1: el día de cierre usa México aunque en UTC ya sea el siguiente mes", () => {
  const DB = prepararDB();
  const datos = { ...MES, reales: [], huella: previoCierre(DB, MES).huella };
  conRelojEn("2026-10-01T05:59:59Z", () => assert.throws(() => cerrarMes(DB, datos, VICTOR), /todavía no termina/));
  conRelojEn("2026-10-01T06:00:00Z", () => assert.equal(cerrarMes(DB, datos, VICTOR).mes, "2026-09"));
});

test("fase1: huella de cierre detecta versiones sin cambio de cifra y no depende del orden", () => {
  const DB = prepararMes();
  const inicial = previoCierre(DB, MES).huella;
  DB.pos.objetivos.reverse();
  DB.pos.objetivo_capturas.reverse();
  assert.equal(previoCierre(DB, MES).huella, inicial);
  const captura = DB.pos.objetivo_capturas.find((c) => c.vendedor_id === 1);
  corregirCaptura(DB, captura.id, captura.monto, "Confirmado", VICTOR);
  assert.notEqual(previoCierre(DB, MES).huella, inicial);
  const corregida = previoCierre(DB, MES).huella;
  fijar(DB, 1, 100000);
  assert.notEqual(previoCierre(DB, MES).huella, corregida);
});

test("fase1: rectificaciones de elementos y crédito capturado conservan cadenas separadas", () => {
  const DB = prepararNuevos();
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesNuevos() }, VICTOR);
  const original = structuredClone({ foto: cierre.foto, lineas: cierre.lineas });
  const corregir = (ref, campo, valor_nuevo) => rectificarCierre(DB, cierre.id,
    { vendedor_id: 1, ...ref, campo, valor_nuevo, motivo: "Ajuste" }, VICTOR);
  for (const ref of [{ marca_id: 1 }, { producto_meta_id: 1 }, { financiera: "coppel_pay" }]) {
    const r1 = corregir(ref, "capturado", 3);
    corregir({}, "capturado", 45);
    corregir(ref, "meta", 50);
    const r2 = corregir(ref, "capturado", 2);
    assert.equal(r2.valor_anterior, 3);
    assert.equal(r2.valor_sellado, r1.valor_anterior);
    if (ref.financiera) assert.equal(r2.valor_sellado, 1);
  }
  assert.deepEqual({ foto: cierre.foto, lineas: cierre.lineas }, original);
});

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

function actividadesVacias() {
  return ["grupos", "marketplace", "iglesia", "volanteo"].map((actividad) => ({
    actividad, meta: 0, declaradas: 0, conjuntas: 0,
  }));
}

function fijarActividad(DB, vendedor_id, actividad, monto, periodo = MES) {
  return fijarObjetivo(DB, { ...periodo, tipo: "actividad", actividad, vendedor_id, monto }, VICTOR);
}

function registrar(DB, vendedor_id, extra = {}) {
  return conRelojEn("2026-10-02T18:30:00.000Z", () => registrarActividad(DB, {
    ...MES, fecha: `${MES.mes}-03`, vendedor_id, actividad: "grupos",
    link: `https://facebook.com/publicacion-${vendedor_id}`, ...extra,
  }, VICTOR));
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

  assert.deepEqual(previoCierre(DB, MES).lineas, [
    { vendedor_id: 1, nombre: "Juan", meta: 110000, capturado: 100000, marcas: [], productos: [], creditos: [], actividades: actividadesVacias() },
    { vendedor_id: 2, nombre: "Maria", meta: 80000, capturado: 20000, marcas: [], productos: [], creditos: [], actividades: actividadesVacias() },
  ]);
  assert.deepEqual(DB, antes, "consultar el previo no escribe nada");

  const sinMovimientos = prepararDB();
  registrarEnPlantilla(sinMovimientos, { ...MES, vendedor_id: 1 });
  assert.deepEqual(previoCierre(sinMovimientos, MES).lineas, [
    { vendedor_id: 1, nombre: "Juan", meta: 0, capturado: 0, marcas: [], productos: [], creditos: [], actividades: actividadesVacias() },
  ]);
});

test("alguien con capturas fuera de plantilla participa, exige real y queda en lineas", () => {
  const DB = prepararMes();
  DB.pos.vendedores.push({ id: 3, nombre: "Luisa", sucursal_id: 2, activo: false });
  DB.pos.objetivo_capturas.push({
    id: 3, mes: MES.mes, fecha: `${MES.mes}-05`, sucursal_id: MES.sucursal_id,
    vendedor_id: 3, tipo: "venta", monto: 7000, capturado_por: "Luisa",
    capturado_en: "2026-09-05T18:30:00.000Z", corrige_a: null, vigente: true,
  });

  assert.deepEqual(previoCierre(DB, MES).lineas.map((linea) => linea.vendedor_id), [1, 2, 3]);
  assert.throws(
    () => cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA),
    /falta.*real|SICAR/i
  );
  const cierre = cerrarRevisado(DB, {
    ...MES, reales: [...realesDelMes(), { vendedor_id: 3, real_sicar: 6500 }],
  }, ADMINISTRADORA);
  assert.deepEqual(cierre.lineas[2], {
    vendedor_id: 3, meta: 0, capturado: 7000, real_sicar: 6500, diferencia: 500,
    marcas: [], productos: [], creditos: [], actividades: actividadesVacias(),
  });
  assert.deepEqual(cierre.foto.plantilla.map((linea) => linea.vendedor_id), [1, 2]);
});

test("alguien que solo tiene meta personal participa en el cierre", () => {
  const DB = prepararMes();
  DB.pos.vendedores.push({ id: 3, nombre: "Luisa", sucursal_id: 1, activo: false });
  fijar(DB, 3, 30000);

  assert.deepEqual(previoCierre(DB, MES).lineas[2], {
    vendedor_id: 3, nombre: "Luisa", meta: 30000, capturado: 0,
    marcas: [], productos: [], creditos: [], actividades: actividadesVacias(),
  });
  const cierre = cerrarRevisado(DB, {
    ...MES, reales: [...realesDelMes(), { vendedor_id: 3, real_sicar: 0 }],
  }, ADMINISTRADORA);
  assert.equal(cierre.lineas.filter((linea) => linea.vendedor_id === 3).length, 1);
});

test("alguien en plantilla y con capturas aparece una sola vez", () => {
  const DB = prepararMes();
  capturar(DB, 1, 5000, MES, "04");

  const previo = previoCierre(DB, MES).lineas;
  assert.equal(previo.filter((linea) => linea.vendedor_id === 1).length, 1);
  assert.equal(previo.find((linea) => linea.vendedor_id === 1).capturado, 105000);
});

test("cerrar guarda la diferencia entre lo capturado y lo real de SICAR", () => {
  const DB = prepararMes();
  const reales = realesDelMes().reverse();
  const cierre = cerrarRevisado(DB, { ...MES, reales }, ADMINISTRADORA);
  assert.deepEqual(cierre.lineas, [
    { vendedor_id: 1, meta: 100000, capturado: 100000, real_sicar: 85000, diferencia: 15000, marcas: [], productos: [], creditos: [], actividades: actividadesVacias() },
    { vendedor_id: 2, meta: 80000, capturado: 20000, real_sicar: 25000, diferencia: -5000, marcas: [], productos: [], creditos: [], actividades: actividadesVacias() },
  ]);
  reales[0].real_sicar = 999999;
  assert.equal(DB.pos.objetivo_cierres[0].lineas[1].real_sicar, 25000);

  const conCero = prepararMes();
  const cierreCero = cerrarRevisado(conCero, { ...MES, reales: [
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
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
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
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
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
  cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  const antes = structuredClone(DB);
  assert.throws(
    () => cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, VICTOR),
    /ya (esta|está) cerrado/i
  );
  assert.deepEqual(DB, antes);
});

test("cerrar una tienda NO cierra las otras", () => {
  const DB = prepararMes();
  assert.equal(estaCerrado(DB, "2026-09", 1), false);
  const primero = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  assert.equal(estaCerrado(DB, "2026-09", 1), true);
  assert.equal(estaCerrado(DB, "2026-09", 2), false);
  assert.equal(estaCerrado(DB, "2026-10", 1), false);
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 9 });
  const segundo = cerrarRevisado(DB, { mes: "2026-09", sucursal_id: 2,
    reales: [{ vendedor_id: 9, real_sicar: 0 }],
  }, ADMINISTRADORA);
  assert.equal(estaCerrado(DB, "2026-09", 2), true);
  assert.notEqual(primero.id, segundo.id);
  assert.deepEqual(segundo.lineas, [
    { vendedor_id: 9, meta: 0, capturado: 0, real_sicar: 0, diferencia: 0, marcas: [], productos: [], creditos: [], actividades: actividadesVacias() },
  ]);
  assert.equal(DB.pos.objetivo_cierres.length, 2);
});

test("quien estuvo el mes aparece en el cierre aunque hoy este inactivo", () => {
  const DB = prepararMes();
  DB.pos.vendedores.find((v) => v.id === 2).activo = false;
  assert.ok(previoCierre(DB, MES).lineas.some((p) => p.vendedor_id === 2));
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  assert.deepEqual(cierre.lineas[1], {
    vendedor_id: 2, meta: 80000, capturado: 20000, real_sicar: 25000, diferencia: -5000,
    marcas: [], productos: [], creditos: [], actividades: actividadesVacias(),
  });
  assert.ok(cierre.foto.plantilla.some((p) => p.vendedor_id === 2));
});

test("falta el real de alguien: se rechaza el cierre entero, sin escribir nada", () => {
  const DB = prepararMes();
  registrarEnPlantilla(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 9 });
  cerrarRevisado(DB, { mes: "2026-09", sucursal_id: 2,
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
    assert.throws(() => cerrarRevisado(DB, { ...MES, reales }, ADMINISTRADORA), /real|SICAR|plantilla/i);
    assert.strictEqual(DB.pos.objetivo_cierres, listaOriginal);
    assert.deepEqual(DB, antes, "el rechazo no modifica siquiera un cierre anterior");
  }
  for (const mes of [null, "2026-9", "2026-13", "2026-09\n"]) {
    assert.throws(() => cerrarRevisado(DB, { ...MES, mes, reales: realesDelMes() }, ADMINISTRADORA), /mes/i);
  }
  for (const sucursal_id of [undefined, null, 0, -1, "1", NaN]) {
    assert.throws(() => cerrarRevisado(DB, { ...MES, sucursal_id, reales: realesDelMes() }, ADMINISTRADORA), /sucursal/i);
  }
  assert.deepEqual(DB, antes);
});

test("queda constancia de quien sello y cuando", () => {
  const DB = prepararMes();
  const antes = structuredClone(DB.pos);
  const cierre = conRelojEn("2026-10-01T18:30:00.000Z", () =>
    cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA)
  );
  assert.deepEqual(cierre, {
    id: 1, mes: "2026-09", sucursal_id: 1,
    cerrado_por: "Administración", cerrado_en: "2026-10-01T18:30:00.000Z",
    lineas: [
      { vendedor_id: 1, meta: 100000, capturado: 100000, real_sicar: 85000, diferencia: 15000, marcas: [], productos: [], creditos: [], actividades: actividadesVacias() },
      { vendedor_id: 2, meta: 80000, capturado: 20000, real_sicar: 25000, diferencia: -5000, marcas: [], productos: [], creditos: [], actividades: actividadesVacias() },
    ],
    foto: { objetivos: antes.objetivos, capturas: antes.objetivo_capturas, plantilla: antes.objetivo_plantilla,
      actividades: [], creditos: [], marcas: [], productos: [] },
    resumen_actividades_tienda: [
      { actividad: "grupos", etiqueta: "Publicación en grupos", declaradas: 0, conjuntas: 0 },
      { actividad: "marketplace", etiqueta: "Publicación en Marketplace", declaradas: 0, conjuntas: 0 },
      { actividad: "iglesia", etiqueta: "Salida a iglesia", declaradas: 0, conjuntas: 0 },
      { actividad: "volanteo", etiqueta: "Jornada de volanteo", declaradas: 0, conjuntas: 0 },
    ],
    rectificaciones: [],
    retiradas: [],
    tienda_sicar: {
      venta_centavos: 0, ventas: 0, cliente_centavos: 0, mostrador_centavos: 0, internas_centavos: 0,
      sin_dato: true, motivo: "sin_integracion", leyenda: "sin restar devoluciones",
    },
  });
  assert.deepEqual(DB.pos.objetivo_cierres, [cierre]);
  assert.deepEqual(DB.pos.objetivos, antes.objetivos);
  assert.deepEqual(DB.pos.objetivo_capturas, antes.objetivo_capturas);
  assert.deepEqual(DB.pos.objetivo_plantilla, antes.objetivo_plantilla);
});

for (const origen of ["meta", "registro"]) {
  test(`solo una ${origen} de actividad sin plantilla basta para participar y exigir SICAR`, async () => {
    const DB = prepararDB();
    if (origen === "meta") fijarActividad(DB, 1, "iglesia", 3);
    else await registrar(DB, 1);
    DB.pos.vendedores[0].activo = false;
    DB.pos.vendedores[0].sucursal_id = 2;
    const antes = structuredClone(DB);
    assert.throws(() => cerrarRevisado(DB, { ...MES, reales: [] }, ADMINISTRADORA), /falta.*real|SICAR/i);
    assert.deepEqual(DB, antes, "rechazar el cierre incompleto no escribe nada");
    const esperado = actividadesVacias();
    if (origen === "meta") esperado[2].meta = 3;
    else esperado[0].declaradas = 1;
    assert.deepEqual(previoCierre(DB, MES).lineas, [
      { vendedor_id: 1, nombre: "Juan", meta: 0, capturado: 0, marcas: [], productos: [], creditos: [], actividades: esperado },
    ]);
    const cierre = cerrarRevisado(DB, { ...MES, reales: [{ vendedor_id: 1, real_sicar: 0 }] }, ADMINISTRADORA);
    assert.deepEqual(cierre.lineas, [
      { vendedor_id: 1, meta: 0, capturado: 0, real_sicar: 0, diferencia: 0, marcas: [], productos: [], creditos: [], actividades: esperado },
    ]);
    assert.deepEqual(cierre.foto.plantilla, []);
  });
}

test("el previo filtra actividades por mes, tienda y vigencia sin duplicar participantes", async () => {
  const DB = prepararDB();
  fijarActividad(DB, null, "iglesia", 10);
  const vieja = fijarActividad(DB, 1, "iglesia", 9);
  vieja.vigente = false;
  const anulada = await registrar(DB, 1);
  anularActividad(DB, anulada.id, "Registro equivocado", VICTOR);
  fijarActividad(DB, 9, "grupos", 5, { ...MES, sucursal_id: 2 });
  await registrar(DB, 9, { sucursal_id: 2 });
  const otroMes = { mes: "2026-08", sucursal_id: 1 };
  fijarActividad(DB, 1, "iglesia", 8, otroMes);
  await registrar(DB, 1, { ...otroMes, fecha: "2026-08-03", link: "https://facebook.com/agosto" });
  assert.deepEqual(previoCierre(DB, MES).lineas, [], "ni anuladas, ni metas de tienda ni otros periodos agregan personas");

  fijarActividad(DB, 2, "iglesia", 7);
  fijarActividad(DB, 2, "iglesia", 3);
  fijarActividad(DB, 2, "grupos", 4);
  await registrar(DB, 2);
  registrarEnPlantilla(DB, { ...MES, vendedor_id: 2 });
  const antes = structuredClone(DB);
  const actividades = [
    { actividad: "grupos", meta: 4, declaradas: 1, conjuntas: 0 },
    { actividad: "marketplace", meta: 0, declaradas: 0, conjuntas: 0 },
    { actividad: "iglesia", meta: 3, declaradas: 0, conjuntas: 0 },
    { actividad: "volanteo", meta: 0, declaradas: 0, conjuntas: 0 },
  ];
  assert.deepEqual(previoCierre(DB, MES).lineas, [{ vendedor_id: 2, nombre: "Maria", meta: 0, capturado: 0, marcas: [], productos: [], creditos: [], actividades }]);
  assert.deepEqual(DB, antes, "el previo de actividades tampoco escribe");
  const cierre = cerrarRevisado(DB, { ...MES, reales: [{ vendedor_id: 2, real_sicar: 0 }] }, ADMINISTRADORA);
  assert.deepEqual(cierre.lineas[0].actividades, actividades);
});

test("el sello conserva actividades vigentes y anuladas, evidencia y todos sus resultados con copia profunda", async () => {
  const DB = prepararMes();
  const vigente = await registrar(DB, 1);
  agregarResultado(DB, vigente.id, { contactos: 3, cotizaciones: 1, nota: "Primer contacto" }, VICTOR);
  agregarResultado(DB, vigente.id, { contactos: 5, cotizaciones: 2, nota: "Seguimiento" }, VICTOR);
  const anulada = await registrar(DB, 2);
  agregarResultado(DB, anulada.id, { contactos: 1, cotizaciones: 0 }, VICTOR);
  anularActividad(DB, anulada.id, "Publicación equivocada", VICTOR);
  await registrar(DB, 9, { sucursal_id: 2 });
  await registrar(DB, 1, { mes: "2026-08", fecha: "2026-08-03", link: "https://facebook.com/agosto" });
  const esperadas = structuredClone([vigente, anulada]);
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  assert.deepEqual(cierre.foto.actividades, esperadas, "incluye anuladas y excluye otros meses y tiendas");
  assert.deepEqual(cierre.lineas[0].actividades[0], { actividad: "grupos", meta: 0, declaradas: 1, conjuntas: 0 });
  assert.deepEqual(cierre.lineas[1].actividades, actividadesVacias());
  const sellado = structuredClone(cierre);

  vigente.vigente = false;
  vigente.anulado_por = "Cambio posterior";
  vigente.anulado_en = "2026-10-03T18:30:00.000Z";
  vigente.motivo_anulacion = "Anulación posterior al sello";
  vigente.evidencia.link = "https://facebook.com/cambiado";
  vigente.resultados[0].contactos = 999;
  vigente.resultados.push({ contactos: 50, cotizaciones: 30 });
  anulada.resultados[0].cotizaciones = 99;
  DB.pos.objetivo_actividades.push({ ...vigente, id: 100 });
  assert.deepEqual(cierre, sellado, "ni evidencia, anulación, resultados ni altas posteriores alteran el sello");
});

test("la foto de objetivos ya incluye metas de actividad vigentes de tienda y persona", () => {
  const DB = prepararMes();
  fijarActividad(DB, 1, "grupos", 9);
  const vigente = fijarActividad(DB, 1, "grupos", 4);
  const tienda = fijarActividad(DB, null, "iglesia", 3);
  fijarActividad(DB, 9, "grupos", 8, { ...MES, sucursal_id: 2 });
  fijarActividad(DB, null, "iglesia", 5, { ...MES, mes: "2026-08" });
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  assert.deepEqual(cierre.foto.objetivos.filter((o) => o.tipo === "actividad"), [vigente, tienda]);
  const sellado = structuredClone(cierre);
  vigente.monto = 100;
  vigente.vigente = false;
  tienda.monto = 200;
  assert.deepEqual(cierre, sellado);
});

for (const anularOriginal of [false, true]) {
  test(`el cierre cuenta la conjunta una vez en tienda, original anulada: ${anularOriginal}`, async () => {
    const DB = prepararMes();
    const original = await registrar(DB, 1);
    await registrar(DB, 2, { link: original.evidencia.link, conjunta: true });
    if (anularOriginal) anularActividad(DB, original.id, "Anulo mi registro", VICTOR);
    const previo = previoCierre(DB, MES).lineas;
    const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
    assert.deepEqual(cierre.resumen_actividades_tienda, [
      { actividad: "grupos", etiqueta: "Publicación en grupos", declaradas: 1, conjuntas: 1 },
      { actividad: "marketplace", etiqueta: "Publicación en Marketplace", declaradas: 0, conjuntas: 0 },
      { actividad: "iglesia", etiqueta: "Salida a iglesia", declaradas: 0, conjuntas: 0 },
      { actividad: "volanteo", etiqueta: "Jornada de volanteo", declaradas: 0, conjuntas: 0 },
    ]);
    assert.deepEqual(cierre.lineas.map((l) => l.actividades), previo.map((l) => l.actividades));
    assert.deepEqual(cierre.lineas.map((l) => l.actividades[0]), [
      { actividad: "grupos", meta: 0, declaradas: anularOriginal ? 0 : 1, conjuntas: anularOriginal ? 0 : 1 },
      { actividad: "grupos", meta: 0, declaradas: 1, conjuntas: 1 },
    ]);
  });
}

test("las actividades no alteran meta de venta, capturado, real SICAR ni diferencia y no son rectificables", async () => {
  const DB = prepararMes();
  fijarActividad(DB, 1, "grupos", 500);
  await registrar(DB, 1);
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  assert.deepEqual(cierre.lineas.map(({ meta, capturado, real_sicar, diferencia }) => ({ meta, capturado, real_sicar, diferencia })), [
    { meta: 100000, capturado: 100000, real_sicar: 85000, diferencia: 15000 },
    { meta: 80000, capturado: 20000, real_sicar: 25000, diferencia: -5000 },
  ]);
  const sellado = structuredClone(cierre);
  assert.throws(() => rectificarCierre(DB, cierre.id, {
    vendedor_id: 1, campo: "actividades", valor_nuevo: 5, motivo: "Intento de cambiar actividades",
  }, ADMINISTRADORA), /solo se puede rectificar/i);
  assert.deepEqual(cierre, sellado);
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
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
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
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);

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
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);

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
  cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  assert.throws(() => rectificarCierre(DB, 9999, {
    vendedor_id: 1, campo: "real_sicar", valor_nuevo: 1, motivo: "x",
  }, ADMINISTRADORA), /no existe/i);
});

test("no se rectifica sin motivo", () => {
  const DB = prepararMes();
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesDelMes() }, ADMINISTRADORA);
  for (const motivo of [undefined, null, "", "   "]) {
    assert.throws(() => rectificarCierre(DB, cierre.id, {
      vendedor_id: 1, campo: "real_sicar", valor_nuevo: 73000, motivo,
    }, ADMINISTRADORA), /motivo/i, `dejo pasar motivo ${JSON.stringify(motivo)}`);
  }
  assert.equal(cierre.rectificaciones.length, 0, "un numero cambiado sin explicacion es lo que estamos evitando");
});

function prepararNuevos() {
  const DB = prepararMes();
  altaElemento(DB, "marcas", { nombre: "Yamaha" }, VICTOR);
  altaElemento(DB, "productos", { nombre: "Teclados" }, VICTOR);
  for (const llave of [
    { tipo: "marca", marca_id: 1, monto: 100 },
    { tipo: "producto", producto_meta_id: 1, monto: 5 },
    { tipo: "credito", financiera: "coppel_pay", monto: 3 },
  ]) fijarObjetivo(DB, { ...MES, vendedor_id: 1, ...llave }, VICTOR);
  conRelojEn("2026-10-02T18:30:00.000Z", () => {
    for (const llave of [
      { tipo: "marca", marca_id: 1, monto: 80.5 },
      { tipo: "producto", producto_meta_id: 1, monto: 4 },
    ]) capturarDia(DB, { ...MES, fecha: "2026-09-03", vendedor_id: 1, ...llave }, VICTOR);
    registrarCredito(DB, {
      ...MES, fecha: "2026-09-03", vendedor_id: 1, financiera: "coppel_pay", folio: "CP-123", monto: 100,
    }, VICTOR);
  });
  return DB;
}

function realesNuevos() {
  return [
    { vendedor_id: 1, real_sicar: 85000, marcas: [{ marca_id: "1", real: 70.25 }],
      productos: [{ producto_meta_id: "1", real: 5 }], creditos: [{ financiera: "coppel_pay", real: 0 }] },
    { vendedor_id: 2, real_sicar: 25000 },
  ];
}

test("la diferencia de marcas se guarda en centavos exactos, sin residuos de decimales", () => {
  const DB = prepararNuevos();
  const reales = realesNuevos();
  reales[0].marcas = [{ marca_id: 1, real: 70.2 }];
  // 80.5 - 70.2 en binario da 10.299999999999997: la pantalla diría "$0.00 más" en vez de cuadrar.
  const cierre = cerrarRevisado(DB, { ...MES, reales }, ADMINISTRADORA);
  assert.equal(cierre.lineas[0].marcas[0].diferencia, 10.3);
});

test("el previo cruza las tres familias sin mutar y el cierre guarda sus diferencias", () => {
  const DB = prepararNuevos();
  const antes = structuredClone(DB);
  const linea = previoCierre(DB, MES).lineas[0];
  assert.deepEqual(linea.marcas, [{ marca_id: 1, nombre: "Yamaha", meta: 100, capturado: 80.5 }]);
  assert.deepEqual(linea.productos, [{ producto_meta_id: 1, nombre: "Teclados", meta: 5, capturado: 4 }]);
  assert.deepEqual(linea.creditos, [{ financiera: "coppel_pay", meta: 3, registrados: 1 }]);
  assert.deepEqual(DB, antes);
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesNuevos() }, ADMINISTRADORA);
  assert.deepEqual(cierre.lineas[0].marcas, [{ ...linea.marcas[0], real: 70.25, diferencia: 10.25 }]);
  assert.deepEqual(cierre.lineas[0].productos, [{ ...linea.productos[0], real: 5, diferencia: -1 }]);
  assert.deepEqual(cierre.lineas[0].creditos, [{ ...linea.creditos[0], real: 0, diferencia: 1 }]);
});

for (const [lista, referencia] of [["marcas", "marca_id"], ["productos", "producto_meta_id"], ["creditos", "financiera"]]) {
  test(`cerrar exige reales completos, únicos y válidos de ${lista} sin mutar DB`, () => {
    const DB = prepararNuevos();
    const antes = structuredClone(DB);
    const bueno = realesNuevos()[0][lista][0];
    const invalidos = [undefined, null, {}, [], [null], [bueno, bueno],
      [{ ...bueno, [referencia]: referencia === "financiera" ? "atrato" : 99 }]];
    for (const real of [undefined, null, "0", false, -1, NaN, Infinity, ...(lista === "marcas" ? [] : [0.5])]) {
      invalidos.push([{ ...bueno, real }]);
    }
    for (const elementos of invalidos) {
      const reales = realesNuevos();
      reales[0][lista] = elementos;
      assert.throws(() => cerrarRevisado(DB, { ...MES, reales }, ADMINISTRADORA), /real|elemento|lista|referencia/i);
      assert.deepEqual(DB, antes);
    }
  });
}

for (const origen of ["marca", "producto", "credito", "solo_credito", "solo_producto"]) {
  test(`participa sin plantilla por ${origen}, incluso con meta o captura cero`, () => {
    const DB = prepararDB();
    altaElemento(DB, "marcas", { nombre: "Yamaha" }, VICTOR);
    altaElemento(DB, "productos", { nombre: "Teclados" }, VICTOR);
    const llaves = {
      marca: { tipo: "marca", marca_id: 1 }, producto: { tipo: "producto", producto_meta_id: 1 },
      credito: { tipo: "credito", financiera: "atrato" },
    };
    if (llaves[origen]) fijarObjetivo(DB, { ...MES, vendedor_id: 1, monto: 0, ...llaves[origen] }, VICTOR);
    else conRelojEn("2026-10-02T18:30:00.000Z", () => {
      const datos = { ...MES, vendedor_id: 1, fecha: "2026-09-03" };
      if (origen === "solo_credito") registrarCredito(DB, { ...datos, financiera: "atrato", folio: "AT123", monto: 50 }, VICTOR);
      else capturarDia(DB, { ...datos, tipo: "producto", producto_meta_id: 1, monto: 0 }, VICTOR);
    });
    DB.pos.vendedores[0].activo = false;
    DB.pos.vendedores[0].sucursal_id = 2;
    const previo = previoCierre(DB, MES).lineas;
    assert.deepEqual(previo.map((l) => l.vendedor_id), [1]);
    assert.equal([...previo[0].marcas, ...previo[0].productos, ...previo[0].creditos].length, 1);
    const antes = structuredClone(DB);
    assert.throws(() => cerrarRevisado(DB, { ...MES, reales: [{ vendedor_id: 1, real_sicar: 0 }] }, VICTOR), /real/i);
    assert.deepEqual(DB, antes);
  });
}

test("el sello congela créditos vigentes y anulados y nombres de listas incluso inactivos", () => {
  const DB = prepararNuevos();
  const anulado = conRelojEn("2026-10-02T18:30:00.000Z", () => registrarCredito(DB, {
    ...MES, fecha: "2026-09-03", vendedor_id: 2, financiera: "atrato", folio: "AT123", monto: 10,
  }, VICTOR));
  anularCredito(DB, anulado.id, "Error", VICTOR);
  desactivarElemento(DB, "productos", 1, { motivo: "Ya no se usa" }, VICTOR);
  const cierre = cerrarRevisado(DB, { ...MES, reales: realesNuevos() }, ADMINISTRADORA);
  assert.deepEqual(cierre.foto.creditos, DB.pos.objetivo_creditos);
  assert.deepEqual(cierre.foto.marcas, [{ id: 1, nombre: "Yamaha" }]);
  assert.deepEqual(cierre.foto.productos, [{ id: 1, nombre: "Teclados" }]);
  const sellado = structuredClone(cierre);
  anularCredito(DB, 1, "Anulación posterior", VICTOR);
  desactivarElemento(DB, "marcas", 1, { motivo: "Cambio" }, VICTOR);
  DB.pos.objetivo_marcas[0].nombre = "Otro nombre";
  DB.pos.objetivo_productos[0].nombre = "Otro producto";
  assert.deepEqual(cierre, sellado);
});

for (const [referencia, valor, lista, capturado] of [
  ["marca_id", "1", "marcas", 80.5], ["producto_meta_id", "1", "productos", 4],
  ["financiera", "coppel_pay", "creditos", 1],
]) {
  test(`rectifica ${referencia} desde el sello sin alterar líneas ni foto`, () => {
    const DB = prepararNuevos();
    const cierre = cerrarRevisado(DB, { ...MES, reales: realesNuevos() }, ADMINISTRADORA);
    const sellado = structuredClone(cierre);
    for (const campo of ["real", "meta", "capturado"]) {
      const r = rectificarCierre(DB, cierre.id, {
        vendedor_id: "1", campo, [referencia]: valor, valor_nuevo: 2, valor_anterior: 999, motivo: " Corrección ",
      }, ADMINISTRADORA);
      assert.equal(r[referencia], referencia === "financiera" ? valor : Number(valor));
      assert.equal(r.valor_anterior, campo === "capturado" ? capturado : sellado.lineas[0][lista][0][campo]);
      assert.equal(r.valor_nuevo, 2);
      assert.equal(r.motivo, "Corrección");
      assert.equal(r.rectificado_por, "Administración");
    }
    assert.deepEqual(cierre.lineas, sellado.lineas);
    assert.deepEqual(cierre.foto, sellado.foto);
    const antes = structuredClone(DB);
    for (const extra of [
      { motivo: "" }, { campo: "real_sicar" }, { [referencia]: referencia === "financiera" ? "atrato" : 99 },
      { valor_nuevo: -1 }, { valor_nuevo: "1" }, { marca_id: 1, producto_meta_id: 1 },
      ...(referencia === "marca_id" ? [] : [{ valor_nuevo: 1.5 }]),
    ]) {
      assert.throws(() => rectificarCierre(DB, cierre.id, {
        vendedor_id: 1, campo: "real", [referencia]: valor, valor_nuevo: 1, motivo: "Error", ...extra,
      }, VICTOR));
      assert.deepEqual(DB, antes);
    }
  });
}

test("cierre histórico sin campos nuevos conserva la rectificación de venta", () => {
  const DB = prepararDB();
  const cierre = { id: 1, ...MES, lineas: [{ vendedor_id: 1, meta: 100, capturado: 90, real_sicar: 80, diferencia: 10 }],
    foto: { objetivos: [], capturas: [], plantilla: [] }, rectificaciones: [] };
  DB.pos.objetivo_cierres.push(cierre);
  const antes = structuredClone(cierre);
  const r = rectificarCierre(DB, "1", { vendedor_id: "1", campo: "real_sicar", valor_nuevo: 70, motivo: "Error" }, VICTOR);
  assert.equal(r.valor_anterior, 80);
  assert.deepEqual(cierre.lineas, antes.lineas);
  assert.deepEqual(cierre.foto, antes.foto);
  assert.throws(() => rectificarCierre(DB, 1, {
    vendedor_id: 1, campo: "real", marca_id: 1, valor_nuevo: 0, motivo: "Error",
  }, VICTOR));
});

test("el cierre conserva la lista de metas eliminadas del mes, con quién, cuándo y por qué", () => {
  const { retirarObjetivo } = require("./objetivos");
  const { metasRetiradasDelMes } = require("./objetivosCierre");
  const DB = prepararDB();
  registrarEnPlantilla(DB, { ...MES, vendedor_id: 1 });
  const marca = altaElemento(DB, "marcas", { nombre: "Yamaha" }, VICTOR);
  fijarObjetivo(DB, { ...MES, tipo: "venta", vendedor_id: 1, monto: 5000 }, VICTOR);
  fijarObjetivo(DB, { ...MES, tipo: "marca", marca_id: marca.id, vendedor_id: null, monto: 800 }, VICTOR);
  fijarObjetivo(DB, { ...MES, tipo: "venta", vendedor_id: 9, sucursal_id: 2, monto: 1 }, VICTOR);
  retirarObjetivo(DB, { ...MES, tipo: "venta", vendedor_id: 1, motivo: "No llegaba" }, { id: 7, nombre: "Gerente" });
  retirarObjetivo(DB, { ...MES, tipo: "marca", marca_id: marca.id, vendedor_id: null, motivo: "Sin stock" }, VICTOR);
  retirarObjetivo(DB, { mes: "2026-09", sucursal_id: 2, tipo: "venta", vendedor_id: 9, motivo: "otra tienda" }, VICTOR);

  const retiradas = metasRetiradasDelMes(DB, MES);
  assert.deepStrictEqual(retiradas.map((r) => [r.elemento, r.vendedor_id, r.monto, r.retirada.por_nombre, r.retirada.motivo]), [
    ["Venta", 1, 5000, "Gerente", "No llegaba"],
    ["Marca: Yamaha", null, 800, "Victor", "Sin stock"],
  ]);

  const cierre = cerrarRevisado(DB, { ...MES, reales: [{ vendedor_id: 1, real_sicar: 0 }] }, ADMINISTRADORA);
  assert.deepStrictEqual(cierre.retiradas.map((r) => r.elemento), ["Venta", "Marca: Yamaha"]);
  DB.pos.objetivos.find((o) => o.retirada?.motivo === "No llegaba").retirada.motivo = "cambiado después";
  assert.strictEqual(cierre.retiradas[0].retirada.motivo, "No llegaba");
});

// --- Venta SICAR de la tienda en el previo y el sello (F1, Task 4) ---

function sqliteSicar(t, { mostrador = 10000, cliente = null } = {}) {
  const Database = require("better-sqlite3");
  const { crearRepositorioSicar } = require("./sicarRepositorio");
  const sqlite = new Database(":memory:");
  t.after(() => sqlite.close());
  crearRepositorioSicar(sqlite);
  sqlite.prepare("INSERT INTO sicar_tiendas(sucursal_id) VALUES (1)").run();
  sqlite.prepare("INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1, 'c1', 'Cliente')").run();
  sqlite.prepare(`INSERT INTO sicar_ventas_mostrador (sucursal_id, ven_id, fecha_local, estado, total_centavos, actualizado_en)
    VALUES (1, 'm1', '2026-09-10T10:00:00', 'vigente', ?, 'x')`).run(mostrador);
  if (cliente !== null) {
    sqlite.prepare(`INSERT INTO sicar_ventas (sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
      VALUES (1, 'v1', 'c1', '2026-09-12T10:00:00', 'vigente', ?, 'r', 'h')`).run(cliente);
  }
  return sqlite;
}

function cerrarConSicar(DB, sqlite, extra = {}) {
  const previo = previoCierre(DB, MES, { sqlite });
  return cerrarMes(DB, { ...MES, reales: realesDelMes(), huella: previo.huella, ...extra }, VICTOR, "2026-10-01", { sqlite });
}

test("el previo trae la venta SICAR de la tienda y la sella", (t) => {
  const sqlite = sqliteSicar(t);
  const DB = prepararMes();
  const previo = previoCierre(DB, MES, { sqlite });
  assert.strictEqual(previo.tienda_sicar.venta_centavos, 10000);
  assert.strictEqual(previo.tienda_sicar.sin_dato, false);
  assert.strictEqual(previo.tienda_sicar.leyenda, "sin restar devoluciones");
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes(), huella: previo.huella }, VICTOR, "2026-10-01", { sqlite });
  assert.deepStrictEqual(cierre.tienda_sicar, previo.tienda_sicar);
  assert.deepStrictEqual(DB.pos.objetivo_cierres[0].tienda_sicar, previo.tienda_sicar);
});

test("marcar una cuenta interna despues del previo cambia la huella y el sello da 409", (t) => {
  const sqlite = sqliteSicar(t, { cliente: 7000 });
  const DB = prepararMes();
  const previo = previoCierre(DB, MES, { sqlite });
  assert.strictEqual(previo.tienda_sicar.venta_centavos, 17000);
  sqlite.prepare(`INSERT INTO sicar_internas(sucursal_id, cli_id, motivo, usuario_id, fecha_hora)
    VALUES (1, 'c1', 'Bodega', 1, '2026-10-01T10:00:00Z')`).run();
  const datos = { ...MES, reales: realesDelMes(), huella: previo.huella };
  assert.throws(() => cerrarMes(DB, datos, VICTOR, "2026-10-01", { sqlite }), { status: 409 });
  assert.strictEqual(DB.pos.objetivo_cierres.length, 0);
  const nuevo = previoCierre(DB, MES, { sqlite });
  assert.notStrictEqual(nuevo.huella, previo.huella);
  assert.strictEqual(nuevo.tienda_sicar.venta_centavos, 10000);
  assert.strictEqual(nuevo.tienda_sicar.internas_centavos, 7000);
  // Desmarcar también cambia la huella.
  sqlite.prepare("DELETE FROM sicar_internas WHERE sucursal_id = 1 AND cli_id = 'c1'").run();
  assert.throws(() => cerrarMes(DB, { ...datos, huella: nuevo.huella }, VICTOR, "2026-10-01", { sqlite }), { status: 409 });
  assert.strictEqual(DB.pos.objetivo_cierres.length, 0);
  const cierre = cerrarMes(DB, { ...datos, huella: previoCierre(DB, MES, { sqlite }).huella }, VICTOR, "2026-10-01", { sqlite });
  assert.strictEqual(cierre.tienda_sicar.venta_centavos, 17000);
});

test("el cuerpo no puede mandar tienda_sicar", (t) => {
  const sqlite = sqliteSicar(t);
  const DB = prepararMes();
  const mandado = { venta_centavos: 1, sin_dato: false };
  const cierre = cerrarConSicar(DB, sqlite, { tienda_sicar: mandado, tienda_sicar_actual: mandado });
  assert.strictEqual(cierre.tienda_sicar.venta_centavos, 10000);
  assert.strictEqual(cierre.tienda_sicar_actual, undefined);
  assert.strictEqual(DB.pos.objetivo_cierres[0].tienda_sicar.venta_centavos, 10000);
});

test("sin sqlite el previo dice sin_integracion y el cierre funciona como hoy", () => {
  const DB = prepararMes();
  const previo = previoCierre(DB, MES);
  assert.strictEqual(previo.tienda_sicar.sin_dato, true);
  assert.strictEqual(previo.tienda_sicar.motivo, "sin_integracion");
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes(), huella: previo.huella }, VICTOR, "2026-10-01");
  assert.strictEqual(cierre.tienda_sicar.motivo, "sin_integracion");
  assert.strictEqual(cierre.lineas.length, 2);
  assert.strictEqual(cierre.lineas[0].diferencia, 15000);
});

test("cierre sellado muestra la diferencia si SICAR cambio despues", (t) => {
  const { conTiendaSicarActual } = require("./objetivosCierre");
  // El mostrador sigue vigente para que la tienda conserve dato; la venta cancelada es la de 10000.
  const sqlite = sqliteSicar(t, { mostrador: 2500, cliente: 10000 });
  const DB = prepararMes();
  const cierre = cerrarConSicar(DB, sqlite);
  const sellado = structuredClone(cierre.tienda_sicar);
  assert.strictEqual(sellado.venta_centavos, 12500);
  assert.strictEqual(conTiendaSicarActual(cierre, sqlite).tienda_sicar_diferencia_centavos, 0);
  sqlite.prepare("UPDATE sicar_ventas SET estado = 'cancelada' WHERE ven_id = 'v1'").run();
  const respuesta = conTiendaSicarActual(cierre, sqlite);
  assert.strictEqual(respuesta.tienda_sicar_diferencia_centavos, -10000);
  assert.strictEqual(respuesta.tienda_sicar_actual.venta_centavos, 2500);
  assert.deepStrictEqual(respuesta.tienda_sicar, sellado);
  assert.deepStrictEqual(DB.pos.objetivo_cierres[0].tienda_sicar, sellado);
  // Si hoy SICAR no tiene dato, la diferencia es 0, nunca un número inventado.
  sqlite.prepare("UPDATE sicar_ventas_mostrador SET estado = 'cancelada'").run();
  const sinDato = conTiendaSicarActual(cierre, sqlite);
  assert.strictEqual(sinDato.tienda_sicar_actual.motivo, "sin_mostrador");
  assert.strictEqual(sinDato.tienda_sicar_diferencia_centavos, 0);
  // Cierres viejos sin tienda_sicar salen idénticos.
  const viejo = { id: 9, ...MES, lineas: [], rectificaciones: [] };
  assert.strictEqual(conTiendaSicarActual(viejo, sqlite), viejo);
});

test("si SICAR lanza, el previo y el cierre siguen con error_sicar y se reporta", (t) => {
  const { conTiendaSicarActual } = require("./objetivosCierre");
  const Sentry = require("@sentry/node");
  const captura = t.mock.method(Sentry, "captureException", () => {});
  const roto = { prepare() { throw new Error("disco SICAR caido"); } };
  const DB = prepararMes();
  const previo = previoCierre(DB, MES, { sqlite: roto });
  assert.deepStrictEqual(previo.tienda_sicar, { sin_dato: true, motivo: "error_sicar" });
  const cierre = cerrarMes(DB, { ...MES, reales: realesDelMes(), huella: previo.huella }, VICTOR, "2026-10-01", { sqlite: roto });
  assert.deepStrictEqual(cierre.tienda_sicar, { sin_dato: true, motivo: "error_sicar" });
  assert.strictEqual(captura.mock.callCount(), 2);
  assert.strictEqual(captura.mock.calls[0].arguments[0].message, "disco SICAR caido");
  assert.strictEqual(conTiendaSicarActual(cierre, roto).tienda_sicar_diferencia_centavos, 0);
});

test("tienda_sicar no se puede rectificar", (t) => {
  const sqlite = sqliteSicar(t);
  const DB = prepararMes();
  const cierre = cerrarConSicar(DB, sqlite);
  for (const campo of ["tienda_sicar", "venta_centavos"]) {
    assert.throws(() => rectificarCierre(DB, cierre.id, { vendedor_id: 1, campo, valor_nuevo: 1, motivo: "x" }, VICTOR),
      /Solo se puede rectificar/);
  }
  assert.strictEqual(cierre.tienda_sicar.venta_centavos, 10000);
  assert.strictEqual(cierre.rectificaciones.length, 0);
});
