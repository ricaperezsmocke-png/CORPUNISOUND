const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const {
  crearRespaldo, armarFoto, contarRegistros, nuevoEstadoRespaldos,
  estadoRespaldos, COLECCIONES_RESPALDADAS, VERSION_FORMATO,
  limpiarViejos, DIAS_RETENCION_DIA, DIAS_RETENCION_HORA,
  verificarRespaldo, leerRespaldo, copiaParaReverificar,
  restaurar, claveRestauracionConfigurada, claveCorrecta,
  compararConEstadoActual, PALABRA_CONFIRMACION,
} = require("./respaldos");
const { desempaquetar } = require("./respaldoCifrado");
const { estaActivo, desactivar } = require("./mantenimiento");
const { reconciliarTrasRestaurar } = require("./reconciliarRestauracion");

const LLAVE = Buffer.from("a".repeat(64), "hex");

function driveFalso() {
  const subidos = [];
  return {
    subidos,
    asegurarCarpetaRespaldos: async () => "carpeta-respaldos",
    subirArchivoADrive: async (_DB, args) => {
      subidos.push(args);
      return { id: `file-${subidos.length}`, webViewLink: `https://drive/f${subidos.length}` };
    },
    eliminarArchivoDeDrive: async () => {},
  };
}

/** driveFalso que además DEVUELVE lo que se le subió, para poder bajarlo. */
function driveConMemoria() {
  const archivos = new Map();
  let n = 0;
  return {
    archivos,
    asegurarCarpetaRespaldos: async () => "carpeta-respaldos",
    subirArchivoADrive: async (_DB, args) => {
      const id = `file-${++n}`;
      archivos.set(id, args.contenidoBuffer);
      return { id, webViewLink: `https://drive/${id}` };
    },
    descargarArchivoDeDrive: async (_DB, id) => {
      if (!archivos.has(id)) throw new Error("404 en Drive");
      return archivos.get(id);
    },
    eliminarArchivoDeDrive: async (_DB, id) => { archivos.delete(id); },
  };
}

/**
 * Fixture con la forma REAL del DB de server.js.
 *
 * OJO CON ESTO: la versión anterior inventó una forma que el sistema no tiene —
 * puso productos/categorías/proveedores DENTRO de `inventario` y omitió
 * `catalogo-productos` por completo. Como todo el módulo se construyó y se probó
 * contra ese fixture, el catálogo entero de la tienda quedó fuera del respaldo y
 * ninguna de las 679 pruebas lo notó. Si agregas una colección aquí, agrégala
 * también en server.js (y al revés): la prueba "COLECCIONES_RESPALDADAS cubre
 * todas las llaves del DB real" lo vigila leyendo server.js de verdad.
 */
function nuevoDB() {
  return {
    pos: {
      ventas: [
        { id: 1, total: 100, tipo_documento: "Ticket" },
        { id: 2, total: 200, tipo_documento: "Apartado" },
      ],
      venta_detalle: [], vendedores: [], sucursales: [{ id: 1, nombre: "Ocosingo" }],
      condiciones_pago: [], cortes_caja: [{ id: 1 }], apartado_abonos: [],
    },
    crm: { clientes: [{ id: 1, nombre: "Ana" }], contactos_cliente: [], oportunidades: [] },
    inventario: {
      existencias: [{ producto_id: 1, sucursal_id: 1, cantidad_actual: 5 }],
      movimientos_inventario: [], compras: [], compra_detalle: [],
      traspasos: [], garantias: [{ id: 1 }], garantia_movimientos: [], garantia_gastos: [],
    },
    "catalogo-productos": {
      productos: [{ id: 1, nombre: "Guitarra" }],
      categorias: [{ id: 1, nombre: "Cuerdas" }],
      proveedores: [{ id: 1, nombre: "Distribuidora" }],
      departamentos: [], producto_proveedor: [],
    },
    admin: { roles: [], usuarios: [{ id: 1, usuario: "victor" }], intentos_bloqueados_ubicacion: [], documentos_personal: [] },
    ml: { cuenta: null, publicaciones: [], ordenes_importadas: [] },
    drive: { cuenta: null },
    gastos: { gastos: [{ id: 1 }], categorias: [], gasto_movimientos: [], ultimo_id: 1 },
    cuenta_comun: { depositos: [{ id: 1 }], deposito_movimientos: [], ultimo_id: 1 },
    radar_demanda: {
      registros: [{ id: 7, producto_buscado: "Bajo de cinco cuerdas", estado: "CLIENTE_CONTACTADO" }],
      seguimientos: [{ id: 11, demanda_id: 7, tipo: "SEGUIMIENTO", comentario: "Cliente localizado" }],
      ultimo_id: 7,
      ultimo_seguimiento_id: 11,
    },
    respaldos: nuevoEstadoRespaldos(),
  };
}

/** Quien restaura necesita el permiso de alcance global. */
const PERMISOS_GLOBALES = ["restaurar_respaldo", "ver_todas_las_sucursales"];

test("contarRegistros cuenta apartados como ventas con tipo_documento Apartado", () => {
  const c = contarRegistros(nuevoDB());
  assert.strictEqual(c.ventas, 2);
  assert.strictEqual(c.apartados, 1);
  assert.strictEqual(c.productos, 1);
  assert.strictEqual(c.clientes, 1);
  assert.strictEqual(c.gastos, 1);
  assert.strictEqual(c.garantias, 1);
  assert.strictEqual(c.depositos, 1);
  assert.strictEqual(c.cortes, 1);
  assert.strictEqual(c.usuarios, 1);
});

test("contarRegistros no truena con un DB incompleto", () => {
  assert.strictEqual(contarRegistros({}).ventas, 0);
});

test("armarFoto incluye TODAS las colecciones de negocio", () => {
  const foto = armarFoto(nuevoDB(), "hora");
  for (const clave of COLECCIONES_RESPALDADAS) {
    assert.ok(foto.datos[clave] !== undefined, `falta la colección ${clave}`);
  }
  assert.strictEqual(foto.version_formato, VERSION_FORMATO);
});

/**
 * LA prueba que faltaba, y que le habría ahorrado a Victor un respaldo sin
 * catálogo de productos.
 *
 * La anterior recorría COLECCIONES_RESPALDADAS y comprobaba que cada una
 * estuviera en la foto — es decir, comparaba la constante consigo misma: no
 * podía fallar aunque el respaldo olvidara media empresa. Esta lee las llaves
 * REALES del DB de server.js y exige que ninguna quede fuera. El día que alguien
 * agregue un módulo nuevo, esta prueba truena y le recuerda incluirlo, en vez de
 * que el respaldo lo omita en silencio durante meses.
 */
test("COLECCIONES_RESPALDADAS cubre TODAS las llaves del DB real de server.js", () => {
  const fuente = require("node:fs").readFileSync(require.resolve("./server.js"), "utf8");
  // El objeto DB literal de server.js: desde "const DB = {" hasta su cierre.
  const desde = fuente.indexOf("const DB = {");
  assert.ok(desde !== -1, "no se encontró el objeto DB en server.js");
  const cuerpo = fuente.slice(desde, fuente.indexOf("\n};", desde));
  // Llaves de primer nivel = las que están indentadas con exactamente 2 espacios.
  const llavesReales = [...cuerpo.matchAll(/^ {2}"?([a-z_-]+)"?:\s*\{/gm)].map((m) => m[1]);

  assert.ok(llavesReales.length >= 9, `solo se detectaron ${llavesReales.length} llaves: ${llavesReales}`);
  assert.ok(llavesReales.includes("catalogo-productos"), "el detector no vio catalogo-productos");

  const olvidadas = llavesReales.filter(
    (k) => k !== "respaldos" && !COLECCIONES_RESPALDADAS.includes(k)
  );
  assert.deepStrictEqual(
    olvidadas, [],
    `Estas colecciones del sistema NO se están respaldando: ${olvidadas.join(", ")}. ` +
    "Agrégalas a COLECCIONES_RESPALDADAS en respaldos.js (y al fixture nuevoDB de este archivo)."
  );
});

test("el fixture de pruebas tiene la MISMA forma que el DB real", () => {
  // Sin esto, el fixture puede volver a divergir del sistema y las pruebas
  // pasarían probando un sistema que no existe. Es lo que ya pasó una vez.
  const delFixture = Object.keys(nuevoDB()).sort();
  const esperadas = [...COLECCIONES_RESPALDADAS, "respaldos"].sort();
  assert.deepStrictEqual(delFixture, esperadas);
});

test("contarRegistros lee los productos de catalogo-productos, NO de inventario", () => {
  // El conteo miraba DB.inventario.productos, que no existe: devolvía 0 siempre.
  // Como verificarRespaldo compara el conteo del índice contra el del archivo,
  // 0 === 0 daba VERDE con el catálogo entero ausente del respaldo.
  const DB = nuevoDB();
  assert.strictEqual(contarRegistros(DB).productos, 1);
  assert.strictEqual(contarRegistros(DB).categorias, 1);
  assert.strictEqual(contarRegistros(DB).proveedores, 1);
  assert.strictEqual(contarRegistros(DB).existencias, 1);
  assert.strictEqual(DB.inventario.productos, undefined, "productos NO vive en inventario");
});

test("armarFoto TRUENA si al DB le falta una colección (simetría con leerRespaldo)", () => {
  const DB = nuevoDB();
  delete DB["catalogo-productos"];
  assert.throws(() => armarFoto(DB, "hora"), /catalogo-productos/);
});

test("armarFoto NO incluye DB.respaldos (el índice no se respalda a sí mismo)", () => {
  assert.strictEqual(armarFoto(nuevoDB(), "hora").datos.respaldos, undefined);
  assert.ok(!COLECCIONES_RESPALDADAS.includes("respaldos"));
});

test("crearRespaldo sube a Drive y registra la copia", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  const copia = await crearRespaldo(DB, drive, { tipo: "hora", llave: LLAVE });

  assert.strictEqual(DB.respaldos.copias.length, 1);
  assert.strictEqual(copia.estado, "ok");
  assert.strictEqual(copia.tipo, "hora");
  assert.strictEqual(copia.drive_file_id, "file-1");
  assert.ok(copia.bytes > 0);
  assert.strictEqual(copia.conteos.ventas, 2);
  assert.match(copia.nombre_archivo, /^unisound-\d{4}-\d{2}-\d{2}-\d{4}-\d+\.respaldo$/);
  assert.strictEqual(DB.respaldos.ultimo_exitoso, copia.fecha_hora);
});

test("lo que se sube a Drive se puede descifrar y trae los datos reales", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  await crearRespaldo(DB, drive, { tipo: "hora", llave: LLAVE });

  const foto = desempaquetar(drive.subidos[0].contenidoBuffer, LLAVE);
  assert.strictEqual(foto.datos.pos.ventas.length, 2);
  assert.strictEqual(foto.datos.crm.clientes[0].nombre, "Ana");
  assert.strictEqual(foto.version_formato, VERSION_FORMATO);
});

test("el nombre del archivo lleva la fecha y hora EN CLARO", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  assert.ok(drive.subidos[0].nombre.includes(copia.fecha.replace(/-/g, "-")));
});

test("cada respaldo se VERIFICA antes de subir: un empaquetado roto no sube", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  // Llave de 31 bytes: crypto revienta al cifrar, antes de tocar Drive.
  await assert.rejects(
    () => crearRespaldo(DB, drive, { tipo: "hora", llave: Buffer.alloc(31) }),
  );
  assert.strictEqual(drive.subidos.length, 0, "no debió subir nada");
});

test("si Drive falla, la copia queda marcada como fallida y NO se mueve ultimo_exitoso", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  drive.subirArchivoADrive = async () => { throw new Error("Drive caído"); };

  await assert.rejects(() => crearRespaldo(DB, drive, { tipo: "hora", llave: LLAVE }), /Drive caído/);
  assert.strictEqual(DB.respaldos.ultimo_exitoso, null);
  assert.strictEqual(DB.respaldos.copias.length, 1);
  assert.strictEqual(DB.respaldos.copias[0].estado, "fallido");
});

test("los ids son únicos aunque se creen 12 respaldos concurrentes", async () => {
  const DB = nuevoDB();
  const drive = driveFalso();
  const copias = await Promise.all(
    Array.from({ length: 12 }, () => crearRespaldo(DB, drive, { tipo: "hora", llave: LLAVE }))
  );
  const ids = copias.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, 12, "hubo ids repetidos — carrera de folio");
  const nombres = copias.map((c) => c.nombre_archivo);
  assert.strictEqual(new Set(nombres).size, 12, "hubo nombres repetidos");
});

test("estadoRespaldos avisa en VERDE cuando está al corriente", () => {
  const DB = nuevoDB();
  DB.respaldos.ultimo_exitoso = new Date(Date.now() - 20 * 60_000).toISOString();
  const e = estadoRespaldos(DB);
  assert.strictEqual(e.alerta, false);
  assert.strictEqual(e.minutos_desde_ultimo, 20);
});

test("estadoRespaldos avisa en ROJO tras más de 2 horas sin respaldar", () => {
  const DB = nuevoDB();
  DB.respaldos.ultimo_exitoso = new Date(Date.now() - 4 * 60 * 60_000).toISOString();
  assert.strictEqual(estadoRespaldos(DB).alerta, true);
});

test("estadoRespaldos sin ningún respaldo está en ROJO, no en verde", () => {
  const e = estadoRespaldos(nuevoDB());
  assert.strictEqual(e.alerta, true);
  assert.strictEqual(e.ultimo_exitoso, null);
});

const DIA_MS = 24 * 60 * 60 * 1000;
const HOY = Date.parse("2026-08-11T22:00:00.000Z");

function copiaFalsa(DB, { tipo, diasAtras, id }) {
  const ms = HOY - diasAtras * DIA_MS;
  const c = {
    id, tipo,
    fecha: new Date(ms).toISOString().slice(0, 10),
    fecha_hora: new Date(ms).toISOString(),
    hora_local: "16:00",
    nombre_archivo: `respaldo-${id}.respaldo`,
    drive_file_id: `file-${id}`, drive_link: null,
    bytes: 100, conteos: {}, verificado_en: null, estado: "ok",
  };
  DB.respaldos.copias.push(c);
  return c;
}

test("la retención borra las copias por hora de más de 7 días", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "hora", diasAtras: 2, id: 1 });
  copiaFalsa(DB, { tipo: "hora", diasAtras: 8, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [1]);
});

test("la retención NO borra un punto del día de 8 días (esos viven 30)", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "dia", diasAtras: 8, id: 1 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 0);
});

test("la retención SÍ borra un punto del día de 31 días", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "dia", diasAtras: 31, id: 1 });
  copiaFalsa(DB, { tipo: "dia", diasAtras: 29, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [2]);
});

test("un pre_restauracion vive 30 días, como los del día", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "pre_restauracion", diasAtras: 8, id: 1 });
  copiaFalsa(DB, { tipo: "pre_restauracion", diasAtras: 31, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [1]);
});

test("NUNCA se borra la copia más reciente, aunque las reglas lo digan", async () => {
  // La última red: mejor un archivo de más que quedarse sin ninguno por un
  // error de fechas o un reloj mal puesto.
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "hora", diasAtras: 400, id: 1 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 0);
  assert.strictEqual(DB.respaldos.copias.length, 1);
});

test("protege la más reciente aunque ELLA MISMA esté vencida (y borra las demás)", async () => {
  // ESTA es la prueba que le da dientes a la protección de `masReciente`.
  // La de arriba NO sirve para eso: con una sola copia, la guarda
  // `if (copias.length <= 1) return ...` regresa ANTES de que la línea de
  // `masReciente` se ejecute siquiera, así que quitar esa línea la deja
  // igual de verde. Hacen falta DOS copias, ambas vencidas, para que la
  // protección sea lo único que separa "borra una" de "vacía la carpeta".
  const DB = nuevoDB(); const drive = driveFalso();
  copiaFalsa(DB, { tipo: "hora", diasAtras: 10, id: 1 }); // vencida (>7d), pero es la más nueva
  copiaFalsa(DB, { tipo: "hora", diasAtras: 20, id: 2 }); // vencida y más vieja
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [1]);
});

test("si la copia más nueva quedó fallida, la protección cuida el respaldo bueno más reciente, no el renglón fallido", async () => {
  // Reproduce el hallazgo Important 1 de revisión: `crearRespaldo` mete el
  // registro con estado "fallido" y drive_file_id null ANTES de intentar subir.
  // Si ese intento falla, el renglón "fallido" es el más nuevo por fecha_hora
  // pero NO representa ni un byte en Drive. Si `masReciente` lo protege a él,
  // el respaldo bueno (más viejo) queda desprotegido y la retención por edad
  // se lo come — la carpeta de Drive termina vacía aunque el índice muestre
  // un renglón "sobreviviente".
  const DB = nuevoDB(); const drive = driveFalso();
  const buena = copiaFalsa(DB, { tipo: "hora", diasAtras: 10, id: 1 }); // único respaldo real, vencido por edad (>7d)
  const fallida = copiaFalsa(DB, { tipo: "hora", diasAtras: 0, id: 2 }); // más nueva, pero sin archivo en Drive
  fallida.estado = "fallido"; fallida.drive_file_id = null;
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 0, "no debió borrar el único respaldo real que existe");
  assert.ok(
    DB.respaldos.copias.some((c) => c.estado === "ok"),
    "la carpeta no debe quedarse sin ningún respaldo real"
  );
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id).sort(), [1, 2]);
});

test("un punto del día fallido y vencido se limpia igual que uno por hora", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  const f = copiaFalsa(DB, { tipo: "dia", diasAtras: 31, id: 1 });
  f.estado = "fallido"; f.drive_file_id = null;
  copiaFalsa(DB, { tipo: "dia", diasAtras: 0, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [2]);
});

test("un pre_restauracion fallido y vencido se limpia igual", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  const f = copiaFalsa(DB, { tipo: "pre_restauracion", diasAtras: 31, id: 1 });
  f.estado = "fallido"; f.drive_file_id = null;
  copiaFalsa(DB, { tipo: "pre_restauracion", diasAtras: 0, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [2]);
});

test("la retención borra el archivo en Drive, no solo el renglón del índice", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  const borrados = [];
  drive.eliminarArchivoDeDrive = async (_DB, fileId) => { borrados.push(fileId); };
  copiaFalsa(DB, { tipo: "hora", diasAtras: 30, id: 1 });
  copiaFalsa(DB, { tipo: "hora", diasAtras: 0, id: 2 });
  await limpiarViejos(DB, drive, HOY);
  assert.deepStrictEqual(borrados, ["file-1"]);
});

test("si Drive falla al borrar, el renglón NO se quita del índice", async () => {
  // Quitarlo dejaría un archivo huérfano invisible que nadie volvería a borrar.
  const DB = nuevoDB(); const drive = driveFalso();
  drive.eliminarArchivoDeDrive = async () => { throw new Error("Drive caído"); };
  copiaFalsa(DB, { tipo: "hora", diasAtras: 30, id: 1 });
  copiaFalsa(DB, { tipo: "hora", diasAtras: 0, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 0);
  assert.strictEqual(DB.respaldos.copias.length, 2);
});

test("una copia fallida sin archivo en Drive se limpia sin llamar a Drive", async () => {
  const DB = nuevoDB(); const drive = driveFalso();
  let llamadas = 0;
  drive.eliminarArchivoDeDrive = async () => { llamadas++; };
  const c = copiaFalsa(DB, { tipo: "hora", diasAtras: 30, id: 1 });
  c.estado = "fallido"; c.drive_file_id = null;
  copiaFalsa(DB, { tipo: "hora", diasAtras: 0, id: 2 });
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(r.borradas, 1);
  assert.strictEqual(llamadas, 0);
});

test("si NINGUNA copia tuvo éxito nunca, se protege la más nueva a secas (caso degenerado)", async () => {
  // Caso degenerado explicado en el comentario de limpiarViejos: si `exitosas`
  // sale vacío, `candidatas` cae a TODAS las copias sin importar su estado.
  // Todas fallidas, todas vencidas por edad: debe sobrevivir exactamente una
  // (la más nueva) y el índice nunca debe quedar vacío.
  const DB = nuevoDB(); const drive = driveFalso();
  const a = copiaFalsa(DB, { tipo: "hora", diasAtras: 30, id: 1 });
  const b = copiaFalsa(DB, { tipo: "hora", diasAtras: 20, id: 2 });
  const c = copiaFalsa(DB, { tipo: "hora", diasAtras: 10, id: 3 }); // la más nueva
  for (const copia of [a, b, c]) { copia.estado = "fallido"; copia.drive_file_id = null; }
  const r = await limpiarViejos(DB, drive, HOY);
  assert.strictEqual(DB.respaldos.copias.length, 1, "el índice no debe quedar vacío");
  assert.deepStrictEqual(DB.respaldos.copias.map((c) => c.id), [3]);
  assert.strictEqual(r.conservadas, 1);
});

test("las constantes de retención son las que pidió Victor", () => {
  assert.strictEqual(DIAS_RETENCION_DIA, 30);
  assert.strictEqual(DIAS_RETENCION_HORA, 7);
});

test("verificarRespaldo baja de Drive, descifra y confirma los conteos", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  const r = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r.ok, true);
  assert.ok(copia.verificado_en, "debió marcar verificado_en");
  assert.deepStrictEqual(r.diferencias, []);
});

test("verificarRespaldo detecta un archivo alterado en Drive", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  const bytes = drive.archivos.get(copia.drive_file_id);
  bytes[bytes.length - 1] ^= 0xff; // un byte cambiado
  const r = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(copia.verificado_en, null, "un respaldo roto NO queda marcado como verificado");
});

test("verificarRespaldo detecta que el archivo ya no está en Drive", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  drive.archivos.delete(copia.drive_file_id);
  const r = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r.ok, false);
});

test("verificarRespaldo detecta si los conteos de la etiqueta no cuadran", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  copia.conteos = { ...copia.conteos, ventas: 999 }; // el índice miente
  const r = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r.ok, false);
  assert.ok(r.diferencias.some((d) => d.includes("ventas")));
});

test("leerRespaldo rechaza una version_formato desconocida", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  // Se re-sube una foto del futuro con el mismo id de archivo.
  const { empaquetar } = require("./respaldoCifrado");
  drive.archivos.set(copia.drive_file_id, empaquetar(
    { version_formato: 99, generado_en: "2026-08-11T22:00:00.000Z", conteos: {}, datos: { pos: {} } },
    LLAVE,
  ));
  await assert.rejects(() => leerRespaldo(DB, drive, copia.id, LLAVE), /versión/i);
});

test("leerRespaldo rechaza una foto a la que le falta una colección", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  const { empaquetar } = require("./respaldoCifrado");
  // La versión debe ser la VIGENTE: con una vieja, leerRespaldo rechazaría por
  // versión y esta prueba pasaría sin llegar nunca a la validación de
  // colecciones, que es justo lo que quiere probar.
  //
  // Y la foto tiene que DECLARAR sus colecciones (2026-08-23): desde el arreglo
  // de los respaldos anteriores, un archivo que no declara nada se trata como
  // una copia vieja y se le rellenan los módulos que aún no existían. La
  // corrupción que esta prueba vigila es otra: prometió guardar estas
  // colecciones y no las trae.
  drive.archivos.set(copia.drive_file_id, empaquetar(
    {
      version_formato: VERSION_FORMATO, generado_en: "2026-08-11T22:00:00.000Z",
      colecciones: [...COLECCIONES_RESPALDADAS], conteos: {}, datos: { pos: { ventas: [] } },
    },
    LLAVE,
  ));
  await assert.rejects(() => leerRespaldo(DB, drive, copia.id, LLAVE), /incompleto|falta/i);
});

test("leerRespaldo con un id que no existe da un mensaje claro", async () => {
  const DB = nuevoDB(); const drive = driveConMemoria();
  await assert.rejects(() => leerRespaldo(DB, drive, 999, LLAVE), /no encontrado/i);
});

test("verificarRespaldo limpia verificado_en si una re-verificación con conteos distintos falla", async () => {
  // Mismo hallazgo que la prueba de abajo, pero por el camino de
  // `diferencias.length` (conteos que no cuadran) en vez del catch: una
  // verificación exitosa marca verificado_en, y una re-verificación
  // posterior que encuentra el índice desincronizado del archivo debe
  // limpiar el campo persistido en DB.respaldos.copias, no solo el valor
  // de retorno.
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });

  const r1 = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r1.ok, true);
  assert.ok(copia.verificado_en, "debió marcar verificado_en tras el primer éxito");

  copia.conteos = { ...copia.conteos, ventas: 999 }; // el índice se desincroniza DESPUÉS del primer éxito
  const r2 = await verificarRespaldo(DB, drive, copia.id, LLAVE);

  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.verificado_en, null);
  assert.strictEqual(
    copia.verificado_en, null,
    "el índice quedó mintiendo: sigue con la fecha del éxito anterior"
  );
});

const ENV_OK = { CLAVE_RESTAURACION: "la-clave-secreta-de-victor" };
/** Una llave válida pero distinta: sirve para simular un respaldo ilegible. */
const OTRA_LLAVE = Buffer.from("b".repeat(64), "hex");

// El interruptor de mantenimiento es estado de MÓDULO, no del DB: vive entre
// pruebas. Se apaga antes de cada una para que el orden de ejecución no cambie
// el resultado — una prueba que depende de la anterior es una prueba que miente.
beforeEach(() => desactivar());

async function conRespaldoListo() {
  const DB = nuevoDB();
  const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  return { DB, drive, copia };
}

test("un usuario amarrado a una sucursal NO puede restaurar, aunque traiga la clave buena", async () => {
  // Candado 0, dentro del módulo. La ruta ya exige alcance global; esta prueba
  // vigila que el módulo NO dependa solo de la ruta (restricción global #5).
  const { DB, drive, copia } = await conRespaldoListo();
  const antes = JSON.stringify(DB.pos.ventas);
  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION,
      usuario: { nombre: "Gerente de Ocosingo", sucursal_id: 1 },
      // Trae permisos de respaldos, pero NO `ver_todas_las_sucursales`: ese es
      // el rol Gerente real. El alcance se decide por el PERMISO, no por si la
      // sucursal del token es nula (ninguna cuenta real la tiene nula).
      permisos: ["ver_respaldos", "restaurar_respaldo"],
      env: ENV_OK,
    }),
    /alcance global/i,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes, "no debió tocar nada");
  // Y no debió dejar ni siquiera el respaldo pre_restauracion.
  assert.strictEqual(
    DB.respaldos.copias.filter((c) => c.tipo === "pre_restauracion").length, 0,
  );
});

test("restaurar() sin el campo usuario (omitido) NO restaura — falla cerrado", async () => {
  // Candado 0 debe fallar CERRADO: sin usuario, no hay alcance global implícito.
  const { DB, drive, copia } = await conRespaldoListo();
  const antes = JSON.stringify(DB.pos.ventas);
  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION, env: ENV_OK,
    }),
    /alcance global/i,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes, "no debió tocar nada");
  assert.strictEqual(
    DB.respaldos.copias.filter((c) => c.tipo === "pre_restauracion").length, 0,
  );
});

test("restaurar() con usuario: null NO restaura — falla cerrado", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  const antes = JSON.stringify(DB.pos.ventas);
  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION, usuario: null, env: ENV_OK,
    }),
    /alcance global/i,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes, "no debió tocar nada");
  assert.strictEqual(
    DB.respaldos.copias.filter((c) => c.tipo === "pre_restauracion").length, 0,
  );
});

test("sin CLAVE_RESTAURACION configurada, restaurar está APAGADO (falla cerrado)", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  assert.strictEqual(claveRestauracionConfigurada({}), false);
  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: "loquesea",
      confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: {},
    }),
    /no está habilitada|no está configurada/i,
  );
});

test("con la clave equivocada NO restaura y NO muta nada", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  const antes = JSON.stringify(DB.pos.ventas);

  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: "clave-mala",
      confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
    }),
    /clave de restauración/i,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes);
});

test("sin escribir RESTAURAR no restaura", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: "restaurar porfa", usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
    }),
    /RESTAURAR/,
  );
});

test("restaurar deja la base exactamente igual a la foto", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  const radarRespaldado = JSON.parse(JSON.stringify(DB.radar_demanda));
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  DB.crm.clientes.push({ id: 2, nombre: "Cliente nuevo" });
  DB.radar_demanda.registros.push({ id: 8, producto_buscado: "Cambio posterior" });
  DB.radar_demanda.seguimientos.length = 0;
  DB.radar_demanda.ultimo_id = 99;
  DB.radar_demanda.ultimo_seguimiento_id = 100;

  const r = await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  });

  assert.strictEqual(r.aplicado, true);
  assert.strictEqual(DB.pos.ventas.length, 2);
  assert.strictEqual(DB.crm.clientes.length, 1);
  assert.strictEqual(DB.crm.clientes[0].nombre, "Ana");
  assert.deepStrictEqual(DB.radar_demanda, radarRespaldado);
});

test("ANTES de tocar nada se crea el respaldo pre_restauracion", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });

  const r = await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  });

  assert.strictEqual(r.pre_restauracion.tipo, "pre_restauracion");
  // Y trae el estado de ANTES: las 3 ventas, no las 2 restauradas.
  const foto = desempaquetar(drive.archivos.get(r.pre_restauracion.drive_file_id), LLAVE);
  assert.strictEqual(foto.datos.pos.ventas.length, 3);
});

test("si el respaldo previo FALLA, la restauración se cancela y no se muta nada", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  const antes = JSON.stringify(DB.pos.ventas);

  const subirOriginal = drive.subirArchivoADrive;
  drive.subirArchivoADrive = async () => { throw new Error("Drive caído"); };

  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
    }),
    /respaldo de seguridad|no se pudo/i,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes, "la base se movió y no debía");
  drive.subirArchivoADrive = subirOriginal;
});

test("una foto con cajas inconsistentes falla antes de tocar la base", async () => {
  const DB = nuevoDB();
  const drive = driveConMemoria();
  DB.pos.cajas = [
    { id: 1, nombre: "Administrativa", sucursal_id: 1, predeterminada: true },
    { id: 2, nombre: "Fiscal", sucursal_id: 1, predeterminada: true },
  ];
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  DB.pos = nuevoDB().pos;
  DB.pos.ventas.push({ id: 99, total: 999, tipo_documento: "Ticket" });
  const antes = JSON.stringify(DB.pos);
  const previosAntes = DB.respaldos.copias.filter((c) => c.tipo === "pre_restauracion").length;

  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION,
      usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
      alTerminar: reconciliarTrasRestaurar,
    }),
    /exactamente una caja predeterminada/i,
  );

  assert.strictEqual(JSON.stringify(DB.pos), antes, "la foto invalida no debe tocar DB.pos");
  assert.strictEqual(
    DB.respaldos.copias.filter((c) => c.tipo === "pre_restauracion").length,
    previosAntes,
    "una foto invalida debe rechazarse incluso antes del respaldo previo",
  );
});

test("una colección con forma inválida se rechaza antes de tocar la base", async () => {
  const DB = nuevoDB();
  const drive = driveConMemoria();
  DB.crm = [];
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  DB.crm = { clientes: [{ id: 88, nombre: "Estado vivo" }], contactos_cliente: [], oportunidades: [] };
  const antes = JSON.stringify(DB.crm);
  const previosAntes = DB.respaldos.copias.filter((c) => c.tipo === "pre_restauracion").length;

  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION,
      usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
      alTerminar: reconciliarTrasRestaurar,
    }),
    /colección crm no tiene la forma esperada/i,
  );

  assert.strictEqual(JSON.stringify(DB.crm), antes, "la colección viva no debe cambiar");
  assert.strictEqual(
    DB.respaldos.copias.filter((c) => c.tipo === "pre_restauracion").length,
    previosAntes,
  );
});

test("un fallo posterior a reemplazar dice que la base cambio y como deshacerlo", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 99, total: 999, tipo_documento: "Ticket" });

  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION,
      usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
      alTerminar: () => { throw new Error("fallo inevitable al persistir"); },
    }),
    (error) => {
      assert.match(error.message, /la base SI se reemplazó/i);
      assert.match(error.message, /reparación quedó a medias/i);
      const previo = DB.respaldos.copias.find((c) => c.tipo === "pre_restauracion");
      assert.ok(previo, "debe existir la copia para deshacer");
      assert.ok(error.message.includes(previo.nombre_archivo));
      assert.match(error.message, /fallo inevitable al persistir/);
      return true;
    },
  );
});

test("restaurar NO pisa DB.respaldos con el índice viejo", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  const copiasAntes = DB.respaldos.copias.length;

  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  });

  // El índice conserva la copia original MÁS el pre_restauracion.
  assert.strictEqual(DB.respaldos.copias.length, copiasAntes + 1);
  assert.ok(DB.respaldos.copias.some((c) => c.tipo === "pre_restauracion"));
});

test("un archivo corrupto se rechaza SIN mutación parcial", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  const antes = JSON.stringify(DB.pos.ventas);
  const bytes = drive.archivos.get(copia.drive_file_id);
  bytes[bytes.length - 1] ^= 0xff;

  await assert.rejects(
    () => restaurar(DB, drive, {
      copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
      confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
    }),
    /no se pudo descifrar/,
  );
  assert.strictEqual(JSON.stringify(DB.pos.ventas), antes);
});

test("la restauración queda en la bitácora con quién y qué", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor Pérez" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  });
  const mov = DB.respaldos.movimientos.find((m) => m.tipo === "restauracion");
  assert.ok(mov);
  assert.strictEqual(mov.usuario, "Victor Pérez");
});

test("mientras restaura, el sistema está BLOQUEADO — y el bloqueo empieza ANTES del respaldo previo", async () => {
  // La ventana que este bloqueo cierra: una venta capturada entre el respaldo
  // previo y el reemplazo se perdería DOS veces (no está en los datos viejos que
  // se restauran, ni en el respaldo previo que se tomó antes de ella).
  const { DB, drive, copia } = await conRespaldoListo();
  let bloqueadoDuranteElPrevio = null;
  const subirOriginal = drive.subirArchivoADrive;
  drive.subirArchivoADrive = async (...args) => {
    bloqueadoDuranteElPrevio = estaActivo(); // esto corre DENTRO del respaldo previo
    return subirOriginal(...args);
  };

  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  });

  assert.strictEqual(bloqueadoDuranteElPrevio, true, "el bloqueo llegó tarde");
  assert.strictEqual(estaActivo(), false, "no se desbloqueó al terminar");
});

test("si la restauración TRUENA a media faena, el sistema se desbloquea igual", async () => {
  // Un negocio trabado en mantenimiento para siempre sería peor que la falla.
  const { DB, drive, copia } = await conRespaldoListo();
  drive.subirArchivoADrive = async () => { throw new Error("Drive caído"); };

  await assert.rejects(() => restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  }));
  assert.strictEqual(estaActivo(), false, "quedó trabado en mantenimiento");
});

test("una clave equivocada NO bloquea la tienda", async () => {
  // Cerrar la tienda porque alguien se equivocó al teclear sería un modo de
  // negación de servicio con tres letras mal escritas.
  const { DB, drive, copia } = await conRespaldoListo();
  await assert.rejects(() => restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: "clave-mala",
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  }));
  assert.strictEqual(estaActivo(), false);
});

test("un respaldo ilegible NO bloquea la tienda (se valida antes de bloquear)", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  await assert.rejects(() => restaurar(DB, drive, {
    copiaId: copia.id, llave: OTRA_LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  }));
  assert.strictEqual(estaActivo(), false);
});

test("la clave NUNCA aparece en la bitácora", async () => {
  const { DB, drive, copia } = await conRespaldoListo();
  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION, usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  });
  const texto = JSON.stringify(DB.respaldos.movimientos);
  assert.ok(!texto.includes(ENV_OK.CLAVE_RESTAURACION), "la clave se filtró a la bitácora");
});

test("claveCorrecta no se deja engañar por una clave más larga con el mismo prefijo", () => {
  assert.strictEqual(claveCorrecta("la-clave-secreta-de-victor", ENV_OK), true);
  assert.strictEqual(claveCorrecta("la-clave-secreta-de-victorXX", ENV_OK), false);
  assert.strictEqual(claveCorrecta("la-clave", ENV_OK), false);
  assert.strictEqual(claveCorrecta("", ENV_OK), false);
  assert.strictEqual(claveCorrecta(null, ENV_OK), false);
});

test("compararConEstadoActual dice cuántos registros se van a perder", async () => {
  const { DB, copia } = await conRespaldoListo();
  DB.pos.ventas.push({ id: 3, total: 999, tipo_documento: "Ticket" });
  DB.pos.ventas.push({ id: 4, total: 50, tipo_documento: "Ticket" });
  DB.gastos.gastos.push({ id: 2 });

  const c = compararConEstadoActual(DB, copia);
  assert.strictEqual(c.perdidas.ventas, 2);
  assert.strictEqual(c.perdidas.gastos, 1);
  assert.ok(!("clientes" in c.perdidas), "no debe listar lo que no cambió");
});

test("compararConEstadoActual no reporta pérdidas negativas", async () => {
  const { DB, copia } = await conRespaldoListo();
  DB.pos.ventas.pop(); // hoy hay MENOS que en la foto
  const c = compararConEstadoActual(DB, copia);
  assert.ok(!("ventas" in c.perdidas));
});

test("verificarRespaldo limpia verificado_en si una re-verificación encuentra el archivo corrupto en Drive", async () => {
  // Reproduce el hallazgo Important 1: una vez marcado verificado_en, una
  // segunda verificación que falla debe dejar limpio el campo persistido en
  // DB.respaldos.copias, no solo el valor de retorno. La pantalla de
  // Respaldos lee el índice, no lo que regresó la llamada anterior.
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });

  const r1 = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r1.ok, true);
  assert.ok(copia.verificado_en, "debió marcar verificado_en tras el primer éxito");

  const bytes = drive.archivos.get(copia.drive_file_id);
  bytes[bytes.length - 1] ^= 0xff; // se corrompe DESPUÉS del primer éxito
  const r2 = await verificarRespaldo(DB, drive, copia.id, LLAVE);

  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.verificado_en, null);
  assert.strictEqual(
    copia.verificado_en, null,
    "el índice quedó mintiendo: sigue con la fecha del éxito anterior"
  );
});

// ---------- Lo que NO debe perderse al restaurar ----------

test("restaurar CONSERVA la conexión viva de Google Drive y de Mercado Libre", async () => {
  // Sin esto, restaurar una foto anterior a la última reconexión devolvía un
  // refresh_token muerto. Y sin Drive el sistema DEJA DE RESPALDARSE, además de
  // volver inalcanzable el pre_restauracion que se acababa de crear: la
  // restauración se comía su propia red de seguridad.
  const { DB, drive, copia } = await conRespaldoListo();
  // El respaldo se tomó SIN cuenta conectada; después alguien conectó Drive y ML.
  DB.drive.cuenta = { refresh_token: "token-NUEVO-de-drive" };
  DB.ml.cuenta = { refresh_token: "token-NUEVO-de-ml" };

  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION,
    usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  });

  assert.deepStrictEqual(
    DB.drive.cuenta, { refresh_token: "token-NUEVO-de-drive" },
    "restaurar desconectó Google Drive: sin Drive no hay respaldos",
  );
  assert.deepStrictEqual(
    DB.ml.cuenta, { refresh_token: "token-NUEVO-de-ml" },
    "restaurar desconectó Mercado Libre",
  );
});

test("si NO hay conexión viva, restaurar sí recupera la del respaldo (servidor nuevo)", async () => {
  // El otro lado de la moneda: levantar el sistema desde cero en un servidor
  // limpio SÍ debe recuperar la conexión que venga en la foto.
  const DB = nuevoDB(); const drive = driveConMemoria();
  DB.drive.cuenta = { refresh_token: "token-del-respaldo" };
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  DB.drive.cuenta = null; // servidor nuevo: nada conectado

  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION,
    usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
  });

  assert.deepStrictEqual(DB.drive.cuenta, { refresh_token: "token-del-respaldo" });
});

test("restaurar vuelve a aplicar las reconciliaciones de arranque (no es puerta de una sola dirección)", async () => {
  // Una foto anterior al despliegue de este módulo no trae el rol Administrador
  // con los permisos de respaldos. Sin volver a reconciliar, restaurar dejaba a
  // Victor SIN el propio botón de restaurar: la pantalla desaparecía del
  // Dashboard y las rutas devolvían 403. Solo un reinicio en Render lo arreglaba.
  const { DB, drive, copia } = await conRespaldoListo();
  let reconciliado = false;

  await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION,
    usuario: { nombre: "Victor" }, permisos: PERMISOS_GLOBALES, env: ENV_OK,
    alTerminar: (db) => { reconciliado = db === DB; },
  });

  assert.ok(reconciliado, "no se llamó alTerminar con el DB ya restaurado");
});

test("con el alcance global por PERMISO, una cuenta REAL sí puede restaurar", async () => {
  // La forma que produce el sistema de verdad: sucursal_id numérica (crearUsuario
  // fuerza `Number(...) || 1`). Con el candado viejo —que exigía sucursal_id
  // null— esto fallaba, y por eso la restauración era imposible en producción
  // mientras las pruebas seguían verdes con tokens inventados.
  const { DB, drive, copia } = await conRespaldoListo();
  const r = await restaurar(DB, drive, {
    copiaId: copia.id, llave: LLAVE, clave: ENV_OK.CLAVE_RESTAURACION,
    confirmacion: PALABRA_CONFIRMACION,
    usuario: { id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 },
    permisos: PERMISOS_GLOBALES, env: ENV_OK,
  });
  assert.strictEqual(r.aplicado, true);
});

// ---------- Reverificación de copias viejas ----------

test("copiaParaReverificar elige la que lleva MÁS tiempo sin comprobarse", async () => {
  // Sin reverificación periódica, una copia solo se comprobaba el día que nacía:
  // si alguien vacía la carpeta de Drive, el índice sigue en verde durante 30
  // días y nadie se entera hasta la emergencia.
  const DB = nuevoDB();
  DB.respaldos.copias = [
    { id: 1, estado: "ok", drive_file_id: "f1", verificado_en: "2026-08-14T10:00:00.000Z" },
    { id: 2, estado: "ok", drive_file_id: "f2", verificado_en: "2026-08-10T10:00:00.000Z" },
    { id: 3, estado: "ok", drive_file_id: "f3", verificado_en: "2026-08-15T10:00:00.000Z" },
  ];
  assert.strictEqual(copiaParaReverificar(DB).id, 2, "debió elegir la más rezagada");
});

test("copiaParaReverificar prioriza las que NUNCA se verificaron", async () => {
  const DB = nuevoDB();
  DB.respaldos.copias = [
    { id: 1, estado: "ok", drive_file_id: "f1", verificado_en: "2026-08-01T10:00:00.000Z" },
    { id: 2, estado: "ok", drive_file_id: "f2", verificado_en: null },
  ];
  assert.strictEqual(copiaParaReverificar(DB).id, 2);
});

test("copiaParaReverificar ignora las fallidas y la recién creada", async () => {
  const DB = nuevoDB();
  DB.respaldos.copias = [
    { id: 1, estado: "fallido", drive_file_id: null, verificado_en: null },
    { id: 2, estado: "ok", drive_file_id: "f2", verificado_en: null },
  ];
  assert.strictEqual(copiaParaReverificar(DB, 2), null, "sin candidatas debe devolver null");
  assert.strictEqual(copiaParaReverificar(DB).id, 2);
});

test("una copia borrada de Drive a mano se detecta al reverificar", async () => {
  // El escenario real: Victor entra a su Drive, ve archivos raros que no
  // reconoce y los borra. El índice seguía diciendo "ok" y verificado.
  const DB = nuevoDB(); const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });
  assert.strictEqual((await verificarRespaldo(DB, drive, copia.id, LLAVE)).ok, true);

  drive.archivos.delete(copia.drive_file_id); // alguien vació la carpeta

  const r = await verificarRespaldo(DB, drive, copia.id, LLAVE);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(copia.verificado_en, null, "el índice quedó mintiendo en verde");
});
