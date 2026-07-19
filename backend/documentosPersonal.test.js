const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { subirDocumento, listarDocumentos, eliminarDocumento } = require("./documentosPersonal");

function sembrarEmpleado(DB, overrides = {}) {
  DB.admin.usuarios.push({ id: 10, nombre: "Juan Pérez", usuario: "juanp", rol_id: 1, sucursal_id: 1, activo: true, ...overrides });
}

function driveFalso(overrides = {}) {
  return {
    asegurarCarpetaEmpleado: async () => "carpeta-falsa-1",
    subirArchivoADrive: async () => ({ id: "archivo-falso-1", webViewLink: "https://drive.google.com/file/d/archivo-falso-1/view" }),
    eliminarArchivoDeDrive: async () => {},
    ...overrides,
  };
}

test("subirDocumento rechaza una categoría inválida", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  await assert.rejects(
    () => subirDocumento(DB, 10, { categoria: "no_existe", nombre_archivo: "x.pdf", tipo_mime: "application/pdf", contenido_base64: "eA==" }, 1, driveFalso()),
    /Categoría de documento inválida/
  );
});

test("subirDocumento rechaza un tipo MIME no permitido", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  await assert.rejects(
    () => subirDocumento(DB, 10, { categoria: "ine", nombre_archivo: "x.docx", tipo_mime: "application/msword", contenido_base64: "eA==" }, 1, driveFalso()),
    /Tipo de archivo no permitido/
  );
});

test("subirDocumento rechaza un archivo de más de 10 MB", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  const contenidoGrande = Buffer.alloc(11 * 1024 * 1024, "a").toString("base64");
  await assert.rejects(
    () => subirDocumento(DB, 10, { categoria: "ine", nombre_archivo: "grande.pdf", tipo_mime: "application/pdf", contenido_base64: contenidoGrande }, 1, driveFalso()),
    /no puede pesar más de 10 MB/
  );
});

test("subirDocumento rechaza si el empleado no existe", async () => {
  const DB = construirDBPrueba();
  await assert.rejects(
    () => subirDocumento(DB, 999, { categoria: "ine", nombre_archivo: "x.pdf", tipo_mime: "application/pdf", contenido_base64: "eA==" }, 1, driveFalso()),
    /Empleado no encontrado/
  );
});

test("subirDocumento crea el registro de metadata cuando todo es válido", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);

  const registro = await subirDocumento(
    DB, 10,
    { categoria: "ine", nombre_archivo: "ine_frente.jpg", tipo_mime: "image/jpeg", contenido_base64: "eA==" },
    99,
    driveFalso()
  );

  assert.strictEqual(registro.usuario_id, 10);
  assert.strictEqual(registro.categoria, "ine");
  assert.strictEqual(registro.nombre_archivo, "ine_frente.jpg");
  assert.strictEqual(registro.drive_file_id, "archivo-falso-1");
  assert.strictEqual(registro.drive_link, "https://drive.google.com/file/d/archivo-falso-1/view");
  assert.strictEqual(registro.subido_por, 99);
  assert.strictEqual(DB.admin.documentos_personal.length, 1);
});

test("subirDocumento NO crea metadata si la subida a Drive falla", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  const driveQueFalla = driveFalso({ subirArchivoADrive: async () => { throw new Error("Google Drive no responde"); } });

  await assert.rejects(
    () => subirDocumento(DB, 10, { categoria: "contrato", nombre_archivo: "c.pdf", tipo_mime: "application/pdf", contenido_base64: "eA==" }, 1, driveQueFalla),
    /Google Drive no responde/
  );
  assert.strictEqual(DB.admin.documentos_personal.length, 0, "no debe quedar metadata huérfana");
});

test("listarDocumentos regresa solo los documentos de ese empleado", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB, { id: 10 });
  sembrarEmpleado(DB, { id: 11, usuario: "otro" });
  await subirDocumento(DB, 10, { categoria: "ine", nombre_archivo: "a.jpg", tipo_mime: "image/jpeg", contenido_base64: "eA==" }, 1, driveFalso());
  await subirDocumento(DB, 11, { categoria: "ine", nombre_archivo: "b.jpg", tipo_mime: "image/jpeg", contenido_base64: "eA==" }, 1, driveFalso());

  const docs = listarDocumentos(DB, 10);

  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].nombre_archivo, "a.jpg");
});

test("eliminarDocumento borra el registro y llama a drive.eliminarArchivoDeDrive", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  const registro = await subirDocumento(DB, 10, { categoria: "curriculum", nombre_archivo: "cv.pdf", tipo_mime: "application/pdf", contenido_base64: "eA==" }, 1, driveFalso());
  let llamadoCon = null;
  const drive = driveFalso({ eliminarArchivoDeDrive: async (_DB, fileId) => { llamadoCon = fileId; } });

  const resultado = await eliminarDocumento(DB, 10, registro.id, drive);

  assert.deepStrictEqual(resultado, { ok: true });
  assert.strictEqual(llamadoCon, "archivo-falso-1");
  assert.strictEqual(DB.admin.documentos_personal.length, 0);
});

test("eliminarDocumento lanza error si el documento no existe para ese empleado", async () => {
  const DB = construirDBPrueba();
  sembrarEmpleado(DB);
  await assert.rejects(() => eliminarDocumento(DB, 10, 999, driveFalso()), /Documento no encontrado/);
});
