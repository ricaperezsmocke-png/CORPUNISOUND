/**
 * facturaIA.js — Extrae líneas de una factura o nota de remisión a partir
 * de una foto o PDF usando Claude (visión), para proveedores que no mandan
 * CFDI XML (ver cfdi.js para el caso que sí lo hace).
 *
 * El cliente de Anthropic se recibe como parámetro (en vez de importarlo
 * directamente) para poder probar este módulo con un cliente falso, sin
 * llamar a la API real.
 */

const TOOL_EXTRAER_FACTURA = {
  name: "extraer_factura",
  description: "Registra el resultado de leer una factura o nota de remisión en imagen o PDF.",
  input_schema: {
    type: "object",
    properties: {
      legible: {
        type: "boolean",
        description: "true si el documento se puede leer con confianza razonable; false si está borroso, cortado, mal iluminado o de alguna otra forma no se puede confiar en lo que dice.",
      },
      motivo_no_legible: {
        type: ["string", "null"],
        description: "Si legible es false, una explicación breve y concreta de por qué (ej. 'la foto está muy borrosa para leer las cantidades'). Si legible es true, usar null.",
      },
      conceptos: {
        type: "array",
        description: "Un elemento por cada línea/renglón de producto en el documento. Vacío si legible es false.",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string", description: "Descripción o nombre del producto tal como aparece en el documento." },
            cantidad: { type: "number", description: "Cantidad de ese producto." },
            costo_unitario: { type: "number", description: "Precio de compra unitario. Si el documento desglosa el IVA por separado, usa el precio SIN IVA (neto) de esa línea, no el total con impuesto." },
            aplica_iva: { type: "boolean", description: "true si esa línea lleva IVA aplicado según el documento." },
          },
          required: ["descripcion", "cantidad", "costo_unitario", "aplica_iva"],
        },
      },
    },
    required: ["legible", "conceptos"],
  },
};

function construirBloqueDocumento(archivoBase64, tipoMime) {
  if (tipoMime === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: archivoBase64 } };
  }
  return { type: "image", source: { type: "base64", media_type: tipoMime, data: archivoBase64 } };
}

async function analizarFacturaImagen(anthropic, archivoBase64, tipoMime) {
  const bloqueDocumento = construirBloqueDocumento(archivoBase64, tipoMime);

  const respuesta = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    tools: [TOOL_EXTRAER_FACTURA],
    tool_choice: { type: "tool", name: "extraer_factura" },
    messages: [{
      role: "user",
      content: [
        bloqueDocumento,
        {
          type: "text",
          text: "Esta imagen o PDF es una factura o nota de remisión de un proveedor. Primero evalúa si se puede leer con confianza razonable (campo legible). Si NO es legible, explica por qué en motivo_no_legible y deja conceptos como un arreglo vacío — no adivines datos que no se puedan leer con confianza. Si SÍ es legible, extrae cada línea de producto: descripción, cantidad, costo unitario (precio de compra neto, sin IVA, si el documento permite distinguirlo) y si esa línea aplica IVA. No inventes ni redondees datos que no estén claramente en el documento.",
        },
      ],
    }],
  });

  const bloqueHerramienta = respuesta.content.find((b) => b.type === "tool_use");
  if (!bloqueHerramienta) {
    throw new Error("Claude no devolvió un resultado estructurado — intenta de nuevo");
  }

  const resultado = bloqueHerramienta.input;
  if (!resultado.legible) {
    throw new Error(resultado.motivo_no_legible || "El documento no se pudo leer con confianza suficiente");
  }
  return { conceptos: resultado.conceptos || [] };
}

module.exports = { analizarFacturaImagen, TOOL_EXTRAER_FACTURA };
