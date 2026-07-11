const { test } = require("node:test");
const assert = require("node:assert");
const { parsearFacturaXML } = require("./cfdi");

const CFDI_MUESTRA = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Fecha="2026-07-01T12:00:00" SubTotal="13981.032" Total="16217.997" Moneda="MXN" TipoDeComprobante="I">
  <cfdi:Emisor Rfc="DINX800101ABC" Nombre="Distribuidora del Norte SA de CV" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="UNI010101XXX" Nombre="Unisound" DomicilioFiscalReceptor="29000" RegimenFiscalReceptor="601" UsoCFDI="G01" />
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="52161547" NoIdentificacion="PROV-AMP-40" Cantidad="1" ClaveUnidad="H87" Unidad="Pieza"
      Descripcion="HCF-PRO-40 AMPLIFICADOR DE POTENCIA 4000W RMS" ValorUnitario="13981.032" Importe="13981.032" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="13981.032" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="2236.965" />
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="ABCDEF12-3456-7890-ABCD-EF1234567890" FechaTimbrado="2026-07-01T12:05:00" />
  </cfdi:Complemento>
</cfdi:Comprobante>`;

test("parsearFacturaXML extrae el emisor correctamente", () => {
  const resultado = parsearFacturaXML(CFDI_MUESTRA);
  assert.strictEqual(resultado.emisor.rfc, "DINX800101ABC");
  assert.strictEqual(resultado.emisor.nombre, "Distribuidora del Norte SA de CV");
});

test("parsearFacturaXML extrae el folio fiscal (UUID) del timbre", () => {
  const resultado = parsearFacturaXML(CFDI_MUESTRA);
  assert.strictEqual(resultado.folioFiscal, "ABCDEF12-3456-7890-ABCD-EF1234567890");
});

test("parsearFacturaXML extrae un concepto con su IVA", () => {
  const resultado = parsearFacturaXML(CFDI_MUESTRA);
  assert.strictEqual(resultado.conceptos.length, 1);
  const c = resultado.conceptos[0];
  assert.strictEqual(c.clave_sat, "52161547");
  assert.strictEqual(c.no_identificacion, "PROV-AMP-40");
  assert.strictEqual(c.descripcion, "HCF-PRO-40 AMPLIFICADOR DE POTENCIA 4000W RMS");
  assert.strictEqual(c.cantidad, 1);
  assert.strictEqual(c.valor_unitario, 13981.032);
  assert.strictEqual(c.aplica_iva, true);
  assert.strictEqual(c.tasa_iva, 0.16);
});

test("parsearFacturaXML con múltiples conceptos los devuelve todos como arreglo", () => {
  const conDosConceptos = CFDI_MUESTRA.replace(
    "</cfdi:Conceptos>",
    `<cfdi:Concepto ClaveProdServ="52161548" NoIdentificacion="PROV-CAB-1" Cantidad="2" ClaveUnidad="H87" Unidad="Pieza"
      Descripcion="Cable de audio 6m" ValorUnitario="150.00" Importe="300.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="300.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="48.00" /></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto></cfdi:Conceptos>`
  );
  const resultado = parsearFacturaXML(conDosConceptos);
  assert.strictEqual(resultado.conceptos.length, 2);
  assert.strictEqual(resultado.conceptos[1].descripcion, "Cable de audio 6m");
});

test("parsearFacturaXML rechaza un XML que no es un CFDI", () => {
  assert.throws(() => parsearFacturaXML("<algo>no es factura</algo>"), /no es un CFDI válido/);
});

test("parsearFacturaXML rechaza texto que no es XML", () => {
  assert.throws(() => parsearFacturaXML("esto no es xml para nada {}"), /no se pudo leer como XML/);
});
