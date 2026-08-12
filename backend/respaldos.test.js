const { test } = require("node:test");
const assert = require("node:assert");
const {
  crearRespaldo, armarFoto, contarRegistros, nuevoEstadoRespaldos,
  estadoRespaldos, COLECCIONES_RESPALDADAS, VERSION_FORMATO,
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
