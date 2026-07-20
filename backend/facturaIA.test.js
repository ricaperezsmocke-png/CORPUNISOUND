const { test } = require("node:test");
const assert = require("node:assert");
const { analizarFacturaImagen, TOOL_EXTRAER_FACTURA } = require("./facturaIA");

function anthropicFalso(respuestaTool) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "tool_use", name: "extraer_factura", input: respuestaTool }],
      }),
    },
  };
}

test("analizarFacturaImagen regresa los conceptos cuando el documento es legible", async () => {
  const anthropic = anthropicFalso({
    legible: true,
    motivo_no_legible: null,
    conceptos: [
      { descripcion: "Cuerdas de guitarra acústica", cantidad: 10, costo_unitario: 45.5, aplica_iva: true },
      { descripcion: "Baquetas 5A", cantidad: 6, costo_unitario: 60, aplica_iva: false },
    ],
  });

  const resultado = await analizarFacturaImagen(anthropic, "ZmFrZS1iYXNlNjQ=", "image/jpeg");

  assert.strictEqual(resultado.conceptos.length, 2);
  assert.strictEqual(resultado.conceptos[0].descripcion, "Cuerdas de guitarra acústica");
  assert.strictEqual(resultado.conceptos[0].cantidad, 10);
  assert.strictEqual(resultado.conceptos[0].costo_unitario, 45.5);
  assert.strictEqual(resultado.conceptos[0].aplica_iva, true);
  assert.strictEqual(resultado.conceptos[1].aplica_iva, false);
});

test("analizarFacturaImagen lanza error con el motivo cuando el documento no es legible", async () => {
  const anthropic = anthropicFalso({
    legible: false,
    motivo_no_legible: "La foto está muy borrosa para leer las cantidades y precios",
    conceptos: [],
  });

  await assert.rejects(
    () => analizarFacturaImagen(anthropic, "ZmFrZS1iYXNlNjQ=", "image/jpeg"),
    /La foto está muy borrosa/
  );
});

test("analizarFacturaImagen lanza un error claro si Claude no regresa un tool_use", async () => {
  const anthropic = {
    messages: {
      create: async () => ({ content: [{ type: "text", text: "No puedo ayudar con eso" }] }),
    },
  };

  await assert.rejects(
    () => analizarFacturaImagen(anthropic, "ZmFrZS1iYXNlNjQ=", "image/jpeg"),
    /Claude no devolvió un resultado estructurado/
  );
});

test("analizarFacturaImagen manda un bloque type: document para PDF y type: image para JPG/PNG", async () => {
  let contenidoEnviado = null;
  const anthropic = {
    messages: {
      create: async (params) => {
        contenidoEnviado = params.messages[0].content;
        return { content: [{ type: "tool_use", name: "extraer_factura", input: { legible: true, motivo_no_legible: null, conceptos: [] } }] };
      },
    },
  };

  await analizarFacturaImagen(anthropic, "ZmFrZS1wZGY=", "application/pdf");
  assert.strictEqual(contenidoEnviado[0].type, "document");
  assert.strictEqual(contenidoEnviado[0].source.media_type, "application/pdf");

  await analizarFacturaImagen(anthropic, "ZmFrZS1qcGc=", "image/jpeg");
  assert.strictEqual(contenidoEnviado[0].type, "image");
  assert.strictEqual(contenidoEnviado[0].source.media_type, "image/jpeg");
});

test("analizarFacturaImagen propaga el campo codigo de cada concepto cuando Claude lo incluye", async () => {
  const anthropic = anthropicFalso({
    legible: true,
    motivo_no_legible: null,
    conceptos: [
      { descripcion: "Cuerdas de guitarra acústica", codigo: "CG-100", cantidad: 10, costo_unitario: 45.5, aplica_iva: true },
      { descripcion: "Producto sin código en la factura", codigo: null, cantidad: 1, costo_unitario: 20, aplica_iva: false },
    ],
  });

  const resultado = await analizarFacturaImagen(anthropic, "ZmFrZS1iYXNlNjQ=", "image/jpeg");

  assert.strictEqual(resultado.conceptos[0].codigo, "CG-100");
  assert.strictEqual(resultado.conceptos[1].codigo, null);
});

test("TOOL_EXTRAER_FACTURA declara codigo como opcional en el schema de cada concepto", () => {
  const propiedadesConcepto = TOOL_EXTRAER_FACTURA.input_schema.properties.conceptos.items;
  assert.ok(propiedadesConcepto.properties.codigo, "el schema debe declarar la propiedad codigo");
  assert.ok(!propiedadesConcepto.required.includes("codigo"), "codigo no debe ser requerido");
});

test("TOOL_EXTRAER_FACTURA exige legible y conceptos en su schema", () => {
  assert.strictEqual(TOOL_EXTRAER_FACTURA.name, "extraer_factura");
  assert.ok(TOOL_EXTRAER_FACTURA.input_schema.required.includes("legible"));
  assert.ok(TOOL_EXTRAER_FACTURA.input_schema.required.includes("conceptos"));
});
