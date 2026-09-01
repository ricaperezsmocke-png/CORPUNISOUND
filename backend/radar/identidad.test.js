const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  UMBRAL_PARECIDO,
  crearBolsaPalabras,
  calcularSimilitud,
  agruparRegistrosLibres,
} = require("./identidad");

function registro(id, producto_buscado, cambios = {}) {
  return {
    id,
    producto_buscado,
    marca_solicitada: "",
    modelo_solicitado: "",
    variante_solicitada: "",
    categoria_solicitada: "",
    fecha_registro: `2026-08-${String(id).padStart(2, "0")}T12:00:00.000Z`,
    ...cambios,
  };
}

test("normaliza campos como bolsa ordenada sin categoria", () => {
  const bolsa = crearBolsaPalabras(registro(1, " BOCINAS de 2 mts ", {
    marca_solicitada: "JBL",
    variante_solicitada: "NEGRA negra",
    categoria_solicitada: "Audio profesional",
  }));
  assert.deepEqual(bolsa, ["2metros", "bocina", "jbl", "negra"]);
});

test("unifica las variantes de unidades pegadas al numero", () => {
  const formas = ["2m", "2 mt", "2 mts", "2\"", "2''", "2 pulg", "2 pulgadas", "20 watts", "127 volts"];
  assert.deepEqual(formas.map((forma) => crearBolsaPalabras(registro(1, forma))[0]), [
    "2metros", "2metros", "2metros", "2pulgadas", "2pulgadas", "2pulgadas", "2pulgadas", "20w", "127v",
  ]);
});

test("aplica candado de numeros antes del parecido", () => {
  assert.equal(calcularSimilitud(
    crearBolsaPalabras(registro(1, "cable HDMI 2m")),
    crearBolsaPalabras(registro(2, "cable hdmi de 20m")),
  ), 0);
  assert.equal(calcularSimilitud(
    crearBolsaPalabras(registro(1, "EON615")),
    crearBolsaPalabras(registro(2, "EON615S")),
  ), 0);
});

test("el candado de numeros separa grupos incluso con umbral cero", () => {
  assert.equal(agruparRegistrosLibres([
    registro(1, "cable HDMI 2m"),
    registro(2, "cable hdmi de 20m"),
    registro(3, "EON615"),
    registro(4, "EON615S"),
  ], 0).length, 4);
});

test("empareja erratas largas pero no palabras cortas", () => {
  assert.equal(calcularSimilitud(["amolificador"], ["amplificador"]), 1);
  assert.equal(calcularSimilitud(["din"], ["dim"]), 0);
});

test("agrupa variantes contra el lider sin encadenar", () => {
  const grupos = agruparRegistrosLibres([
    registro(1, "Bocina JBL EON615"),
    registro(2, "bocina", { marca_solicitada: "JBL", modelo_solicitado: "EON615" }),
    registro(3, "BOCINAS JBL EON615 negra"),
    registro(4, "bosina jbl eon615"),
  ]);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].registros.length, 4);
});

test("no crea grupo para registros sin identidad", () => {
  assert.deepEqual(agruparRegistrosLibres([registro(1, "")]), []);
});

test("elige como lider la forma mas escrita y desempata por la mas reciente", () => {
  const grupos = agruparRegistrosLibres([
    registro(1, "Bocina JBL EON615"),
    registro(2, "bosina jbl eon615"),
    registro(3, "bosina jbl eon615"),
    registro(4, "Bocina JBL EON615"),
  ]);
  assert.equal(grupos[0].lider, "Bocina JBL EON615");
  assert.equal(grupos[0].formas_distintas, 2);
  assert.deepEqual(grupos[0].formas, [
    { forma: "Bocina JBL EON615", apariciones: 2, similitud: 1 },
    { forma: "bosina jbl eon615", apariciones: 2, similitud: 1 },
  ]);
});

test("desempata formas por la que tiene mas campos llenos antes de la fecha", () => {
  const mismaFecha = "2026-08-20T12:00:00.000Z";
  const grupos = agruparRegistrosLibres([
    registro(1, "Bocina JBL EON615", { fecha_registro: mismaFecha }),
    registro(2, "BOCINAS JBL EON615 negra", { fecha_registro: mismaFecha }),
    registro(3, "bosina jbl eon615", { fecha_registro: mismaFecha }),
    registro(4, "bocina", {
      marca_solicitada: "JBL",
      modelo_solicitado: "EON615",
      fecha_registro: mismaFecha,
    }),
  ]);

  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].lider, "bocina JBL EON615");
});

test("la similitud de las formas explica el lider fijo del agrupamiento", () => {
  const grupos = agruparRegistrosLibres([
    registro(1, "abcdefgh"),
    registro(2, "ABCDEFGH"),
    registro(3, "abcdefgh"),
    registro(4, "ABCDEFGH"),
    registro(5, "xbcdefgh"),
    registro(6, "xbcdefgh"),
    registro(7, "xbcdefgh"),
    registro(8, "abcdeyzh"),
  ]);
  assert.equal(grupos[0].lider, "xbcdefgh");
  assert.equal(grupos[0].formas.find((forma) => forma.forma === "abcdeyzh").similitud, 1);
});

test("el agrupamiento no depende del orden de entrada", () => {
  const registros = [
    registro(1, "cable HDMI 2m"),
    registro(2, "Cable HDMI de 2 metros"),
    registro(3, "cable hdmi de 20m"),
    registro(4, "Cable HDMI 2 metros", { categoria_solicitada: "Cables" }),
  ];
  const resumir = (grupos) => grupos.map((grupo) => ({
    lider: grupo.lider,
    ids: grupo.registros.map((item) => item.id).sort((a, b) => a - b),
  }));
  assert.deepEqual(resumir(agruparRegistrosLibres(registros)), resumir(agruparRegistrosLibres([...registros].reverse())));
});

test("expone el umbral unico acordado", () => {
  assert.equal(UMBRAL_PARECIDO, 0.8);
});
