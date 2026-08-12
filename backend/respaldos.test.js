const { test } = require("node:test");
const assert = require("node:assert");
const {
  crearRespaldo, armarFoto, contarRegistros, nuevoEstadoRespaldos,
  estadoRespaldos, COLECCIONES_RESPALDADAS, VERSION_FORMATO,
  limpiarViejos, DIAS_RETENCION_DIA, DIAS_RETENCION_HORA,
} = require("./respaldos");
const { desempaquetar } = require("./respaldoCifrado");

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
      existencias: [], movimientos_inventario: [], compras: [], compra_detalle: [],
      traspasos: [], garantias: [{ id: 1 }], garantia_movimientos: [], garantia_gastos: [],
      productos: [{ id: 1, nombre: "Guitarra" }], categorias: [], proveedores: [],
      departamentos: [], producto_proveedor: [],
    },
    admin: { roles: [], usuarios: [{ id: 1, usuario: "victor" }], intentos_bloqueados_ubicacion: [], documentos_personal: [] },
    ml: { cuenta: null, publicaciones: [], ordenes_importadas: [] },
    drive: { cuenta: null },
    gastos: { gastos: [{ id: 1 }], categorias: [], gasto_movimientos: [], ultimo_id: 1 },
    cuenta_comun: { depositos: [{ id: 1 }], deposito_movimientos: [], ultimo_id: 1 },
    respaldos: nuevoEstadoRespaldos(),
  };
}

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

test("las constantes de retención son las que pidió Victor", () => {
  assert.strictEqual(DIAS_RETENCION_DIA, 30);
  assert.strictEqual(DIAS_RETENCION_HORA, 7);
});
