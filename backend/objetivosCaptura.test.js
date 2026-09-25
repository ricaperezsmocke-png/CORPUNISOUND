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

test("una segunda captura vigente del mismo dia se rechaza sin escribir", () => {
  const DB = prepararDB();
  conRelojEn("2026-09-13T18:30:00.000Z", () => {
    const datos = {
      mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 100,
    };
    capturarDia(DB, datos, VICTOR);
    const antes = structuredClone(DB.pos.objetivo_capturas);

    assert.throws(
      () => capturarDia(DB, { ...datos, monto: 200 }, VICTOR),
      /Ya hay una captura de ese d.a; si el monto est. mal, usa Corregir/
    );
    assert.deepEqual(DB.pos.objetivo_capturas, antes);
  });
});

test("de noche en Chiapas, con el servidor en UTC (Render), el dia de MAÑANA sigue siendo futuro", () => {
  // 02:00 UTC del 15 = 20:00 del 14 en Chiapas. Un "hoy" calculado con la hora
  // del proceso dice 15 y dejaba capturar mañana todas las noches.
  const tzOriginal = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const DB = prepararDB();
    conRelojEn("2026-09-15T02:00:00.000Z", () => {
      assert.throws(
        () => capturarDia(DB, {
          mes: "2026-09", fecha: "2026-09-15", sucursal_id: 1,
          vendedor_id: 1, tipo: "venta", monto: 100,
        }, VICTOR),
        /futura|adelant/i
      );
      const deHoy = capturarDia(DB, {
        mes: "2026-09", fecha: "2026-09-14", sucursal_id: 1,
        vendedor_id: 1, tipo: "venta", monto: 100,
      }, VICTOR);
      assert.equal(deHoy.fecha, "2026-09-14");
    });
    assert.equal(DB.pos.objetivo_capturas.length, 1);
  } finally {
    if (tzOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = tzOriginal;
  }
});

test("un traslado de sucursal no abre una segunda captura del mismo dia", () => {
  // Un dia de trabajo de una persona es uno solo, este en la tienda que este.
  const DB = prepararDB();
  conRelojEn("2026-09-13T18:30:00.000Z", () => {
    capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 5000,
    }, VICTOR);
    DB.pos.vendedores.find((v) => v.id === 1).sucursal_id = 2;
    const antes = structuredClone(DB.pos.objetivo_capturas);

    assert.throws(
      () => capturarDia(DB, {
        mes: "2026-09", fecha: "2026-09-03", sucursal_id: 2,
        vendedor_id: 1, tipo: "venta", monto: 4000,
      }, VICTOR),
      /Ya hay una captura de ese d.a/
    );
    assert.deepEqual(DB.pos.objetivo_capturas, antes);
  });
});

test("el mismo dia se puede capturar para otra persona", () => {
  const DB = prepararDB();
  conRelojEn("2026-09-13T18:30:00.000Z", () => {
    capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 100,
    }, VICTOR);
    const otra = capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1,
      vendedor_id: 2, tipo: "venta", monto: 200,
    }, VICTOR);

    assert.equal(otra.vendedor_id, 2);
    assert.equal(DB.pos.objetivo_capturas.length, 2);
  });
});

test("la correccion vigente tambien impide recapturar ese dia", () => {
  const DB = prepararDB();
  conRelojEn("2026-09-13T18:30:00.000Z", () => {
    const primera = capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 100,
    }, VICTOR);
    corregirCaptura(DB, primera.id, 200, "Importe correcto", VICTOR);
    const antes = structuredClone(DB.pos.objetivo_capturas);

    assert.throws(() => capturarDia(DB, {
      mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1,
      vendedor_id: 1, tipo: "venta", monto: 300,
    }, VICTOR), /Ya hay una captura/);
    assert.deepEqual(DB.pos.objetivo_capturas, antes);
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

test("diasSinCapturar empieza cuando la persona entro a la plantilla", () => {
  const DB = prepararDB();
  DB.pos.objetivo_plantilla.push({
    id: 1, mes: "2026-09", sucursal_id: 1, vendedor_id: 1,
    desde: "2026-09-10", hasta: null,
  });

  assert.deepEqual(diasSinCapturar(DB, {
    mes: "2026-09", sucursal_id: 1, vendedor_id: 1, hasta: "2026-09-12",
  }), ["2026-09-10", "2026-09-11", "2026-09-12"]);
});

test("diasSinCapturar termina cuando la persona salio de la plantilla", () => {
  const DB = prepararDB();
  DB.pos.objetivo_plantilla.push({
    id: 1, mes: "2026-09", sucursal_id: 1, vendedor_id: 1,
    desde: "2026-09-01", hasta: "2026-09-20",
  });

  const faltantes = diasSinCapturar(DB, {
    mes: "2026-09", sucursal_id: 1, vendedor_id: 1, hasta: "2026-09-25",
  });
  assert.equal(faltantes.at(-1), "2026-09-20");
  assert.equal(faltantes.includes("2026-09-21"), false);
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

test("la plantilla del traslado decide la tienda de cada dia y conserva la regla sin plantilla", () => {
  const DB = prepararDB();
  DB.pos.vendedores.find((v) => v.id === 1).sucursal_id = 2;
  DB.pos.objetivo_plantilla.push(
    { id: 1, mes: "2026-09", sucursal_id: 1, vendedor_id: 1, desde: "2026-09-01", hasta: "2026-09-15" },
    { id: 2, mes: "2026-09", sucursal_id: 2, vendedor_id: 1, desde: "2026-09-16", hasta: null }
  );
  conRelojEn("2026-09-20T18:30:00.000Z", () => {
    assert.equal(capturarDia(DB, { mes: "2026-09", fecha: "2026-09-10", sucursal_id: 1, vendedor_id: 1, tipo: "venta", monto: 100 }, VICTOR).sucursal_id, 1);
    assert.throws(() => capturarDia(DB, { mes: "2026-09", fecha: "2026-09-11", sucursal_id: 2, vendedor_id: 1, tipo: "venta", monto: 100 }, VICTOR), /Ese d.a no est.s en la plantilla de esta tienda/);
    assert.equal(capturarDia(DB, { mes: "2026-09", fecha: "2026-09-16", sucursal_id: 2, vendedor_id: 1, tipo: "venta", monto: 100 }, VICTOR).sucursal_id, 2);
    assert.throws(() => capturarDia(DB, { mes: "2026-09", fecha: "2026-09-17", sucursal_id: 1, vendedor_id: 1, tipo: "venta", monto: 100 }, VICTOR), /Ese d.a no est.s en la plantilla de esta tienda/);
  });
  assert.equal(diasSinCapturar(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1, hasta: "2026-09-20" }).includes("2026-09-10"), false);
  assert.equal(diasSinCapturar(DB, { mes: "2026-09", sucursal_id: 2, vendedor_id: 1, hasta: "2026-09-20" }).some((f) => f < "2026-09-16"), false);
  assert.throws(() => capturarDia(DB, { mes: "2026-08", fecha: "2026-08-10", sucursal_id: 1, vendedor_id: 1, tipo: "venta", monto: 1 }, VICTOR), /sucursal|tienda/i);
});

test("diasSinCapturar une dos periodos de la misma tienda", () => {
  const DB = prepararDB();
  DB.pos.objetivo_plantilla.push(
    { id: 1, mes: "2026-09", sucursal_id: 1, vendedor_id: 1, desde: "2026-09-01", hasta: "2026-09-10" },
    { id: 2, mes: "2026-09", sucursal_id: 2, vendedor_id: 1, desde: "2026-09-11", hasta: "2026-09-19" },
    { id: 3, mes: "2026-09", sucursal_id: 1, vendedor_id: 1, desde: "2026-09-20", hasta: null }
  );
  assert.deepEqual(diasSinCapturar(DB, { mes: "2026-09", sucursal_id: 1, vendedor_id: 1, hasta: "2026-09-22" }), [
    ...Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`),
    "2026-09-20", "2026-09-21", "2026-09-22",
  ]);
});

const { capturadoDelMesPor } = require("./objetivosCaptura");
const { desactivarElemento } = require("./objetivosCatalogos");
const DIA = { mes: "2026-09", fecha: "2026-09-03", sucursal_id: 1, vendedor_id: 1 };

function prepararCatalogos() {
  const DB = prepararDB();
  DB.pos.objetivo_marcas = [
    { id: 1, nombre: "Yamaha", activo: true },
    { id: 2, nombre: "Casio", activo: true },
  ];
  DB.pos.objetivo_productos = [
    { id: 1, nombre: "Teclados", activo: true },
    { id: 2, nombre: "Guitarras eléctricas", activo: true },
  ];
  return DB;
}

function sembrarCaptura(DB, datos) {
  const captura = {
    ...DIA, id: DB.pos.objetivo_capturas.length + 1, tipo: "venta", monto: 100,
    capturado_por: "Juan", capturado_en: "2026-09-03T18:00:00.000Z",
    corrige_a: null, vigente: true, ...datos,
  };
  DB.pos.objetivo_capturas.push(captura);
  return captura;
}

function rechazaSinCambios(DB, accion, error) {
  const antes = structuredClone(DB);
  assert.throws(accion, error);
  assert.deepEqual(DB, antes);
}

test("marca acepta pesos decimales, ids de texto y dos referencias el mismo día", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, {});
  const yamaha = capturarDia(DB, {
    ...DIA, sucursal_id: "1", vendedor_id: "1", tipo: "marca", marca_id: "1", monto: 60.25,
  }, VICTOR);
  const casio = capturarDia(DB, { ...DIA, tipo: "marca", marca_id: 2, monto: 39.75 }, VICTOR);
  assert.equal(yamaha.marca_id, 1);
  assert.equal(yamaha.vendedor_id, 1);
  assert.equal(yamaha.sucursal_id, 1);
  assert.equal(yamaha.monto, 60.25);
  assert.equal(yamaha.capturado_por, "Victor");
  assert.equal(casio.marca_id, 2);
  rechazaSinCambios(DB, () => capturarDia(DB, {
    ...DIA, tipo: "marca", marca_id: "1", monto: 0,
  }, VICTOR), /Ya hay una captura/);
});

test("marca exige venta vigente de esa persona y ese día, incluso para cero", () => {
  for (const ajena of [null, { vendedor_id: 2 }, { fecha: "2026-09-02" }, { vigente: false }]) {
    const DB = prepararCatalogos();
    if (ajena) sembrarCaptura(DB, ajena);
    rechazaSinCambios(DB, () => capturarDia(DB, {
      ...DIA, tipo: "marca", marca_id: 1, monto: 0,
    }, VICTOR), { message: "Primero captura tu venta de ese día" });
  }
});

test("dos marcas no pueden superar juntas la venta vigente", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, { monto: 200, vigente: false });
  sembrarCaptura(DB, { monto: 100, corrige_a: 1 });
  sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 60 });
  rechazaSinCambios(DB, () => capturarDia(DB, {
    ...DIA, tipo: "marca", marca_id: 2, monto: 40.01,
  }, VICTOR), /marca.*venta|venta.*marca/i);
});

test("corregir marca no permite exceder la venta y no modifica el original", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, {});
  const marca = sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 60 });
  sembrarCaptura(DB, { tipo: "marca", marca_id: 2, monto: 30 });
  rechazaSinCambios(DB, () => corregirCaptura(DB, marca.id, 70.01, "Ajuste", VICTOR), /marca.*venta|venta.*marca/i);
});

test("corregir marca exige que siga existiendo la venta vigente del día", () => {
  const DB = prepararCatalogos();
  const marca = sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 0 });
  rechazaSinCambios(DB, () => corregirCaptura(DB, marca.id, 0, "Ajuste", VICTOR), {
    message: "Primero captura tu venta de ese día",
  });
});

test("corregir venta debajo de marcas se rechaza sin mutar nada", () => {
  const DB = prepararCatalogos();
  const venta = sembrarCaptura(DB, {});
  sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 60 });
  sembrarCaptura(DB, { tipo: "marca", marca_id: 2, monto: 30 });
  rechazaSinCambios(DB, () => corregirCaptura(DB, venta.id, 89.99, "Ajuste", VICTOR), {
    message: "Tu venta quedaría por debajo de lo que ya capturaste por marca; corrige primero las marcas",
  });
});

// En binario 1.40 + 70.20 da 71.60000000000001: comparar en decimales le rechazaba a una
// vendedora honesta la repartición exacta de su venta cuando había centavos.
test("repartir la venta exacta en marcas con centavos se acepta", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, { monto: 71.6 });
  sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 1.4 });
  const marca = capturarDia(DB, { ...DIA, tipo: "marca", marca_id: 2, monto: 70.2 }, VICTOR);
  assert.equal(marca.monto, 70.2);
});

test("corregir la venta al total exacto de las marcas con centavos se acepta", () => {
  const DB = prepararCatalogos();
  const venta = sembrarCaptura(DB, { monto: 1 });
  sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 0.1 });
  sembrarCaptura(DB, { tipo: "marca", marca_id: 2, monto: 0.2 });
  const corregida = corregirCaptura(DB, venta.id, 0.3, "Ajuste", VICTOR);
  assert.equal(corregida.monto, 0.3);
});

test("con centavos, un centavo de más sobre la venta se sigue rechazando", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, { monto: 71.6 });
  sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 1.4 });
  rechazaSinCambios(DB, () => capturarDia(DB, {
    ...DIA, tipo: "marca", marca_id: 2, monto: 70.21,
  }, VICTOR), /marca.*venta|venta.*marca/i);
});

test("corregir marca reemplaza su valor, conserva referencia y permite bajar después la venta", () => {
  const DB = prepararCatalogos();
  const venta = sembrarCaptura(DB, {});
  const marca = sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 60 });
  sembrarCaptura(DB, { tipo: "marca", marca_id: 2, monto: 30 });
  const subida = corregirCaptura(DB, String(marca.id), 70, " Ajuste ", VICTOR);
  assert.equal(subida.marca_id, 1);
  assert.equal(subida.corrige_a, marca.id);
  assert.equal(subida.motivo, "Ajuste");
  assert.equal(marca.vigente, false);
  const bajada = corregirCaptura(DB, subida.id, 50, "Importe correcto", VICTOR);
  assert.equal(bajada.marca_id, 1);
  assert.equal(corregirCaptura(DB, venta.id, 80, "Marcas corregidas", VICTOR).monto, 80);
  assert.equal(capturadoDelMesPor(DB, { ...DIA, tipo: "marca", marca_id: 1 }), 50);
});

test("productos aceptan piezas enteras y cero sin venta y son únicos por referencia", () => {
  const DB = prepararCatalogos();
  const teclado = capturarDia(DB, { ...DIA, tipo: "producto", producto_meta_id: "1", monto: 2 }, VICTOR);
  const guitarra = capturarDia(DB, { ...DIA, tipo: "producto", producto_meta_id: 2, monto: 0 }, VICTOR);
  assert.equal(teclado.producto_meta_id, 1);
  assert.equal(guitarra.monto, 0);
  rechazaSinCambios(DB, () => capturarDia(DB, {
    ...DIA, tipo: "producto", producto_meta_id: 1, monto: 3,
  }, VICTOR), /Ya hay una captura/);
  rechazaSinCambios(DB, () => capturarDia(DB, {
    ...DIA, fecha: "2026-09-04", tipo: "producto", producto_meta_id: 1, monto: 1.5,
  }, VICTOR), /entero/i);
});

test("corregir producto rechaza decimales y conserva la referencia al reemplazar", () => {
  const DB = prepararCatalogos();
  const producto = sembrarCaptura(DB, { tipo: "producto", producto_meta_id: 1, monto: 2 });
  rechazaSinCambios(DB, () => corregirCaptura(DB, producto.id, 1.5, "Ajuste", VICTOR), /entero/i);
  const nuevo = corregirCaptura(DB, producto.id, 0, "No hubo piezas", VICTOR);
  assert.equal(nuevo.producto_meta_id, 1);
  assert.equal(nuevo.monto, 0);
  assert.equal(nuevo.corrige_a, producto.id);
  assert.equal(producto.vigente, false);
});

for (const [tipo, campo, lista] of [["marca", "marca_id", "marcas"], ["producto", "producto_meta_id", "productos"]]) {
  test(`${tipo}: desactivada no se captura pero sí se corrige conservando el nombre`, () => {
    const DB = prepararCatalogos();
    sembrarCaptura(DB, {});
    const original = sembrarCaptura(DB, { tipo, [campo]: 1, monto: 2 });
    const elemento = desactivarElemento(DB, lista, 1, { motivo: "Sale de la lista" }, VICTOR);
    rechazaSinCambios(DB, () => capturarDia(DB, {
      ...DIA, fecha: "2026-09-04", tipo, [campo]: 1, monto: 1,
    }, VICTOR), /desactivad/i);
    const nueva = corregirCaptura(DB, original.id, 1, "Corrección histórica", VICTOR);
    assert.equal(nueva[campo], 1);
    assert.equal(elemento.nombre, tipo === "marca" ? "Yamaha" : "Teclados");
  });

  test(`${tipo}: referencia inexistente o inválida se rechaza al capturar y corregir`, () => {
    for (const id of [999, null, undefined, 0, -1, 1.5, true, [], "abc"]) {
      const DB = prepararCatalogos();
      sembrarCaptura(DB, {});
      rechazaSinCambios(DB, () => capturarDia(DB, { ...DIA, tipo, [campo]: id, monto: 1 }, VICTOR), /identificador|existe/i);
    }
    const DB = prepararCatalogos();
    sembrarCaptura(DB, {});
    const original = sembrarCaptura(DB, { tipo, [campo]: 999, monto: 1 });
    rechazaSinCambios(DB, () => corregirCaptura(DB, original.id, 0, "Ajuste", VICTOR), /existe/i);
  });

  test(`${tipo}: montos negativos, no finitos o no numéricos se rechazan sin cambios`, () => {
    const DB = prepararCatalogos();
    sembrarCaptura(DB, {});
    const original = sembrarCaptura(DB, { tipo, [campo]: 1, monto: 1 });
    for (const monto of [-1, NaN, Infinity, null, "2", undefined]) {
      rechazaSinCambios(DB, () => capturarDia(DB, {
        ...DIA, fecha: "2026-09-04", tipo, [campo]: 1, monto,
      }, VICTOR), /monto/i);
      rechazaSinCambios(DB, () => corregirCaptura(DB, original.id, monto, "Ajuste", VICTOR), /monto/i);
    }
  });
}

test("capturas rechazan tipos y referencias ajenos a su tipo", () => {
  const DB = prepararCatalogos();
  for (const llave of [
    { tipo: "credito", financiera: "atrato" }, { tipo: "actividad", actividad: "grupos" },
    { tipo: "venta", marca_id: 1 }, { tipo: "marca", marca_id: 1, producto_meta_id: 1 },
    { tipo: "producto", producto_meta_id: 1, financiera: "atrato" },
    { tipo: "venta", actividad: "grupos" },
  ]) {
    rechazaSinCambios(DB, () => capturarDia(DB, { ...DIA, ...llave, monto: 0 }, VICTOR), /tipo|no puede tener/i);
  }
});

test("ventas viejas siguen contando solas y bloquean duplicados con referencias nulas", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, {});
  sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 40 });
  sembrarCaptura(DB, { tipo: "producto", producto_meta_id: 1, monto: 2 });
  assert.equal(capturadoDelMes(DB, DIA), 100);
  rechazaSinCambios(DB, () => capturarDia(DB, {
    ...DIA, tipo: "venta", marca_id: null, producto_meta_id: null, monto: 200,
  }, VICTOR), /Ya hay una captura/);
});

test("totales por referencia filtran mes, tienda, persona y vigencia sin mutar", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, {});
  sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 40 });
  sembrarCaptura(DB, { tipo: "marca", marca_id: 2, monto: 30 });
  sembrarCaptura(DB, { tipo: "producto", producto_meta_id: 1, monto: 2 });
  sembrarCaptura(DB, { tipo: "producto", producto_meta_id: 2, monto: 3 });
  for (const otros of [
    { vigente: false }, { mes: "2026-08", fecha: "2026-08-03" }, { vendedor_id: 2 }, { sucursal_id: 2 },
  ]) sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 1000, ...otros });
  const antes = structuredClone(DB);
  assert.equal(capturadoDelMesPor(DB, { ...DIA, tipo: "marca", marca_id: "1" }), 40);
  assert.equal(capturadoDelMesPor(DB, { ...DIA, tipo: "marca", marca_id: 2 }), 30);
  assert.equal(capturadoDelMesPor(DB, { ...DIA, tipo: "producto", producto_meta_id: "1" }), 2);
  assert.equal(capturadoDelMesPor(DB, { ...DIA, tipo: "producto", producto_meta_id: 2 }), 3);
  assert.equal(capturadoDelMesPor(DB, { ...DIA, tipo: "producto", producto_meta_id: 999 }), 0);
  assert.equal(capturadoDelMesPor(DB, { ...DIA, tipo: "venta" }), 100);
  assert.deepEqual(DB, antes);
});

test("días sin capturar cuenta solo venta aunque existan marcas o productos", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, { fecha: "2026-09-01", tipo: "producto", producto_meta_id: 1, monto: 2 });
  sembrarCaptura(DB, { fecha: "2026-09-02", tipo: "marca", marca_id: 1, monto: 0 });
  sembrarCaptura(DB, {});
  assert.deepEqual(diasSinCapturar(DB, { ...DIA, hasta: "2026-09-03" }), ["2026-09-01", "2026-09-02"]);
});

test("traslado mantiene marcas y productos en la tienda de cada día y permite corregir lo anterior", () => {
  const DB = prepararCatalogos();
  DB.pos.vendedores[0].sucursal_id = 2;
  DB.pos.objetivo_plantilla.push(
    { ...DIA, id: 1, desde: "2026-09-01", hasta: "2026-09-15" },
    { ...DIA, id: 2, sucursal_id: 2, desde: "2026-09-16", hasta: null }
  );
  conRelojEn("2026-09-20T18:30:00.000Z", () => {
    for (const datos of [DIA, { ...DIA, fecha: "2026-09-16", sucursal_id: 2 }]) {
      capturarDia(DB, { ...datos, tipo: "venta", monto: 100 }, VICTOR);
      const marca = capturarDia(DB, { ...datos, tipo: "marca", marca_id: 1, monto: 40 }, VICTOR);
      capturarDia(DB, { ...datos, tipo: "producto", producto_meta_id: 1, monto: 2 }, VICTOR);
      assert.equal(corregirCaptura(DB, marca.id, 50, "Ajuste", VICTOR).sucursal_id, datos.sucursal_id);
    }
    rechazaSinCambios(DB, () => capturarDia(DB, {
      ...DIA, sucursal_id: 2, tipo: "marca", marca_id: 2, monto: 1,
    }, VICTOR), /Ese día no estás en la plantilla/);
  });
});

test("traslado sin plantilla no permite duplicar una referencia ni evadir el candado de marca", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, {});
  sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 60 });
  DB.pos.vendedores[0].sucursal_id = 2;
  rechazaSinCambios(DB, () => capturarDia(DB, {
    ...DIA, sucursal_id: 2, tipo: "marca", marca_id: 1, monto: 1,
  }, VICTOR), /Ya hay una captura/);
  rechazaSinCambios(DB, () => capturarDia(DB, {
    ...DIA, sucursal_id: 2, tipo: "marca", marca_id: 2, monto: 41,
  }, VICTOR), /marca.*venta|venta.*marca/i);
});

// Con tres decimales, cada importe se redondeaba por separado y se colaba más de un centavo:
// tres marcas de $1.004 sobre una venta de $3.00 sumaban $3.012.
test("venta y marca en pesos aceptan a lo más dos decimales", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, { monto: 3 });
  rechazaSinCambios(DB, () => capturarDia(DB, { ...DIA, tipo: "marca", marca_id: 1, monto: 1.004 }, VICTOR), /dos decimales/);
  const otro = prepararCatalogos();
  rechazaSinCambios(otro, () => capturarDia(otro, { ...DIA, monto: 71.605 }, VICTOR), /dos decimales/);
});

test("corregir una marca con más de dos decimales se rechaza", () => {
  const DB = prepararCatalogos();
  sembrarCaptura(DB, { monto: 3 });
  const marca = sembrarCaptura(DB, { tipo: "marca", marca_id: 1, monto: 1 });
  rechazaSinCambios(DB, () => corregirCaptura(DB, marca.id, 1.004, "Ajuste", VICTOR), /dos decimales/);
});
