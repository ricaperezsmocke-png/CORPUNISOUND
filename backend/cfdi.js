/**
 * cfdi.js — Lee facturas CFDI 4.0 (XML) de proveedores y extrae emisor,
 * folio fiscal y conceptos, para precargar una Recepción de Compras.
 * No escribe nada en la base de datos — solo parsea y devuelve datos.
 */

const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

function comoLista(valor) {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function parsearFacturaXML(xmlTexto) {
  let doc;
  try {
    doc = parser.parse(xmlTexto);
  } catch (e) {
    throw new Error("El archivo no se pudo leer como XML: " + e.message);
  }

  // Si el documento está vacío, significa que el input no era XML válido
  if (!doc || Object.keys(doc).length === 0) {
    throw new Error("El archivo no se pudo leer como XML");
  }

  const comprobante = doc["cfdi:Comprobante"];
  if (!comprobante) throw new Error("El archivo no es un CFDI válido (falta cfdi:Comprobante)");

  const emisorNodo = comprobante["cfdi:Emisor"];
  if (!emisorNodo) throw new Error("El CFDI no tiene información del emisor (cfdi:Emisor)");
  const emisor = { rfc: emisorNodo.Rfc || "", nombre: emisorNodo.Nombre || "" };

  const timbre = comprobante["cfdi:Complemento"]?.["tfd:TimbreFiscalDigital"];
  const folioFiscal = timbre ? timbre.UUID : null;

  const conceptosNodo = comprobante["cfdi:Conceptos"]?.["cfdi:Concepto"];
  const conceptos = comoLista(conceptosNodo).map((c) => {
    const traslados = comoLista(c["cfdi:Impuestos"]?.["cfdi:Traslados"]?.["cfdi:Traslado"]);
    const trasladoIva = traslados.find((t) => t.Impuesto === "002");
    return {
      clave_sat: c.ClaveProdServ || "",
      no_identificacion: c.NoIdentificacion || "",
      descripcion: c.Descripcion || "",
      cantidad: Number(c.Cantidad) || 0,
      valor_unitario: Number(c.ValorUnitario) || 0,
      importe: Number(c.Importe) || 0,
      aplica_iva: !!trasladoIva,
      tasa_iva: trasladoIva ? Number(trasladoIva.TasaOCuota) : 0,
    };
  });

  return {
    emisor,
    folioFiscal,
    fecha: comprobante.Fecha || null,
    conceptos,
  };
}

module.exports = { parsearFacturaXML };
