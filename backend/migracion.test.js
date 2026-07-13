const { test } = require("node:test");
const assert = require("node:assert");
const XLSX = require("xlsx");
const { parsearExcel, previsualizarImportacion } = require("./migracion");

function construirExcelBase64(filas) {
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Datos");
  return XLSX.write(libro, { type: "base64", bookType: "xlsx" });
}

test("parsearExcel lee articulos con encabezados estandar", () => {
  const base64 = construirExcelBase64([
    { "Clave": "AB-001", "Descripción": "Arroz 1kg", "Costo": 20, "Existencia": 100 },
    { "Clave": "AB-002", "Descripción": "Frijol 1kg", "Costo": 18, "Existencia": 50 },
  ]);
  const { filas, columnas_reconocidas } = parsearExcel(base64, "articulos");
  assert.strictEqual(filas.length, 2);
  assert.strictEqual(filas[0].clave, "AB-001");
  assert.strictEqual(filas[0].descripcion, "Arroz 1kg");
  assert.strictEqual(filas[0].costo, 20);
  assert.strictEqual(filas[0].numero_fila, 2);
  assert.ok(columnas_reconocidas.includes("Clave"));
});

test("parsearExcel reconoce alias con acentos/mayusculas distintos", () => {
  const base64 = construirExcelBase64([
    { "codigo": "AB-001", "nombre": "Arroz 1kg" },
  ]);
  const { filas } = parsearExcel(base64, "articulos");
  assert.strictEqual(filas[0].clave, "AB-001");
  assert.strictEqual(filas[0].descripcion, "Arroz 1kg");
});

test("parsearExcel de articulos truena con mensaje claro si falta la clave", () => {
  const base64 = construirExcelBase64([{ "Descripción": "Arroz 1kg" }]);
  assert.throws(() => parsearExcel(base64, "articulos"), /Faltan columnas obligatorias.*clave/);
});

test("parsearExcel reporta columnas no reconocidas sin tronar", () => {
  const base64 = construirExcelBase64([
    { "Clave": "AB-001", "Descripción": "Arroz 1kg", "Columna Rara": "x" },
  ]);
  const { columnas_no_reconocidas } = parsearExcel(base64, "articulos");
  assert.ok(columnas_no_reconocidas.includes("Columna Rara"));
});

test("parsearExcel de clientes exige clave y nombre", () => {
  const base64 = construirExcelBase64([{ "Clave": "CLI001", "Nombre": "Abarrotes Mary", "RFC": "XAXX010101000" }]);
  const { filas } = parsearExcel(base64, "clientes");
  assert.strictEqual(filas[0].clave, "CLI001");
  assert.strictEqual(filas[0].nombre, "Abarrotes Mary");
});

test("parsearExcel de proveedores exige rfc y nombre", () => {
  const base64 = construirExcelBase64([{ "RFC": "DINX800101ABC", "Nombre": "Distribuidora del Norte" }]);
  const { filas } = parsearExcel(base64, "proveedores");
  assert.strictEqual(filas[0].rfc, "DINX800101ABC");
  assert.strictEqual(filas[0].nombre, "Distribuidora del Norte");
});

test("parsearExcel truena con mensaje claro si el archivo no es un Excel valido", () => {
  // XLSX.read tiene un fallback de texto/CSV muy permisivo: texto plano sin
  // saltos de línea no lo hace tronar (se interpreta como una sola fila de
  // encabezado sin datos). Para forzar un error real de lectura truncamos
  // un .xlsx válido a solo sus primeros bytes: queda un ZIP incompleto que
  // SheetJS no puede abrir.
  const hoja = XLSX.utils.json_to_sheet([{ Clave: "AB-001" }]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Datos");
  const bufferCompleto = XLSX.write(libro, { type: "buffer", bookType: "xlsx" });
  const truncado = bufferCompleto.subarray(0, 10).toString("base64");
  assert.throws(() => parsearExcel(truncado, "articulos"), /no se pudo leer como Excel/);
});

test("parsearExcel truena con mensaje claro si el archivo no tiene filas de datos", () => {
  const hoja = XLSX.utils.aoa_to_sheet([["Clave", "Descripción"]]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Datos");
  const base64 = XLSX.write(libro, { type: "base64", bookType: "xlsx" });
  assert.throws(() => parsearExcel(base64, "articulos"), /no tiene filas de datos/);
});

test("parsearExcel truena si el tipo es desconocido", () => {
  const base64 = construirExcelBase64([{ "Clave": "AB-001", "Descripción": "x" }]);
  assert.throws(() => parsearExcel(base64, "insumos"), /Tipo de importación desconocido/);
});

const { construirDBPrueba } = require("./testHelpers");

test("previsualizarImportacion marca actualizacion si la clave del articulo ya existe", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "AB-001", descripcion: "Arroz 1kg editado", costo: 22 }];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 1);
  assert.strictEqual(resumen.actualizaciones, 1);
  assert.strictEqual(resumen.altas, 0);
});

test("previsualizarImportacion marca alta si la clave del articulo no existe", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "NUEVO-001", descripcion: "Guitarra acustica" }];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].accion, "alta");
  assert.strictEqual(resultado[0].id_existente, null);
  assert.strictEqual(resumen.altas, 1);
});

test("previsualizarImportacion marca invalida una fila sin clave, sin tumbar las demas", () => {
  const DB = construirDBPrueba();
  const filas = [
    { numero_fila: 2, clave: "", descripcion: "Sin clave" },
    { numero_fila: 3, clave: "NUEVO-002", descripcion: "Otra" },
  ];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].valida, false);
  assert.ok(resultado[0].errores.length > 0);
  assert.strictEqual(resultado[1].valida, true);
  assert.strictEqual(resumen.invalidas, 1);
});

test("previsualizarImportacion marca invalida un costo no numerico", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "AB-001", descripcion: "Arroz", costo: "no-es-numero" }];
  const { filas: resultado } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].valida, false);
});

test("previsualizarImportacion de clientes hace match por clave", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Abarrotes Mary S.A." }];
  const { filas: resultado } = previsualizarImportacion(DB, "clientes", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 1);
});

test("previsualizarImportacion de proveedores hace match por rfc", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, rfc: "PROV-RFC-YA-EXISTE", nombre: "Cualquiera" }];
  DB["catalogo-productos"].proveedores.push({ id: 9, nombre: "Viejo", rfc: "PROV-RFC-YA-EXISTE", contacto: "" });
  const { filas: resultado } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 9);
});
