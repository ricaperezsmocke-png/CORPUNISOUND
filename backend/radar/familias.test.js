const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// La carga diferida permite observar cada contrato rojo antes de crear el módulo.
const clasificar = (registro) => require("./familias").clasificarSolicitud(registro);
const registro = (producto_buscado, extra = {}) => ({
  id: 1, producto_buscado, cantidad: 1, estado: "REGISTRADA",
  sucursal_id: 1, fecha_registro: "2026-09-15T01:00:00Z", ...extra,
});

test("electroacústica de 12 cuerdas conserva un tipo y características coexistentes", () => {
  const [articulo] = clasificar(registro("Guitarra electroacústica de 12 cuerdas", {
    variante_solicitada: "negra zurda tamaño 3/4 acabado mate",
  }));
  assert.equal(articulo.familia, "Guitarras");
  assert.equal(articulo.familia_id, "guitarras");
  assert.equal(articulo.tipo, "Electroacústica");
  assert.equal(articulo.tipo_id, "electroacustica");
  assert.deepEqual(articulo.caracteristicas.map((c) => c.clave).sort(),
    ["acabado_mate", "color_negro", "cuerdas_12", "tamano_3_4", "zurdo"].sort());
  assert.ok(articulo.regla);
  assert.equal(typeof articulo.version, "number");
});

for (const [texto, familia] of [
  ["pastilla para guitarra acústica", "Pastillas"], ["guitarra con pastilla", "Guitarras"],
  ["reparación de guitarra", "Reparación"], ["maquinaria de guitarrón", "Maquinaria"],
  ["guitarrón", "Guitarrones"], ["vihuela", "Vihuelas"], ["bajo quinto", "Bajos quintos"],
  ["cuerdas para bajo quinto", "Cuerdas"], ["funda para trompeta", "Fundas"],
  ["amplificador de guitarra", "Amplificadores"], ["capo traste", "Capotrastes"],
]) {
  test(`artículo principal: ${texto}`, () => {
    assert.deepEqual(clasificar(registro(texto)).map((a) => a.familia), [familia]);
  });
}

test("cable Y y conectores de medidas no crean artículos ficticios", () => {
  assert.equal(clasificar(registro("cable Y de audio de 3.5 a 6.3" )).length, 1);
  assert.deepEqual(clasificar(registro("cable Y de audio y guitarra")).map((a) => a.familia), ["Cables", "Guitarras"]);
  assert.equal(clasificar(registro("guitarra negra y zurda")).length, 1);
  assert.equal(clasificar(registro("pastilla para guitarra y bajo quinto")).length, 1);
});

test("multiartículo conserva posiciones y evidencia sin repartir una cantidad general", () => {
  const texto = "2 guitarras acústicas; violín y 3 cables";
  const articulos = clasificar(registro(texto, { cantidad: 10 }));
  assert.deepEqual(articulos.map((a) => a.familia), ["Guitarras", "Violines", "Cables"]);
  assert.deepEqual(articulos.map((a) => a.cantidad), [2, null, 3]);
  for (const articulo of articulos) {
    assert.equal(articulo.evidencia.texto_original, texto);
    const { inicio, fin, fragmento } = articulo.evidencia;
    assert.equal(texto.slice(inicio, fin), fragmento);
  }
});

for (const marca of ["Ibanez", "Epiphone", "Takamine", "Casio", "Roland"]) {
  test(`marca abierta ${marca}: campo explícito y texto libre conservan escritura`, () => {
    const literal = marca.toUpperCase();
    for (const entrada of [registro("guitarra", { marca_solicitada: literal }), registro(`guitarra ${literal}`)]) {
      const [articulo] = clasificar(entrada);
      assert.equal(articulo.marca.estado, "RECONOCIDA");
      assert.equal(articulo.marca.texto, literal);
    }
  });
}

test("marca inventada en tiempo de prueba se conserva en campo y marcador marca", () => {
  const marca = `Luthier-${randomUUID()}`;
  for (const entrada of [registro("guitarra", { marca_solicitada: marca }), registro(`guitarra marca ${marca}`)]) {
    const [articulo] = clasificar(entrada);
    assert.equal(articulo.marca.estado, "RECONOCIDA");
    assert.equal(articulo.marca.texto, marca);
  }
});

test("marca desconocida sin marcador conserva candidato literal y texto completo", () => {
  const candidato = `Luthier-${randomUUID()}`;
  const entrada = registro(`guitarra ${candidato}`);
  const [articulo] = clasificar(entrada);
  assert.equal(articulo.marca.estado, "NO_IDENTIFICADA");
  assert.equal(articulo.marca.candidato, candidato);
  assert.equal(articulo.evidencia.texto_original, entrada.producto_buscado);
  assert.equal(articulo.familia, "Guitarras");
});

test("marcador admite marcas de varias palabras y termina antes del modelo", () => {
  const [articulo] = clasificar(registro("guitarra marca Taller del Sur modelo AX-10"));
  assert.equal(articulo.marca.texto, "Taller del Sur");
  assert.equal(articulo.modelo, "AX-10");
});

test("económica, importes y modelos nunca son marcas por descarte", () => {
  for (const texto of ["guitarra económica", "guitarra de $2,700", "guitarra de 2700 pesos", "guitarra modelo AX-10", "guitarra AX-10"]) {
    assert.equal(clasificar(registro(texto))[0].marca.estado, "NO_INFORMADA", texto);
  }
  const [articulo] = clasificar(registro("guitarra Fender", { marca_solicitada: "2700 pesos", modelo_solicitado: "AX-10" }));
  assert.equal(articulo.marca.texto, "Fender");
  assert.equal(articulo.modelo, "AX-10");
});

test("no usa parecido para reconocer marcas o fusionar modelos", () => {
  const [articulo] = clasificar(registro("guitara electroacustca Ivanez", { modelo_solicitado: "EON615S" }));
  assert.equal(articulo.familia, "Guitarras");
  assert.equal(articulo.tipo, "Electroacústica");
  assert.equal(articulo.marca.estado, "NO_IDENTIFICADA");
  assert.equal(articulo.marca.candidato, "Ivanez");
  assert.equal(articulo.modelo, "EON615S");
});

test("tipo desconocido conserva familia y no convierte 12 cuerdas en tipo", () => {
  const [articulo] = clasificar(registro("guitarra de 12 cuerdas"));
  assert.equal(articulo.familia, "Guitarras");
  assert.equal(articulo.tipo, "Tipo no identificado");
  assert.equal(articulo.tipo_id, "no_identificado");
  assert.equal(articulo.caracteristicas[0].clave, "cuerdas_12");
});

test("necesidades y otros overrides guardados no gobiernan las reglas", () => {
  const entrada = registro("guitarra acústica");
  assert.deepEqual(clasificar({ ...entrada, necesidades: [{ familia: "Violines", cantidad: 90 }], clasificacion: { familia: "Cables" } }), clasificar(entrada));
});

test("desconocidos y datos dañados conservan evidencia y motivo sin lanzar", () => {
  for (const entrada of [null, registro("iouoi"), registro({ corrupto: true }), registro("guitarra", { variante_solicitada: {} })]) {
    const [articulo] = clasificar(entrada);
    assert.equal(articulo.familia, "Por clasificar");
    assert.ok(articulo.diagnosticos.length > 0);
  }
});

test("cantidades ausentes son desconocidas y cantidades dañadas se diagnostican", () => {
  for (const cantidad of [null, undefined, ""]) {
    const [articulo] = clasificar(registro("guitarra", { cantidad }));
    assert.equal(articulo.cantidad, null);
    assert.equal(articulo.familia, "Guitarras");
  }
  for (const cantidad of [-2, 0, Infinity, {}, true, "basura"]) {
    const [articulo] = clasificar(registro("guitarra", { cantidad }));
    assert.equal(articulo.cantidad, null);
    assert.equal(articulo.familia, "Por clasificar");
    assert.ok(articulo.diagnosticos.some((d) => d.motivo === "CANTIDAD_INVALIDA"));
  }
});

test("campos globales no se atribuyen por conjetura a varios artículos", () => {
  const entrada = registro("guitarra y violín", { marca_solicitada: "Takamine", modelo_solicitado: "AX-10" });
  for (const articulo of clasificar(entrada)) {
    assert.equal(articulo.marca.estado, "NO_IDENTIFICADA");
    assert.equal(articulo.marca.candidato, "Takamine");
    assert.equal(articulo.modelo, "");
    assert.equal(articulo.evidencia.modelo_solicitado, "AX-10");
    assert.ok(articulo.diagnosticos.some((d) => d.motivo === "CAMPOS_SIN_ATRIBUCION"));
  }
});

test("marca y modelo explícitos no aportan tipos ni características", () => {
  const [articulo] = clasificar(registro("guitarra marca Acústica modelo Negra"));
  assert.equal(articulo.marca.texto, "Acústica");
  assert.equal(articulo.modelo, "Negra");
  assert.equal(articulo.tipo, "Tipo no identificado");
  assert.deepEqual(articulo.caracteristicas, []);
});

test("marca con preposiciones se conserva entera después del marcador", () => {
  const [articulo] = clasificar(registro("guitarra marca Casa de Música Nueva modelo AX-10"));
  assert.equal(articulo.marca.texto, "Casa de Música Nueva");
});

test("dos marcas alternativas son ambiguas y conservan ambas escrituras", () => {
  const [articulo] = clasificar(registro("guitarra Yamaha o Fender"));
  assert.equal(articulo.marca.estado, "NO_IDENTIFICADA");
  assert.equal(articulo.marca.candidato, "Yamaha o Fender");
  assert.equal(articulo.familia, "Guitarras");
});

test("tipo ambiguo conserva familia y diagnóstico", () => {
  const [articulo] = clasificar(registro("guitarra acústica o eléctrica"));
  assert.equal(articulo.tipo, "Tipo no identificado");
  assert.ok(articulo.diagnosticos.some((d) => d.motivo === "TIPO_AMBIGUO"));
});

test("un artículo dañado no degrada a su compañero", () => {
  const articulos = clasificar(registro("0 guitarras; 2 violines"));
  assert.equal(articulos[0].familia, "Por clasificar");
  assert.equal(articulos[0].cantidad, null);
  assert.equal(articulos[1].familia, "Violines");
  assert.equal(articulos[1].cantidad, 2);
});

const agrupar = (registros, opciones = { universo: "PENDIENTE" }) => require("./familias").agruparFamilias(registros, opciones);
const sumarUnidades = (nodos) => nodos.reduce((total, nodo) => total + nodo.unidades_conocidas, 0);
function fixtureCatorce() {
  return [
    registro("guitarra electroacústica de 12 cuerdas", { id: 1, cantidad: 2, marca_solicitada: "Yamaha" }),
    registro("guitarra electroacústica", { id: 2, cantidad: 3, marca_solicitada: "Yamaha" }),
    registro("guitarra electroacústica", { id: 3, cantidad: 3, marca_solicitada: "Fender" }),
    registro("guitarra electroacústica", { id: 4, cantidad: 1 }),
    registro("guitarra acústica", { id: 5, cantidad: 4 }),
    registro("guitarra", { id: 6, cantidad: 1 }),
  ];
}

test("fixture contractual: 14 unidades, 9 electroacústicas, 2 de 12 cuerdas, marcas 5/3/6", () => {
  const resultado = agrupar(fixtureCatorce());
  assert.equal(resultado.universo, "PENDIENTE");
  assert.equal(resultado.solicitudes, 6);
  assert.equal(resultado.unidades_conocidas, 14);
  assert.equal(resultado.articulos_cantidad_desconocida, 0);
  const [familia] = resultado.familias;
  assert.equal(familia.solicitudes, 6);
  assert.equal(familia.unidades_conocidas, 14);
  assert.equal(sumarUnidades(familia.tipos), 14);
  const electro = familia.tipos.find((t) => t.clave === "electroacustica");
  assert.equal(electro.unidades_conocidas, 9);
  assert.equal(electro.caracteristicas.find((c) => c.clave === "cuerdas_12").unidades_conocidas, 2);
  assert.deepEqual(familia.marcas.map((m) => [m.etiqueta, m.unidades_conocidas]).sort(),
    [["Fender", 3], ["Marca no informada", 6], ["Yamaha", 5]]);
  assert.equal(sumarUnidades(familia.marcas), 14);
  for (const marca of familia.marcas) {
    const porTipos = familia.tipos.flatMap((t) => t.marcas).filter((m) => m.clave === marca.clave);
    assert.equal(sumarUnidades(porTipos), marca.unidades_conocidas);
  }
});

test("marca no identificada y no informada permanecen en categorías distintas", () => {
  const resultado = agrupar([
    registro("guitarra", { id: 1, cantidad: 2 }),
    registro("guitarra Luthier Desconocido", { id: 2, cantidad: 3 }),
  ]);
  const marcas = resultado.familias[0].marcas;
  assert.equal(marcas.find((m) => m.estado === "NO_INFORMADA").unidades_conocidas, 2);
  assert.equal(marcas.find((m) => m.estado === "NO_IDENTIFICADA").unidades_conocidas, 3);
  assert.equal(sumarUnidades(marcas), 5);
});

test("dos artículos de una familia son una solicitud y suman sus unidades", () => {
  const resultado = agrupar([registro("2 guitarras acústicas Yamaha y 3 guitarras eléctricas Fender", { cantidad: 90 })]);
  assert.equal(resultado.solicitudes, 1);
  assert.equal(resultado.unidades_conocidas, 5);
  const [familia] = resultado.familias;
  assert.equal(familia.solicitudes, 1);
  assert.equal(sumarUnidades(familia.tipos), 5);
  assert.equal(sumarUnidades(familia.marcas), 5);
  assert.equal(familia.registros[0].articulos.length, 2);
  assert.equal(familia.registros[0].cantidad_original, 90);
});

test("cantidades parciales y multiartículo mantienen las desconocidas aparte", () => {
  const resultado = agrupar([
    registro("2 guitarras y violín", { id: 1, cantidad: 12 }),
    registro("guitarra y cable", { id: 2, cantidad: 8 }),
  ]);
  assert.equal(resultado.solicitudes, 2);
  assert.equal(resultado.unidades_conocidas, 2);
  assert.equal(resultado.articulos_cantidad_desconocida, 3);
  assert.equal(resultado.familias.find((f) => f.clave === "guitarras").articulos_cantidad_desconocida, 1);
  assert.equal(resultado.familias.find((f) => f.clave === "violines").unidades_conocidas, 0);
  assert.equal(resultado.familias.find((f) => f.clave === "violines").articulos_cantidad_desconocida, 1);
});

test("solo convertidas y no convertidas amplían HISTORICA; canceladas no aportan nada", () => {
  const base = [registro("guitarra", { id: 1, cantidad: 2 })];
  const cerradas = [
    registro("guitarra", { id: 2, cantidad: 3, estado: "CONVERTIDA" }),
    registro("guitarra", { id: 3, cantidad: 4, estado: "NO_CONVERTIDA" }),
  ];
  assert.deepEqual(agrupar([...base, ...cerradas]), agrupar(base));
  const historica = agrupar([...base, ...cerradas], { universo: "HISTORICA" });
  assert.equal(historica.solicitudes, 3);
  assert.equal(historica.unidades_conocidas, 9);
  for (const universo of ["PENDIENTE", "HISTORICA"]) {
    const esperado = agrupar([...base, ...cerradas], { universo });
    for (const cantidad of [1, 20]) {
      const canceladas = Array.from({ length: cantidad }, (_, i) => registro({ corrupto: true }, {
        id: 100 + i, estado: "CANCELADA", cantidad: -1, sucursal_id: 999, fecha_registro: "basura",
      }));
      assert.deepEqual(agrupar([...base, ...cerradas, ...canceladas], { universo }), esperado);
    }
  }
});

test("estados vacíos o desconocidos se reportan sin entrar en ningún universo", () => {
  const entradas = [registro("guitarra", { id: 1, estado: "" }), registro("guitarra", { id: 2, estado: "FUTURO" }), null];
  for (const universo of ["PENDIENTE", "HISTORICA"]) {
    const resultado = agrupar(entradas, { universo });
    assert.equal(resultado.solicitudes, 0);
    assert.deepEqual(resultado.familias, []);
    assert.equal(resultado.diagnosticos.length, 3);
    assert.ok(resultado.diagnosticos.every((d) => d.motivo === "ESTADO_NO_CLASIFICABLE"));
  }
});

test("inmutabilidad profunda: reglas y agregados ignoran necesidades sin tocar originales", () => {
  const entradas = fixtureCatorce();
  entradas[0].necesidades = [{ familia: "Cables", cantidad: 400 }];
  const antes = structuredClone(entradas);
  function congelar(valor) {
    if (valor && typeof valor === "object") {
      Object.values(valor).forEach(congelar);
      Object.freeze(valor);
    }
    return valor;
  }
  congelar(entradas);
  entradas.forEach(clasificar);
  assert.equal(agrupar(entradas).unidades_conocidas, 14);
  assert.deepEqual(entradas, antes);
});

test("jerarquía de modelos conserva literal y no fusiona códigos parecidos", () => {
  const resultado = agrupar([
    registro("guitarra", { id: 1, marca_solicitada: "YAMAHA", modelo_solicitado: "AX-10", cantidad: 2 }),
    registro("guitarra", { id: 2, marca_solicitada: "Yamaha", modelo_solicitado: "AX-10S", cantidad: 3 }),
  ]);
  const marca = resultado.familias[0].tipos[0].marcas[0];
  assert.equal(marca.unidades_conocidas, 5);
  assert.deepEqual(marca.escrituras.sort(), ["YAMAHA", "Yamaha"]);
  assert.deepEqual(marca.modelos.map((m) => [m.etiqueta, m.unidades_conocidas]).sort(), [["AX-10", 2], ["AX-10S", 3]]);
});

test("la evidencia usa el día de México y no inventa fechas para datos inválidos", () => {
  const resultado = agrupar([
    registro("guitarra", { id: 1, fecha_registro: "2026-09-15T01:00:00Z" }),
    registro("guitarra", { id: 2, fecha_registro: "basura" }),
  ]);
  assert.deepEqual(resultado.familias[0].registros.map((r) => r.fecha_local), ["2026-09-14", null]);
  assert.ok(resultado.diagnosticos.some((d) => d.demanda_id === 2 && d.motivo === "FECHA_INVALIDA"));
});

test("solicitudes repetidas por id no duplican unidades y las sin id se conservan", () => {
  const entrada = registro("guitarra", { cantidad: 2 });
  const resultado = agrupar([entrada, { ...entrada, id: "1" }, registro("guitarra", { id: null }), registro("guitarra", { id: null })]);
  assert.equal(resultado.solicitudes, 3);
  assert.equal(resultado.unidades_conocidas, 4);
});

test("agregación exige universo explícito y una lista vacía tiene totales vacíos", () => {
  assert.throws(() => require("./familias").agruparFamilias([]), /universo/i);
  assert.throws(() => agrupar([], { universo: "DESCARTADA" }), /universo/i);
  const resultado = agrupar([]);
  assert.equal(resultado.solicitudes, 0);
  assert.equal(resultado.unidades_conocidas, 0);
  assert.equal(resultado.articulos_cantidad_desconocida, 0);
  assert.deepEqual(resultado.familias, []);
});

test("fecha de solo día no depende de la zona horaria del proceso", () => {
  const zonaAnterior = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Kiritimati";
    const resultado = agrupar([registro("guitarra", { fecha_registro: "2026-09-15" })]);
    assert.equal(resultado.familias[0].registros[0].fecha_local, "2026-09-15");
  } finally {
    if (zonaAnterior === undefined) delete process.env.TZ;
    else process.env.TZ = zonaAnterior;
  }
});

/**
 * Marca: como se decide si un sobrante del texto es marca o no.
 *
 * Historia de este bloque. Codex lo dejo contando CUALQUIER sobrante como
 * marca, asi que "guitarra acustica para principiante" salia con marca
 * "principiante". Claude lo arreglo exigiendo mayuscula inicial, y la revision
 * de Codex del 2026-09-16 demostro que eso era peor: la MISMA demanda escrita
 * "Cort" o "cort" caia en categorias distintas, y cinco unidades se movian de
 * "marca no identificada" a "marca no informada" solo por como se teclearon.
 *
 * Regla vigente: las mayusculas NO deciden nada. Lo que descarta un sobrante es
 * que sea un descriptor, y eso se reconoce por la palabra y por su contexto
 * ("para X" describe, no es marca).
 */
test("la misma marca desconocida cae igual sin importar mayusculas", () => {
  const estados = ["guitarra Cort", "guitarra cort", "GUITARRA CORT", "guitarra cOrT"]
    .map((texto) => clasificar(registro(texto))[0].marca.estado);
  assert.deepEqual(estados, Array(4).fill("NO_IDENTIFICADA"),
    "el mismo pedido no puede contarse distinto por como se escribio");
});

test("un descriptor NO se convierte en marca, lleve mayuscula o no", () => {
  for (const texto of ["guitarra acustica para principiante", "guitarra para Principiante", "guitarra economica"]) {
    const articulo = clasificar(registro(texto))[0];
    assert.equal(articulo.marca.estado, "NO_INFORMADA", `"${texto}" no debe inventar marca`);
  }
});

test("un candidato de dos palabras se conserva completo", () => {
  const articulo = clasificar(registro("guitarra Music man"))[0];
  assert.equal(articulo.marca.estado, "NO_IDENTIFICADA");
  assert.equal(articulo.marca.candidato, "Music man");
});

test("una marca conocida sigue reconociendose aunque venga en minusculas", () => {
  const articulo = clasificar(registro("guitarra ibanez"))[0];
  assert.equal(articulo.marca.estado, "RECONOCIDA");
});

test("guitarra clásica es un tipo, no un sobrante de texto", () => {
  const articulo = clasificar(registro("guitarra clasica"))[0];
  assert.equal(articulo.tipo, "Clásica");
  assert.equal(articulo.marca.estado, "NO_INFORMADA");
});

/**
 * Hallazgo 2 de la revision de Codex (2026-09-16): el backend toleraba un
 * producto_buscado que no era texto y lo guardaba tal cual en la evidencia.
 * La pantalla lo entregaba a React como hijo, React lo rechazaba, y se caia
 * el reporte completo: Victor perdia tambien los registros buenos.
 * La evidencia se conserva, pero SIEMPRE como texto legible.
 */
test("la evidencia siempre es texto, aunque el dato venga corrupto", () => {
  for (const valor of [{ raro: true }, [1, 2], 42, true]) {
    const articulo = clasificar(registro(valor))[0];
    assert.equal(typeof articulo.evidencia.texto_original, "string",
      `un ${typeof valor} no puede llegar a la pantalla sin convertir`);
  }
});

test("la evidencia corrupta conserva algo legible, no se borra", () => {
  const articulo = clasificar(registro({ raro: true }))[0];
  assert.match(articulo.evidencia.texto_original, /raro/);
  assert.equal(articulo.familia, "Por clasificar");
});
