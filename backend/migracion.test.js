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

test("parsearExcel de articulos reconoce el encabezado real de SICAR IMPUESTO (S/N) para iva", () => {
  const base64 = construirExcelBase64([
    { "Clave": "AB-001", "Descripción": "Arroz 1kg", "IMPUESTO (S/N)": "S" },
  ]);
  const { filas, columnas_reconocidas } = parsearExcel(base64, "articulos");
  assert.strictEqual(filas[0].iva, "S");
  assert.ok(columnas_reconocidas.includes("IMPUESTO (S/N)"));
});

test("aplicarImportacion de articulos: IMPUESTO (S/N) = S da iva true end-to-end", () => {
  const DB = construirDBPrueba();
  const base64 = construirExcelBase64([
    { "Clave": "GTR-010", "Descripción": "Guitarra con IVA", "IMPUESTO (S/N)": "S" },
  ]);
  const { filas } = parsearExcel(base64, "articulos");
  const defaults = { categoria: "Instrumentos", departamento: "Cuerdas", unidad: "PZA" };
  aplicarImportacion(DB, "articulos", filas, 1, defaults, "test.xlsx");
  const nuevo = DB["catalogo-productos"].productos.find((p) => p.sku === "GTR-010");
  assert.strictEqual(nuevo.iva, true);
});

test("aplicarImportacion de articulos: IMPUESTO (S/N) = N da iva false end-to-end (bug real: 'N' normalizaba a 'n', que no estaba en la lista de valores falsos)", () => {
  const DB = construirDBPrueba();
  const base64 = construirExcelBase64([
    { "Clave": "GTR-011", "Descripción": "Guitarra sin IVA", "IMPUESTO (S/N)": "N" },
  ]);
  const { filas } = parsearExcel(base64, "articulos");
  const defaults = { categoria: "Instrumentos", departamento: "Cuerdas", unidad: "PZA" };
  aplicarImportacion(DB, "articulos", filas, 1, defaults, "test.xlsx");
  const nuevo = DB["catalogo-productos"].productos.find((p) => p.sku === "GTR-011");
  assert.strictEqual(nuevo.iva, false);
});

test("parsearExcel de clientes reconoce clave cuando esta presente (campo opcional, no obligatorio)", () => {
  const base64 = construirExcelBase64([{ "Clave": "CLI001", "Nombre": "Abarrotes Mary", "RFC": "XAXX010101000" }]);
  const { filas } = parsearExcel(base64, "clientes");
  assert.strictEqual(filas[0].clave, "CLI001");
  assert.strictEqual(filas[0].nombre, "Abarrotes Mary");
});

test("parsearExcel de clientes con encabezados reales de SICAR (sin columna de Clave) no truena", () => {
  // El SICAR real de Victor no tiene columna de Clave/Código para Clientes
  // en absoluto (confirmado leyendo el archivo). Antes, COLUMNAS_MINIMAS
  // exigia clave y esto tronaba con "Faltan columnas obligatorias (clave)".
  const base64 = construirExcelBase64([
    {
      "NOMBRE": "Cliente Ejemplo Uno",
      "RFC": "XAXX010101000",
      "TELÉFONO": "9191234567",
      "EMAILS": "cliente@ejemplo.com",
      "LIMITE DE CRÉDITO": 1000,
      "DIAS DE CRÉDITO": 30,
    },
  ]);
  const { filas } = parsearExcel(base64, "clientes");
  assert.strictEqual(filas[0].nombre, "Cliente Ejemplo Uno");
  assert.strictEqual(filas[0].rfc, "XAXX010101000");
  assert.strictEqual(filas[0].telefono, "9191234567");
  assert.strictEqual(filas[0].email, "cliente@ejemplo.com");
  assert.strictEqual(filas[0].limite_credito, 1000);
  assert.strictEqual(filas[0].dias_credito, 30);
  assert.strictEqual(filas[0].clave, undefined);
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

test("parsearExcel normaliza una Clave numerica (celda de Excel sin formato de texto) a string", () => {
  // XLSX.sheet_to_json regresa las celdas que parecen numero como Number de
  // JS, no como string. Si un SICAR real trae la Clave como "12345" sin
  // formato de texto, esto debe salir como "12345" (string), no 12345 (number).
  const base64 = construirExcelBase64([
    { "Clave": 12345, "Descripción": "Arroz 1kg" },
  ]);
  const { filas } = parsearExcel(base64, "articulos");
  assert.strictEqual(filas[0].clave, "12345");
  assert.strictEqual(typeof filas[0].clave, "string");
});

test("parsearExcel normaliza un RFC numerico a string", () => {
  const base64 = construirExcelBase64([
    { "RFC": 800101123, "Nombre": "Proveedor con RFC numerico" },
  ]);
  const { filas } = parsearExcel(base64, "proveedores");
  assert.strictEqual(filas[0].rfc, "800101123");
  assert.strictEqual(typeof filas[0].rfc, "string");
});

test("parsearExcel no convierte clave/rfc ausentes en el string literal 'undefined'", () => {
  const base64 = construirExcelBase64([
    { "Clave": "AB-001", "Descripción": "Arroz 1kg" },
  ]);
  const { filas } = parsearExcel(base64, "articulos");
  assert.strictEqual(filas[0].clave_alterna, undefined);
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

test("previsualizarImportacion de articulos hace match por clave_alterna si no coincide el sku", () => {
  const DB = construirDBPrueba();
  const producto = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  producto.clave_alterna = "COD-BARRAS-123";
  const filas = [{ numero_fila: 2, clave: "COD-BARRAS-123", descripcion: "Arroz 1kg" }];
  const { filas: resultado } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, producto.id);
});

test("previsualizarImportacion de articulos: una Clave numerica en el Excel si matchea contra un sku string ya existente (fix celdas numericas)", () => {
  const DB = construirDBPrueba();
  const producto = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  producto.sku = "12345"; // sku string, como los guarda CORPUNISOUND
  const base64 = construirExcelBase64([{ "Clave": 12345, "Descripción": "Arroz 1kg editado" }]);
  const { filas } = parsearExcel(base64, "articulos");
  const { filas: resultado } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, producto.id);
});

test("previsualizarImportacion de clientes hace match por clave", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Abarrotes Mary S.A." }];
  const { filas: resultado } = previsualizarImportacion(DB, "clientes", filas, 1);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 1);
});

test("previsualizarImportacion de clientes: mismo clave en OTRA sucursal es alta, no actualizacion (evita mezclar clientes de sucursales distintas)", () => {
  const DB = construirDBPrueba();
  // CLI001 existe en sucursal_id 1 (ver testHelpers). SICAR numera clientes
  // independientemente por instalación/sucursal, así que una Clave repetida
  // en otra sucursal es una persona DISTINTA — nunca debe matchear/pisar.
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Otro negocio, misma clave en Yajalón" }];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "clientes", filas, 2);
  assert.strictEqual(resultado[0].accion, "alta");
  assert.strictEqual(resultado[0].id_existente, null);
  assert.strictEqual(resumen.altas, 1);
  assert.strictEqual(resumen.actualizaciones, 0);
});

test("previsualizarImportacion marca alta si la clave del cliente no existe", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI-NUEVO", nombre: "Cliente Nuevo" }];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "clientes", filas);
  assert.strictEqual(resultado[0].accion, "alta");
  assert.strictEqual(resultado[0].id_existente, null);
  assert.strictEqual(resumen.altas, 1);
});

test("previsualizarImportacion de clientes: fila sin clave es valida y siempre se marca alta (SICAR real no trae Clave para Clientes)", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "", nombre: "Sin clave" }];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "clientes", filas, 1);
  assert.strictEqual(resultado[0].valida, true);
  assert.strictEqual(resultado[0].errores.length, 0);
  assert.strictEqual(resultado[0].accion, "alta");
  assert.strictEqual(resumen.altas, 1);
});

test("previsualizarImportacion marca invalido un cliente sin nombre (nombre sigue siendo obligatorio)", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "", nombre: "" }];
  const { filas: resultado } = previsualizarImportacion(DB, "clientes", filas);
  assert.strictEqual(resultado[0].valida, false);
  assert.ok(resultado[0].errores.length > 0);
});

test("previsualizarImportacion marca invalido un limite_credito no numerico", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Abarrotes Mary", limite_credito: "no-es-numero" }];
  const { filas: resultado } = previsualizarImportacion(DB, "clientes", filas);
  assert.strictEqual(resultado[0].valida, false);
  assert.ok(resultado[0].errores.length > 0);
});

test("previsualizarImportacion de proveedores hace match por rfc", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, rfc: "PROV-RFC-YA-EXISTE", nombre: "Cualquiera" }];
  DB["catalogo-productos"].proveedores.push({ id: 9, nombre: "Viejo", rfc: "PROV-RFC-YA-EXISTE", contacto: "" });
  const { filas: resultado } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 9);
});

test("previsualizarImportacion marca alta si el rfc del proveedor no existe", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, rfc: "RFC-NUEVO-000", nombre: "Proveedor Nuevo" }];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].accion, "alta");
  assert.strictEqual(resultado[0].id_existente, null);
  assert.strictEqual(resumen.altas, 1);
});

test("previsualizarImportacion de proveedores: fila sin rfc es valida (61% de los proveedores reales de SICAR no traen RFC)", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, rfc: "", nombre: "Sin RFC" }];
  const { filas: resultado } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].valida, true);
  assert.strictEqual(resultado[0].errores.length, 0);
});

test("previsualizarImportacion marca invalido un proveedor sin nombre (nombre sigue siendo obligatorio)", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, rfc: "RFC-ALGO", nombre: "" }];
  const { filas: resultado } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].valida, false);
  assert.ok(resultado[0].errores.length > 0);
});

test("previsualizarImportacion de proveedores: sin rfc, matchea por nombre normalizado contra un proveedor existente", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].proveedores.push({ id: 20, nombre: "Distribuidora del Sur", rfc: "", contacto: "" });
  const filas = [{ numero_fila: 2, rfc: "", nombre: "DISTRIBUIDORA DEL SUR" }];
  const { filas: resultado } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 20);
});

test("previsualizarImportacion de proveedores: sin rfc y sin match de nombre es alta", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, rfc: "", nombre: "Proveedor Totalmente Nuevo" }];
  const { filas: resultado } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].accion, "alta");
  assert.strictEqual(resultado[0].id_existente, null);
});

test("previsualizarImportacion de proveedores: con rfc presente sigue matcheando por rfc, no por nombre (regresion)", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].proveedores.push({ id: 21, nombre: "Nombre Viejo", rfc: "RFC-REAL-001", contacto: "" });
  const filas = [{ numero_fila: 2, rfc: "RFC-REAL-001", nombre: "Nombre Completamente Distinto" }];
  const { filas: resultado } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 21);
});

const { aplicarImportacion } = require("./migracion");

test("aplicarImportacion de articulos: alta nueva usa los defaults si el archivo no trae categoria/departamento/unidad", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "GTR-001", descripcion: "Guitarra acústica", costo: 1000, existencia: 5 }];
  const resumen = aplicarImportacion(DB, "articulos", filas, 1, { categoria: "Instrumentos", departamento: "Cuerdas", unidad: "PZA" }, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 1);
  assert.strictEqual(resumen.errores.length, 0);
  const nuevo = DB["catalogo-productos"].productos.find((p) => p.sku === "GTR-001");
  assert.ok(nuevo, "el producto debe haberse creado");
  const categoria = DB["catalogo-productos"].categorias.find((c) => c.id === nuevo.categoria_id);
  assert.strictEqual(categoria.nombre, "Instrumentos");
});

test("aplicarImportacion de articulos: alta nueva sin defaults ni datos en el archivo se reporta como error, no truena", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "GTR-002", descripcion: "Guitarra sin categoria" }];
  const resumen = aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 0);
  assert.strictEqual(resumen.errores.length, 1);
  assert.strictEqual(resumen.errores[0].numero_fila, 2);
});

test("aplicarImportacion de articulos: actualizacion solo cambia los campos presentes en el archivo", () => {
  const DB = construirDBPrueba();
  const antes = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  const nombreAntes = antes.nombre;
  const filas = [{ numero_fila: 2, clave: "AB-001", descripcion: undefined, costo: 25 }];
  aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  const despues = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  assert.strictEqual(despues.nombre, nombreAntes, "la descripcion no debia cambiar (no vino en el archivo)");
  assert.strictEqual(despues.costo, 25);
});

test("aplicarImportacion de articulos: ajusta la existencia al VALOR del archivo, no la suma", () => {
  const DB = construirDBPrueba();
  const existAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  const filas = [{ numero_fila: 2, clave: "AB-001", existencia: existAntes + 7 }];
  aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  const existDespues = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  assert.strictEqual(existDespues, existAntes + 7);
});

test("aplicarImportacion de articulos: una fila con error no bloquea las demas", () => {
  const DB = construirDBPrueba();
  const filas = [
    { numero_fila: 2, clave: "GTR-003", descripcion: "Sin categoria, debe fallar" },
    { numero_fila: 3, clave: "AB-001", costo: 30 },
  ];
  const resumen = aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  assert.strictEqual(resumen.errores.length, 1);
  assert.strictEqual(resumen.actualizados, 1);
  const actualizado = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  assert.strictEqual(actualizado.costo, 30);
});

test("aplicarImportacion de articulos: si el archivo trae precios, la utilidad se recalcula hacia atras desde el costo", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "AB-001", costo: 20, precio1: 30 }];
  aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  const actualizado = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  assert.strictEqual(actualizado.precios[0].precioVenta, 30);
  assert.strictEqual(actualizado.precios[0].utilidad, 50);
});

test("aplicarImportacion de articulos: reimportar el mismo archivo no duplica (segunda pasada es actualizacion)", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "NUEVO-XYZ", descripcion: "Pandereta" }];
  const defaults = { categoria: "Percusiones", departamento: "Percusiones", unidad: "PZA" };
  aplicarImportacion(DB, "articulos", filas, 1, defaults, "test.xlsx");
  const totalTrasPrimera = DB["catalogo-productos"].productos.length;
  aplicarImportacion(DB, "articulos", filas, 1, defaults, "test.xlsx");
  assert.strictEqual(DB["catalogo-productos"].productos.length, totalTrasPrimera, "no debe haber creado un segundo producto");
});

test("aplicarImportacion de articulos: alta sin descripcion se reporta como error y NO crea categoria/departamento huerfanos", () => {
  const DB = construirDBPrueba();
  const categoriasAntes = DB["catalogo-productos"].categorias.length;
  const departamentosAntes = DB["catalogo-productos"].departamentos.length;
  const filas = [{ numero_fila: 2, clave: "GTR-004", categoria: "Instrumentos Nuevos", departamento: "Cuerdas Nuevas", unidad: "PZA" }];
  const resumen = aplicarImportacion(DB, "articulos", filas, 1, {}, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 0);
  assert.strictEqual(resumen.errores.length, 1);
  assert.strictEqual(resumen.errores[0].numero_fila, 2);
  assert.strictEqual(DB["catalogo-productos"].categorias.length, categoriasAntes, "no debio crear la categoria huerfana");
  assert.strictEqual(DB["catalogo-productos"].departamentos.length, departamentosAntes, "no debio crear el departamento huerfano");
  assert.ok(!DB["catalogo-productos"].categorias.some((c) => c.nombre === "Instrumentos Nuevos"));
  assert.ok(!DB["catalogo-productos"].departamentos.some((d) => d.nombre === "Cuerdas Nuevas"));
});

test("aplicarImportacion de articulos: actualizacion NO aplica defaults del lote a categoria/departamento/unidad/iva omitidos en la fila", () => {
  const DB = construirDBPrueba();
  const antes = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  const categoriaIdAntes = antes.categoria_id;
  const departamentoIdAntes = antes.departamento_id;
  const unidadVentaAntes = antes.unidad_venta;
  const ivaAntes = antes.iva;
  const defaults = { categoria: "Instrumentos", departamento: "Cuerdas", unidad: "CAJA", iva: true };
  const filas = [{ numero_fila: 2, clave: "AB-001", costo: 21 }];
  aplicarImportacion(DB, "articulos", filas, 1, defaults, "test.xlsx");
  const despues = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  assert.strictEqual(despues.costo, 21, "el costo si venia en el archivo, debe cambiar");
  assert.strictEqual(despues.categoria_id, categoriaIdAntes, "la categoria no debia cambiar por el default del lote");
  assert.strictEqual(despues.departamento_id, departamentoIdAntes, "el departamento no debia cambiar por el default del lote");
  assert.strictEqual(despues.unidad_venta, unidadVentaAntes, "la unidad no debia cambiar por el default del lote");
  assert.strictEqual(despues.iva, ivaAntes, "el iva no debia cambiar por el default del lote");
});

test("aplicarImportacion de articulos: si ajustar existencia fallaria (sin registro en esa sucursal), la fila falla SIN mutar el producto", () => {
  const DB = construirDBPrueba();
  // El producto AB-001 (id 1) solo tiene fila de existencia en la sucursal 1
  // (ver testHelpers.js) — igual que un articulo dado de alta antes de que
  // existiera CEDIS (sucursal 6). Importar hacia la sucursal 6 con una
  // existencia en el archivo debe fallar SIN aplicar el resto de cambios.
  const antes = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  const costoAntes = antes.costo;
  const nombreAntes = antes.nombre;
  const filas = [{ numero_fila: 2, clave: "AB-001", costo: 999, existencia: 5 }];
  const resumen = aplicarImportacion(DB, "articulos", filas, 6, {}, "test.xlsx");
  assert.strictEqual(resumen.errores.length, 1);
  assert.strictEqual(resumen.actualizados, 0);
  assert.match(resumen.errores[0].motivo, /no tiene registro de existencia/);
  const despues = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  assert.strictEqual(despues.costo, costoAntes, "el costo NO debio cambiar: la fila fallo por completo");
  assert.strictEqual(despues.nombre, nombreAntes);
});

test("aplicarImportacion de articulos: actualizacion que falla por precondicion de existencia NO crea categoria/departamento huerfanos", () => {
  const DB = construirDBPrueba();
  // Igual que el test anterior (producto sin existencia en sucursal 6), pero
  // ahora la fila ADEMAS trae una categoria nueva que todavia no existe en el
  // catalogo. prepararDatosArticulo resuelve (y de paso CREA) esa categoria
  // antes de que se checara la precondicion de existencia — si el orden no
  // se corrige, la categoria queda huerfana aunque la fila se reporte como
  // error completo.
  const categoriasAntes = DB["catalogo-productos"].categorias.length;
  const departamentosAntes = DB["catalogo-productos"].departamentos.length;
  const antes = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  const costoAntes = antes.costo;
  const nombreAntes = antes.nombre;
  const filas = [{ numero_fila: 2, clave: "AB-001", costo: 999, categoria: "Categoria Huerfana Actualizacion", existencia: 5 }];
  const resumen = aplicarImportacion(DB, "articulos", filas, 6, {}, "test.xlsx");
  assert.strictEqual(resumen.errores.length, 1);
  assert.strictEqual(resumen.actualizados, 0);
  assert.match(resumen.errores[0].motivo, /no tiene registro de existencia/);
  assert.strictEqual(DB["catalogo-productos"].categorias.length, categoriasAntes, "no debio crear la categoria huerfana");
  assert.strictEqual(DB["catalogo-productos"].departamentos.length, departamentosAntes, "no debio crear el departamento huerfano");
  assert.ok(!DB["catalogo-productos"].categorias.some((c) => c.nombre === "Categoria Huerfana Actualizacion"));
  const despues = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  assert.strictEqual(despues.costo, costoAntes, "el costo NO debio cambiar: la fila fallo por completo");
  assert.strictEqual(despues.nombre, nombreAntes);
});

test("aplicarImportacion de clientes: alta nueva usa la sucursal seleccionada", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI999", nombre: "Cliente Nuevo SICAR", rfc: "XAXX010101000" }];
  const resumen = aplicarImportacion(DB, "clientes", filas, 2, {}, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 1);
  const nuevo = DB.crm.clientes.find((c) => c.clave === "CLI999");
  assert.strictEqual(nuevo.sucursal_id, 2);
});

test("aplicarImportacion de clientes: actualizacion no borra campos que no vienen en el archivo", () => {
  const DB = construirDBPrueba();
  const antes = DB.crm.clientes.find((c) => c.clave === "CLI001");
  const limiteAntes = antes.limite_credito;
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Abarrotes Mary", telefono: "9191234567" }];
  aplicarImportacion(DB, "clientes", filas, 1, {}, "test.xlsx");
  const despues = DB.crm.clientes.find((c) => c.clave === "CLI001");
  assert.strictEqual(despues.telefono, "9191234567");
  assert.strictEqual(despues.limite_credito, limiteAntes, "no debia perderse el limite de credito existente");
});

test("aplicarImportacion de clientes: la actualizacion no toca el sucursal_id del cliente ya existente", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Abarrotes Mary" }];
  aplicarImportacion(DB, "clientes", filas, 1, {}, "test.xlsx");
  const cliente = DB.crm.clientes.find((c) => c.clave === "CLI001" && c.sucursal_id === 1);
  assert.ok(cliente, "debio actualizar el cliente existente de la sucursal 1, no crear uno nuevo");
  assert.strictEqual(cliente.sucursal_id, 1, "el sucursal_id original no debe tocarse en una actualizacion");
});

test("aplicarImportacion de clientes: mismo clave en OTRA sucursal da de alta un cliente nuevo, sin pisar el de la sucursal original", () => {
  const DB = construirDBPrueba();
  // CLI001 existe en sucursal 1 (ver testHelpers). Cada instalación de SICAR
  // numera clientes por su cuenta, así que la MISMA clave llegando de la
  // sucursal 2 pertenece a una persona real distinta — debe darse de alta
  // como cliente nuevo, nunca sobrescribir nombre/rfc/telefono del cliente
  // de la sucursal 1 (ver hallazgo critico de revisión de rama completa).
  const clienteOriginal = DB.crm.clientes.find((c) => c.clave === "CLI001");
  const nombreOriginalAntes = clienteOriginal.nombre;
  const totalClientesAntes = DB.crm.clientes.length;
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Otro Negocio Yajalón", rfc: "XAXX010101000" }];
  const resumen = aplicarImportacion(DB, "clientes", filas, 2, {}, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 1);
  assert.strictEqual(resumen.actualizados, 0);
  assert.strictEqual(DB.crm.clientes.length, totalClientesAntes + 1, "debio crear un cliente nuevo, no actualizar el existente");
  const original = DB.crm.clientes.find((c) => c.id === clienteOriginal.id);
  assert.strictEqual(original.nombre, nombreOriginalAntes, "el cliente de la sucursal 1 NO debio pisarse");
  const nuevo = DB.crm.clientes.find((c) => c.clave === "CLI001" && c.sucursal_id === 2);
  assert.ok(nuevo, "debe existir un cliente nuevo con la misma clave, en la sucursal 2");
  assert.strictEqual(nuevo.nombre, "Otro Negocio Yajalón");
});

test("aplicarImportacion de clientes: dos filas sin clave son SIEMPRE alta, incluso entre si, en llamadas sucesivas (SICAR real no trae clave)", () => {
  // Guarda contra el escenario real: dos personas distintas importadas con
  // clave === "" en la misma sucursal NO deben matchear entre si en una
  // segunda pasada de importación (buscarClienteExistente debe regresar
  // null sin correr .find() cuando fila.clave está vacío).
  const DB = construirDBPrueba();
  const filasUno = [{ numero_fila: 2, clave: "", nombre: "Cliente Sin Clave Uno" }];
  const resumenUno = aplicarImportacion(DB, "clientes", filasUno, 1, {}, "test.xlsx");
  assert.strictEqual(resumenUno.nuevos, 1);
  assert.strictEqual(resumenUno.actualizados, 0);

  const filasDos = [{ numero_fila: 2, clave: "", nombre: "Cliente Sin Clave Dos" }];
  const resumenDos = aplicarImportacion(DB, "clientes", filasDos, 1, {}, "test.xlsx");
  assert.strictEqual(resumenDos.nuevos, 1);
  assert.strictEqual(resumenDos.actualizados, 0, "no debio matchear contra el cliente sin clave importado en la llamada anterior");

  const uno = DB.crm.clientes.find((c) => c.nombre === "Cliente Sin Clave Uno");
  const dos = DB.crm.clientes.find((c) => c.nombre === "Cliente Sin Clave Dos");
  assert.ok(uno && dos);
  assert.notStrictEqual(uno.id, dos.id);
});

test("aplicarImportacion de proveedores: alta nueva y actualizacion por rfc", () => {
  const DB = construirDBPrueba();
  const altas = [{ numero_fila: 2, rfc: "NUEVO-RFC-001", nombre: "Proveedor Nuevo", contacto: "9191112233" }];
  const resumenAlta = aplicarImportacion(DB, "proveedores", altas, null, {}, "test.xlsx");
  assert.strictEqual(resumenAlta.nuevos, 1);

  const actualizaciones = [{ numero_fila: 2, rfc: "NUEVO-RFC-001", nombre: "Proveedor Nuevo Renombrado", contacto: "9199998877" }];
  const resumenUpdate = aplicarImportacion(DB, "proveedores", actualizaciones, null, {}, "test.xlsx");
  assert.strictEqual(resumenUpdate.actualizados, 1);
  const proveedor = DB["catalogo-productos"].proveedores.find((p) => p.rfc === "NUEVO-RFC-001");
  assert.strictEqual(proveedor.nombre, "Proveedor Nuevo Renombrado");
  assert.strictEqual(proveedor.contacto, "9199998877");
});

test("aplicarImportacion de proveedores: dos proveedores distintos sin rfc se dan de alta ambos, sin mezclarse", () => {
  const DB = construirDBPrueba();
  const filas = [
    { numero_fila: 2, rfc: "", nombre: "Proveedor Uno Sin RFC" },
    { numero_fila: 3, rfc: "", nombre: "Proveedor Dos Sin RFC" },
  ];
  const resumen = aplicarImportacion(DB, "proveedores", filas, null, {}, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 2);
  assert.strictEqual(resumen.errores.length, 0);
  const uno = DB["catalogo-productos"].proveedores.find((p) => p.nombre === "Proveedor Uno Sin RFC");
  const dos = DB["catalogo-productos"].proveedores.find((p) => p.nombre === "Proveedor Dos Sin RFC");
  assert.ok(uno && dos);
  assert.notStrictEqual(uno.id, dos.id);
});

test("aplicarImportacion de proveedores: alta sin rfc y sin match de nombre queda con rfc vacio", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, rfc: "", nombre: "Proveedor Sin RFC Alta" }];
  const resumen = aplicarImportacion(DB, "proveedores", filas, null, {}, "test.xlsx");
  assert.strictEqual(resumen.nuevos, 1);
  const nuevo = DB["catalogo-productos"].proveedores.find((p) => p.nombre === "Proveedor Sin RFC Alta");
  assert.strictEqual(nuevo.rfc, "");
});

const { exportarRespaldo } = require("./migracion");

test("exportarRespaldo de articulos genera un xlsx que el mismo parser vuelve a leer (ciclo completo)", () => {
  const DB = construirDBPrueba();
  const base64 = exportarRespaldo(DB, "articulos", 1);
  const { filas } = parsearExcel(base64, "articulos");
  const arroz = filas.find((f) => f.clave === "AB-001");
  assert.ok(arroz, "el articulo exportado debe volver a reconocerse al reimportar");
  assert.strictEqual(Number(arroz.costo), DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001").costo);
});

test("exportarRespaldo de clientes excluye a Publico en General (id 0)", () => {
  const DB = construirDBPrueba();
  const base64 = exportarRespaldo(DB, "clientes", 1);
  const { filas } = parsearExcel(base64, "clientes");
  assert.ok(!filas.some((f) => f.nombre === "Público en General"));
});

test("exportarRespaldo de proveedores no depende de sucursal", () => {
  const DB = construirDBPrueba();
  DB["catalogo-productos"].proveedores.push({ id: 50, nombre: "Distribuidora del Norte", rfc: "DINX800101ABC", contacto: "9191234567" });
  const base64 = exportarRespaldo(DB, "proveedores", null);
  const { filas } = parsearExcel(base64, "proveedores");
  assert.strictEqual(filas.length, DB["catalogo-productos"].proveedores.length);
});
