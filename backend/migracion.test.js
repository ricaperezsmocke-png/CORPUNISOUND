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

test("previsualizarImportacion de articulos hace match por clave_alterna si no coincide el sku", () => {
  const DB = construirDBPrueba();
  const producto = DB["catalogo-productos"].productos.find((p) => p.sku === "AB-001");
  producto.clave_alterna = "COD-BARRAS-123";
  const filas = [{ numero_fila: 2, clave: "COD-BARRAS-123", descripcion: "Arroz 1kg" }];
  const { filas: resultado } = previsualizarImportacion(DB, "articulos", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, producto.id);
});

test("previsualizarImportacion de clientes hace match por clave", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI001", nombre: "Abarrotes Mary S.A." }];
  const { filas: resultado } = previsualizarImportacion(DB, "clientes", filas);
  assert.strictEqual(resultado[0].accion, "actualizacion");
  assert.strictEqual(resultado[0].id_existente, 1);
});

test("previsualizarImportacion marca alta si la clave del cliente no existe", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "CLI-NUEVO", nombre: "Cliente Nuevo" }];
  const { filas: resultado, resumen } = previsualizarImportacion(DB, "clientes", filas);
  assert.strictEqual(resultado[0].accion, "alta");
  assert.strictEqual(resultado[0].id_existente, null);
  assert.strictEqual(resumen.altas, 1);
});

test("previsualizarImportacion marca invalido un cliente sin clave", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, clave: "", nombre: "Sin clave" }];
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

test("previsualizarImportacion marca invalido un proveedor sin rfc", () => {
  const DB = construirDBPrueba();
  const filas = [{ numero_fila: 2, rfc: "", nombre: "Sin RFC" }];
  const { filas: resultado } = previsualizarImportacion(DB, "proveedores", filas);
  assert.strictEqual(resultado[0].valida, false);
  assert.ok(resultado[0].errores.length > 0);
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
