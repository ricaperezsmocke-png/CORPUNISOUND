const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// La carga diferida permite observar cada contrato rojo antes de crear el módulo.
const clasificar = (registro) => require("./familias").clasificarSolicitud(registro);
const registro = (producto_buscado, extra = {}) => ({
  id: 1, producto_buscado, cantidad: 1, estado: "REGISTRADA",
  sucursal_id: 1, fecha_registro: "2026-09-15T01:00:00Z", ...extra,
});

// Despacho 2026-09-16: reproducciones literales y límites de seguridad.
for (const descripcion of ["pua", "puas", "púa", "púas", "plumilla", "plumillas"]) {
  test(`hueco 1: ${descripcion} pertenece a Púas`, () => {
    const [articulo] = clasificar(Object.freeze(registro(descripcion)));
    assert.equal(articulo.familia_id, "puas");
    assert.equal(articulo.familia, "Púas");
    assert.equal(articulo.evidencia.texto_original, descripcion);
  });
}

test("hueco 1: púas para guitarra conserva el accesorio y sus unidades", () => {
  const [articulo] = clasificar(registro("3 púas para guitarra"));
  assert.equal(articulo.familia_id, "puas");
  assert.equal(articulo.cantidad, 3);
});

test("hueco 1: la familia nueva no absorbe pilas, pastillas ni palabras cortas", () => {
  for (const [descripcion, familia] of [
    ["pila", "pilas"], ["pastillas", "pastillas"], ["parches", "parches"],
    ["plumero", "por_clasificar"], ["puaX", "por_clasificar"],
  ]) assert.equal(clasificar(registro(descripcion))[0].familia_id, familia, descripcion);
});

// Detenido: Levenshtein = 4; contando transposición adyacente = 3, frente
// a tolerancia 2. Guitarra/guitarron ya distan 2 y se separan por coincidencia
// exacta en familias, no por palabrasCompatibles. No ampliar el comparador
// compartido ni agregar un alias de esta errata sin una regla general segura.
// TODO ejecuta la reproducción roja: no se elimina ni se declara resuelta.
test("hueco 2: MIRCOROFO STEREN INALAMBRICO reconoce familia, marca y tipo", {
  todo: "Detenido: pendiente una regla general segura para la errata; no se amplía la tolerancia",
}, () => {
  const [articulo] = clasificar(registro("MIRCOROFO STEREN INALAMBRICO"));
  assert.equal(articulo.familia_id, "microfonos");
  assert.equal(articulo.marca.estado, "RECONOCIDA");
  assert.equal(articulo.marca.texto, "STEREN");
  assert.equal(articulo.tipo_id, "inalambrico");
});

test("hueco 2: guitarra y guitarron siguen siendo familias distintas", () => {
  for (const [descripcion, familia] of [
    ["guitarra", "guitarras"], ["guitarron", "guitarrones"],
    ["guitarras", "guitarras"], ["guitarrones", "guitarrones"],
  ]) assert.equal(clasificar(registro(descripcion))[0].familia_id, familia, descripcion);
  assert.deepEqual(clasificar(registro("guitarra y guitarron")).map((a) => a.familia_id),
    ["guitarras", "guitarrones"]);
});

test("hueco 2: sin la errata, STEREN e INALAMBRICO se reconocen solos", () => {
  const [articulo] = clasificar(registro("MICROFONO STEREN INALAMBRICO"));
  assert.equal(articulo.familia_id, "microfonos");
  assert.equal(articulo.marca.estado, "RECONOCIDA");
  assert.equal(articulo.marca.texto, "STEREN");
  assert.equal(articulo.tipo_id, "inalambrico");
});

// Detenido: exigir otro artículo con su propio «para» recuperó Cuerdas, pero
// también convirtió «accesorio para guitarra y bajo quinto para principiante»
// en una compra de bajo quinto. Se retiró esa regla; la protección queda abajo.
test("hueco 3: Caña para Clarinete y cuerdas para Viola y Viloncello recupera Cuerdas", {
  todo: "Detenido: no se encontró una regla general que distinga compra de compatibilidad con seguridad",
}, () => {
  const original = "Caña para Clarinete y cuerdas para Viola y Viloncello";
  const articulos = clasificar(Object.freeze(registro(original)));
  assert.ok(articulos.some((a) => a.familia_id === "cuerdas"));
  for (const articulo of articulos) {
    assert.equal(articulo.evidencia.texto_original, original);
    const { inicio, fin, fragmento } = articulo.evidencia;
    assert.equal(original.slice(inicio, fin), fragmento);
  }
});

for (const [descripcion, familia] of [
  ["Aceite para émbolos de trompeta", "por_clasificar"],
  ["GOMAS PARA TECLADO", "por_clasificar"],
  ["ACCESORIO PARA PEDESTAL", "por_clasificar"],
  ["diapason para guitarra", "por_clasificar"],
  ["pastilla para guitarra", "pastillas"],
  ["guitarra con pastilla", "guitarras"],
  ["accesorio para guitarra y bajo", "por_clasificar"],
  ["accesorio para guitarra y bajo quinto", "por_clasificar"],
  ["accesorio para guitarra y bajo quinto para principiante", "por_clasificar"],
]) {
  test(`hueco 3, protección: ${descripcion}`, () => {
    assert.deepEqual(clasificar(registro(descripcion)).map((a) => a.familia_id), [familia]);
  });
}

// Transcripción literal del despacho: 60 textos, 65 registros (no 65/70).
// Las familias esperadas son independientes de las reglas de producción.
const evidenciaReal = [
  [4, "ESTEREO", ["estereos"]],
  [2, "estereo sony", ["estereos"]],
  [1, "esterio sony", ["estereos"]],
  [1, "arnes de  esterio", ["arneses"]],
  [2, "DIAFRAGMA", ["diafragmas"]],
  [1, "DIAFRAGMA MITZU", ["diafragmas"]],
  [1, "TWEETER", ["tweeters"]],
  [1, "SUBWOOFER", ["subwoofers"]],
  [1, "Woofeer para Auto", ["woofers"]],
  [1, "Columna Activa", ["columnas_activas"]],
  [1, "MINI LINE ARRAY", ["line_arrays"]],
  [1, "SISTEMA MINI LINE ARRAY", ["line_arrays"]],
  [1, "COBRA PACK MINI LINEAL", ["line_arrays"]],
  [1, "CORNETA PARA BANDA", ["cornetas"]],
  [1, "COMBO PARA BAJO", ["amplificadores"]],
  [1, "SISTEMA DE MONITOREO IN EARS", ["monitoreo_in_ear"]],
  [1, "AGUDO", ["tweeters"]],
  [1, "bufer", ["buffers"]],
  [1, "unidad 300", ["unidades_audio"]],
  [1, "dbx pa2", ["por_clasificar"]],
  [1, "pro40", ["por_clasificar"]],
  [1, "KSB20", ["por_clasificar"]],
  [1, "TIMBAL", ["timbales"]],
  [1, "tambor escolar", ["tambores"]],
  [1, "TAMBOR REGLAMENTARIO, CORNETA ,ENTORCHADO", ["tambores", "cornetas", "entorchados"]],
  [1, "parche 22 para bobo", ["parches"]],
  [1, "PATA PARA BONBO", ["patas_bombo"]],
  [1, "BANCO PARA BATERIA", ["bancos_bateria"]],
  [1, "Platillos para bateria", ["platillos"]],
  [1, "AHOGADOR EN CINTA PARA BATERÍA", ["ahogadores"]],
  [1, "PANDERO JR 8", ["panderos"]],
  [1, "Guiros chicos y pandero media Luna", ["guiros", "panderos"]],
  [1, "COQUILLA  7C", ["boquillas"]],
  [1, "PILA 9V  NORMAL", ["pilas"]],
  [1, "baterias 9v", ["pilas"]],
  [1, "BATEREIA DE 9V", ["pilas"]],
  [1, "bateria recargable AAA", ["pilas"]],
  [1, "CARGADOR DE PILA DE 9V", ["cargadores"]],
  [1, "fusible de ceramica", ["fusibles"]],
  [1, "REGULADOR PARA REFRIGERADOR", ["reguladores"]],
  [1, "regulador 5000", ["reguladores"]],
  [1, "inversor de corriente", ["inversores"]],
  [1, "no breake", ["no_break"]],
  [1, "CENTRO DE CARGA", ["centros_carga"]],
  [1, "CHICHARRA", ["chicharras"]],
  [1, "LED", ["led"]],
  [1, "PISTA LED", ["pistas_led"]],
  [1, "PROTOBOAR", ["protoboards"]],
  [1, "protowar", ["protoboards"]],
  [1, "IMANES PARA PROYECTO", ["imanes"]],
  [1, "ACCESORIO DE ELECTRONICA", ["por_clasificar"]],
  [1, "radios", ["radios"]],
  [1, "CONTROL", ["por_clasificar"]],
  [1, "Acordeón 34 TECLAS", ["acordeones"]],
  [1, "Sintetizador", ["sintetizadores"]],
  [1, "LIQUIDO DE HUMO POR GALON", ["liquido_humo"]],
  [1, "CUADERNILLOS DE NOTAS MUSICALES DE UKULELE", ["metodos"]],
  [1, "maquinariametalico", ["por_clasificar"]],
  [1, "Instrumentos en General", ["por_clasificar"]],
  [1, "iouoi", ["por_clasificar"]],
];

for (const [, textoReal, familias] of evidenciaReal) {
  test(`despacho real: ${textoReal}`, () => {
    const entrada = Object.freeze(registro(textoReal));
    const articulos = clasificar(entrada);
    assert.deepEqual(articulos.map((a) => a.familia_id), familias);
    for (const articulo of articulos) {
      assert.equal(articulo.evidencia.texto_original, textoReal);
      if (articulo.familia_id === "por_clasificar") {
        assert.ok(articulo.diagnosticos.some((d) => d.motivo === "FAMILIA_NO_IDENTIFICADA"));
      }
    }
  });
}

test("cobertura del bloque real: 52 textos / 57 registros reconocidos, 8 sin clasificar", (t) => {
  const reconocidos = evidenciaReal.filter(([, textoReal]) =>
    clasificar(registro(textoReal)).every((a) => a.familia_id !== "por_clasificar"));
  const registros = reconocidos.reduce((suma, [veces]) => suma + veces, 0);
  t.diagnostic(`${reconocidos.length}/60 textos y ${registros}/65 registros reconocidos; ${60 - reconocidos.length} textos sin clasificar`);
  assert.equal(reconocidos.length, 52);
  assert.equal(registros, 57);
});

for (const [textoReal, marca] of [
  ["GUITARRA AZTECA", "AZTECA"], ["GUITARRA GEWA", "GEWA"],
  ["guitarra fender", "fender"], ["GUITARRA SEVILLANA", "SEVILLANA"],
]) {
  test(`marca real, nunca tipo: ${textoReal}`, () => {
    const [articulo] = clasificar(registro(textoReal));
    assert.equal(articulo.familia_id, "guitarras");
    assert.equal(articulo.tipo_id, "no_identificado");
    assert.equal(articulo.marca.estado, "RECONOCIDA");
    assert.equal(articulo.marca.texto, marca);
  });
}

test("GUITARRA DOCEROLA y GUITARRA 12 CUERDAS comparten familia, tipo y característica", () => {
  const articulos = ["GUITARRA DOCEROLA", "GUITARRA 12 CUERDAS"].map((s) => clasificar(registro(s))[0]);
  for (const a of articulos) {
    assert.equal(a.familia_id, "guitarras");
    assert.equal(a.tipo_id, "no_identificado");
    assert.deepEqual(a.caracteristicas, [{ clave: "cuerdas_12", etiqueta: "12 cuerdas" }]);
  }
});

test("GUITARRA INFANTIL identifica un tipo de compra y no una marca", () => {
  const [a] = clasificar(registro("GUITARRA INFANTIL"));
  assert.equal(a.familia_id, "guitarras");
  assert.equal(a.tipo_id, "infantil");
  assert.equal(a.tipo, "Infantil");
  assert.equal(a.marca.estado, "NO_INFORMADA");
});

for (const textoReal of ["guitarra", "GUITARRA", "guitarra economica", "GUITARRA NORMAL"]) {
  test(`guitarra legítima sin tipo ni ruido: ${textoReal}`, () => {
    const [a] = clasificar(registro(textoReal));
    assert.equal(a.familia_id, "guitarras");
    assert.equal(a.tipo_id, "no_identificado");
    assert.equal(a.marca.estado, "NO_INFORMADA");
    assert.deepEqual(a.diagnosticos, []);
  });
}

test("GUITARRA Y VIOLIN conserva las dos compras reales", () => {
  assert.deepEqual(clasificar(registro("GUITARRA Y VIOLIN")).map((a) => a.familia_id), ["guitarras", "violines"]);
});

for (const [descripcion, familia] of [
  ["diapason para guitarra", "por_clasificar"],
  ["accesorio desconocido para guitarra y bajo quinto", "por_clasificar"],
  ["pastilla para guitarra", "pastillas"], ["parche 22 para bobo", "parches"],
  ["guitarra para infantil", "guitarras"],
]) {
  test(`compatibilidad no es artículo principal: ${descripcion}`, () => {
    const articulos = clasificar(registro(descripcion));
    assert.deepEqual(articulos.map((a) => a.familia_id), [familia]);
    if (familia === "por_clasificar") {
      assert.ok(articulos[0].diagnosticos.some((d) => d.motivo === "FAMILIA_NO_IDENTIFICADA"));
    }
  });
}

test("batería sin contexto eléctrico queda ambigua; el accesorio conserva su familia", () => {
  for (const texto of ["bateria", "baterías", "BATEREIA", "bateria para guitarra"]) {
    const [a] = clasificar(registro(texto));
    assert.equal(a.familia_id, "por_clasificar", texto);
    assert.ok(a.diagnosticos.some((d) => d.motivo === "BATERIA_AMBIGUA"), texto);
  }
  assert.equal(clasificar(registro("BANCO PARA BATERIA"))[0].familia_id, "bancos_bateria");
  assert.equal(clasificar(registro("Platillos para bateria"))[0].familia_id, "platillos");
});

test("vocabulario general conserva plurales, erratas y accesorios fuera del corpus", () => {
  for (const [descripcion, familia] of [
    ["estéreos nuevos", "estereos"], ["reguladores", "reguladores"],
    ["inversores", "inversores"], ["no breaks", "no_break"],
    ["pistas LED", "pistas_led"], ["protoboards", "protoboards"],
    ["boquillas", "boquillas"], ["arneses", "arneses"],
    ["timbales", "timbales"], ["tambores", "tambores"],
    ["pata para bombo", "patas_bombo"], ["bancos para baterías", "bancos_bateria"],
    ["bocinas", "bocinas"], ["bafles", "bocinas"],
  ]) assert.equal(clasificar(registro(descripcion))[0].familia_id, familia, descripcion);
});

test("bombo y su errata real BONBO identifican el instrumento, sin absorber sus patas", () => {
  for (const descripcion of ["bombo", "BONBO", "bombos"]) {
    assert.equal(clasificar(registro(descripcion))[0].familia_id, "bombos");
  }
  assert.equal(clasificar(registro("PATA PARA BONBO"))[0].familia_id, "patas_bombo");
  assert.equal(clasificar(registro("parche 22 para bobo"))[0].familia_id, "parches");
});

test("cobertura del bloque real de guitarras: 12 de 13 reconocidos; diapason queda pendiente", (t) => {
  const textos = [
    "GUITARRA AZTECA", "GUITARRA DOCEROLA", "GUITARRA 12 CUERDAS", "GUITARRA GEWA",
    "guitarra", "GUITARRA Y VIOLIN", "guitarra economica", "guitarra fender",
    "GUITARRA NORMAL", "GUITARRA", "diapason para guitarra", "GUITARRA INFANTIL", "GUITARRA SEVILLANA",
  ];
  const sinClasificar = textos.filter((s) => clasificar(registro(s)).some((a) => a.familia_id === "por_clasificar"));
  assert.deepEqual(sinClasificar, ["diapason para guitarra"]);
  t.diagnostic("Guitarras: 12/13 textos reconocidos, 1 sin clasificar. Ambos bloques: 64/73 textos, 69/78 registros; 9 sin clasificar.");
});

// Trabajo 4: se ejercita la API real aquí para respetar el único archivo/comando
// de pruebas autorizado por el despacho; no se importa ninguna otra suite.
const motivosCierreReales = [
  "Cliente compró en otro lugar", "Precio", "Tiempo de entrega", "No respondió", "Perdió interés", "Otro",
];
const periodoCierre = { fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30" };
const alcanceCierre = { verTodas: true, sucursalId: null };
const demandaCerrada = (id, extra = {}) => registro("ESTEREO", {
  id, estado: "NO_CONVERTIDA", motivo_no_venta: "SIN_EXISTENCIA", ...extra,
});
const cierre = (id, demanda_id, comentario, extra = {}) => ({
  id, demanda_id, tipo: "CAMBIO_ESTADO", estado_anterior: "REGISTRADA", estado_nuevo: "NO_CONVERTIDA",
  fecha_hora: "2026-09-16T18:00:00.000Z", comentario, ...extra,
});
const baseCierres = (registros, seguimientos = []) => ({
  radar_demanda: { registros, seguimientos }, pos: { sucursales: [], ventas: [] },
});
const analizarCierres = (DB, alcance = alcanceCierre, filtros = periodoCierre) =>
  require("../radarDemanda").obtenerAnalisis(DB, alcance, filtros);

test("no concretadas: seis motivos reales separados del motivo inicial y sin alterar totales", () => {
  const demandas = motivosCierreReales.map((_, i) => demandaCerrada(i + 1));
  demandas.push(demandaCerrada(7, { estado: "REGISTRADA" }));
  const DB = baseCierres(demandas, motivosCierreReales.map((m, i) => cierre(i + 1, i + 1, m)));
  const antes = structuredClone(DB);
  const resultado = analizarCierres(DB);
  assert.ok(Array.isArray(resultado.motivos_no_conversion), "falta el desglose del cierre");
  for (const motivo of motivosCierreReales) {
    assert.deepEqual(resultado.motivos_no_conversion.find((m) => m.motivo === motivo),
      { motivo, cantidad: 1, porcentaje: 16.67 });
  }
  assert.equal(resultado.motivos_no_conversion.reduce((s, m) => s + m.cantidad, 0), 6);
  assert.deepEqual(resultado.motivos, analizarCierres(baseCierres(demandas)).motivos);
  assert.equal(resultado.motivos.find((m) => m.motivo === "SIN_EXISTENCIA").cantidad, 7);
  assert.equal(resultado.resumen.no_convertidas, 6);
  assert.equal(resultado.familias.solicitudes, 7);
  assert.equal(resultado.familias_pendientes.solicitudes, 1);
  assert.deepEqual(DB, antes);
});

test("cierre: usa la última transición real, nunca un seguimiento ni un cierre anterior", () => {
  const DB = baseCierres([demandaCerrada(1)], [
    cierre(6, 1, "Otro", { tipo: "SEGUIMIENTO", estado_anterior: "NO_CONVERTIDA", fecha_hora: "2026-09-19T18:00:00Z" }),
    cierre(4, 1, "Precio", { fecha_hora: "2026-09-18T18:00:00Z" }),
    cierre(3, 1, "No respondió", { fecha_hora: "2026-09-18T18:00:00Z" }),
    cierre(1, 1, "Cliente compró en otro lugar"),
    cierre(8, 1, "Otro", { estado_anterior: "NO_CONVERTIDA", fecha_hora: "2026-09-20T18:00:00Z" }),
  ]);
  const antes = structuredClone(DB);
  const resultado = analizarCierres(DB);
  assert.ok(Array.isArray(resultado.motivos_no_conversion));
  assert.deepEqual(resultado.motivos_no_conversion.filter((m) => m.cantidad), [
    { motivo: "Precio", cantidad: 1, porcentaje: 100 },
  ]);
  assert.deepEqual(DB, antes);
});

test("cierre: sin evidencia se reporta como tal, no se inventa Otro ni se lee el motivo inicial", () => {
  const DB = baseCierres([1, 2, 3, 4].map((id) => demandaCerrada(id, { motivo_no_venta: "PRECIO" })), [
    cierre(1, 2, ""), cierre(2, 3, "Quizá lo compre después"),
    cierre(3, 4, "Precio"), cierre(4, 4, "", { fecha_hora: "2026-09-17T18:00:00Z" }),
  ]);
  const resultado = analizarCierres(DB);
  assert.ok(Array.isArray(resultado.motivos_no_conversion));
  assert.deepEqual(resultado.motivos_no_conversion.filter((m) => m.cantidad), [
    { motivo: "Sin motivo registrado", cantidad: 3, porcentaje: 75 },
    { motivo: "Motivo no identificado", cantidad: 1, porcentaje: 25 },
  ]);
});

test("cierre: respeta sucursal, periodo de demanda y estado vigente", () => {
  const DB = baseCierres([
    demandaCerrada(1), demandaCerrada(2, { sucursal_id: 2 }),
    demandaCerrada(3, { fecha_registro: "2026-08-01" }),
    demandaCerrada(4, { estado: "CANCELADA" }), demandaCerrada(5, { estado: "CONVERTIDA" }),
    demandaCerrada(6, { estado: "REGISTRADA" }), demandaCerrada(7, { estado: "FUTURO" }),
  ], [1, 2, 3, 4, 5, 6, 7].map((id) => cierre(id, id, id === 1 ? "Precio" : "Otro")));
  const resultado = analizarCierres(DB, { verTodas: false, sucursalId: 1 });
  assert.ok(Array.isArray(resultado.motivos_no_conversion));
  assert.deepEqual(resultado.motivos_no_conversion.filter((m) => m.cantidad), [
    { motivo: "Precio", cantidad: 1, porcentaje: 100 },
  ]);
});

test("cierre: base congelada, historial ausente o dañado y cero cierres no rompen la lectura", () => {
  for (const seguimientos of [undefined, {}, [null, { tipo: "CAMBIO_ESTADO" }]]) {
    const DB = baseCierres([demandaCerrada(1)]);
    DB.radar_demanda.seguimientos = seguimientos;
    const congelar = (valor) => {
      if (valor && typeof valor === "object") { Object.values(valor).forEach(congelar); Object.freeze(valor); }
    };
    congelar(DB);
    const resultado = analizarCierres(DB);
    assert.ok(Array.isArray(resultado.motivos_no_conversion));
    assert.deepEqual(resultado.motivos_no_conversion.filter((m) => m.cantidad), [
      { motivo: "Sin motivo registrado", cantidad: 1, porcentaje: 100 },
    ]);
  }
  const vacio = analizarCierres(baseCierres([]));
  assert.ok(vacio.motivos_no_conversion.every((m) => m.cantidad === 0 && m.porcentaje === 0));
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
