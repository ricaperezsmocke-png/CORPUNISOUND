const { test } = require("node:test");
const assert = require("node:assert");
const {
  capturarDia,
  corregirCaptura,
  capturadoDelMes,
  diasSinCapturar,
} = require("./objetivosCaptura");

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

test("capturar el dia deja quien y cuando", () => {
  const DB = prepararDB();
  const captura = conRelojEn("2026-09-13T18:30:00.000Z", () =>
    capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-13", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 12000,
    }, VICTOR)
  );

  assert.deepEqual(captura, {
    id: 1,
    mes: "2026-09",
    fecha: "2026-09-13",
    sucursal_id: 1,
    vendedor_id: 1,
    tipo: "venta",
    monto: 12000,
    capturado_por: "Victor",
    capturado_en: "2026-09-13T18:30:00.000Z",
    corrige_a: null,
    vigente: true,
  });
});

test("CERO es una captura valida: no es lo mismo que no capturar", () => {
  const DB = prepararDB();
  const captura = conRelojEn("2026-09-05T18:30:00.000Z", () =>
    capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 0,
    }, VICTOR)
  );

  assert.equal(captura.monto, 0, "el cero debe quedar guardado tal cual");
  assert.equal(DB.pos.objetivo_capturas.length, 1);
  assert.ok(
    !diasSinCapturar(DB, {
      mes: "2026-09", sucursal_id: 1, vendedor_id: 1, hasta: "2026-09-05",
    }).includes("2026-09-03"),
    "el dia con cero fue capturado y no debe aparecer como faltante"
  );
});

test("una fecha FUTURA se rechaza y no escribe nada", () => {
  const DB = prepararDB();

  conRelojEn("2026-09-13T18:30:00.000Z", () => {
    assert.throws(
      () => capturarDia(DB, {
        mes: "2026-09", fecha: "2026-09-14", sucursal_id: 1,
        vendedor_id: 1, tipo: "venta", monto: 100,
      }, VICTOR),
      /futura|adelant/i
    );
  });
  assert.equal(DB.pos.objetivo_capturas.length, 0, "el rechazo no debe dejar una captura a medias");
});

test("la fecha tiene que caer dentro del mes que dice", () => {
  const DB = prepararDB();

  conRelojEn("2026-10-02T18:30:00.000Z", () => {
    assert.throws(
      () => capturarDia(DB, {
        mes: "2026-09", fecha: "2026-10-01", sucursal_id: 1,
        vendedor_id: 1, tipo: "venta", monto: 100,
      }, VICTOR),
      /mes/i
    );
  });
  assert.equal(DB.pos.objetivo_capturas.length, 0);
});

test("corregir REEMPLAZA, no suma", () => {
  const DB = prepararDB();

  conRelojEn("2026-09-13T18:30:00.000Z", () => {
    const primera = capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-13", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 12000,
    }, VICTOR);
    const correccion = corregirCaptura(DB, primera.id, 9000, "importe correcto", VICTOR);

    assert.equal(capturadoDelMes(DB, {
      mes: "2026-09", sucursal_id: 1, vendedor_id: 1,
    }), 9000, "debe sumar 9000, nunca 21000");
    assert.notEqual(capturadoDelMes(DB, {
      mes: "2026-09", sucursal_id: 1, vendedor_id: 1,
    }), 21000);
    assert.equal(DB.pos.objetivo_capturas.length, 2, "la captura vieja sigue en la base");
    assert.equal(DB.pos.objetivo_capturas.find((x) => x.id === primera.id).vigente, false);
    assert.equal(correccion.corrige_a, primera.id);
    assert.equal(correccion.vigente, true);
  });
});

test("corregir exige un motivo de texto sin mutar la captura rechazada", () => {
  for (const motivo of [undefined, null, "", "   ", 123, {}, []]) {
    const DB = prepararDB();
    const primera = conRelojEn("2026-09-13T18:30:00.000Z", () => capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-13", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 12000,
    }, VICTOR));
    const antes = structuredClone(DB.pos.objetivo_capturas);

    assert.throws(
      () => corregirCaptura(DB, primera.id, 9000, motivo, VICTOR),
      /motivo/i,
      `dejó pasar motivo ${JSON.stringify(motivo)}`
    );
    assert.deepEqual(DB.pos.objetivo_capturas, antes);
  }
});

test("corregir guarda el motivo recortado en la captura nueva", () => {
  const DB = prepararDB();
  const primera = conRelojEn("2026-09-13T18:30:00.000Z", () => capturarDia(DB, {
    mes: "2026-09", fecha: "2026-09-13", sucursal_id: 1,
    vendedor_id: 1, tipo: "venta", monto: 12000,
  }, VICTOR));

  const nueva = corregirCaptura(DB, primera.id, 9000, "  Importe correcto  ", VICTOR);

  assert.equal(nueva.motivo, "Importe correcto");
});

test("no se puede corregir dos veces la misma captura", () => {
  const DB = prepararDB();

  conRelojEn("2026-09-13T18:30:00.000Z", () => {
    const primera = capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-13", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 12000,
    }, VICTOR);
    corregirCaptura(DB, primera.id, 9000, "importe correcto", VICTOR);

    assert.throws(
      () => corregirCaptura(DB, primera.id, 8000, "otro cambio", VICTOR),
      /vigente|corregir|corregida/i
    );
  });
  assert.equal(DB.pos.objetivo_capturas.length, 2, "la segunda correccion rechazada no debe escribir");
});

test("diasSinCapturar dice quien no ha llenado", () => {
  const DB = prepararDB();

  conRelojEn("2026-09-05T18:30:00.000Z", () => {
    for (const fecha of ["2026-09-01", "2026-09-03"]) {
      capturarDia(DB, {
        mes: "2026-09", fecha, sucursal_id: 1,
        vendedor_id: 1, tipo: "venta", monto: 100,
      }, VICTOR);
    }
  });

  assert.deepEqual(diasSinCapturar(DB, {
    mes: "2026-09", sucursal_id: 1, vendedor_id: 1, hasta: "2026-09-05",
  }), ["2026-09-02", "2026-09-04", "2026-09-05"]);
});

test("una captura marca si llego tarde", () => {
  const DB = prepararDB();
  const captura = conRelojEn("2026-09-28T18:30:00.000Z", () =>
    capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 100,
    }, VICTOR)
  );

  assert.equal(captura.fecha, "2026-09-03", "conserva el dia que se esta reportando");
  assert.equal(
    captura.capturado_en.slice(0, 10),
    "2026-09-28",
    "conserva que se escribio el dia 28 y permite mostrar el atraso"
  );
});

test("un monto invalido se rechaza sin escribir nada", () => {
  for (const malo of [-1, NaN, "abc", null, Infinity]) {
    const DB = prepararDB();
    conRelojEn("2026-09-13T18:30:00.000Z", () => {
      assert.throws(
        () => capturarDia(DB, {
          mes: "2026-09", fecha: "2026-09-13", sucursal_id: 1,
          vendedor_id: 1, tipo: "venta", monto: malo,
        }, VICTOR),
        /monto|número|numero/i,
        `dejo pasar ${JSON.stringify(malo)}`
      );
    });
    assert.equal(DB.pos.objetivo_capturas.length, 0, "no debe quedar nada escrito");
  }
});

test("no se captura para un vendedor de otra sucursal", () => {
  const DB = prepararDB();

  conRelojEn("2026-09-13T18:30:00.000Z", () => {
    assert.throws(
      () => capturarDia(DB, {
        mes: "2026-09", fecha: "2026-09-13", sucursal_id: 1,
        vendedor_id: 9, tipo: "venta", monto: 100,
      }, VICTOR),
      /sucursal|tienda/i
    );
  });
  assert.equal(DB.pos.objetivo_capturas.length, 0);
});
