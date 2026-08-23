/**
 * Un respaldo hecho por una versión ANTERIOR del sistema tiene que seguir
 * siendo legible.
 *
 * El caso salió en producción el 2026-08-23: al desplegar Radar de Demanda se
 * agregó `radar_demanda` a COLECCIONES_RESPALDADAS, y leerRespaldo compara
 * contra la lista de HOY. Todos los respaldos anteriores —que no podían
 * contener ese módulo porque no existía— quedaron ilegibles de golpe. El
 * sistema tenía 30 días de puntos de restauración y ninguno se podía abrir.
 *
 * La protección original se conserva: si a un respaldo le falta algo que él
 * mismo declara haber guardado, sigue siendo corrupción y se rechaza.
 */
const { test } = require("node:test");
const assert = require("node:assert");

const { crearRespaldo, leerRespaldo, nuevoEstadoRespaldos, COLECCIONES_RESPALDADAS } = require("./respaldos");
const { empaquetar, desempaquetar } = require("./respaldoCifrado");

const LLAVE = Buffer.from("a".repeat(64), "hex");

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

function nuevoDB() {
  const DB = { respaldos: nuevoEstadoRespaldos() };
  for (const clave of COLECCIONES_RESPALDADAS) DB[clave] = {};
  DB.pos = { ventas: [{ id: 1, total: 100, tipo_documento: "Ticket" }], cortes_caja: [] };
  DB.crm = { clientes: [{ id: 1, nombre: "Ana" }] };
  DB.radar_demanda = { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 };
  return DB;
}

/** Reescribe el archivo que quedó en el Drive falso, aplicándole un cambio. */
async function reescribirArchivo(drive, fileId, cambiar) {
  const foto = desempaquetar(drive.archivos.get(fileId), LLAVE);
  cambiar(foto);
  drive.archivos.set(fileId, empaquetar(foto, LLAVE));
}

test("un respaldo de una version anterior, sin un modulo que aun no existia, SI se puede leer", async () => {
  const DB = nuevoDB();
  const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });

  // Simula un respaldo viejo: no traía radar_demanda ni declaraba colecciones,
  // porque se hizo antes de que ese módulo y esta corrección existieran.
  await reescribirArchivo(drive, copia.drive_file_id, (foto) => {
    delete foto.datos.radar_demanda;
    delete foto.colecciones;
  });

  const leido = await leerRespaldo(DB, drive, copia.id, LLAVE);
  assert.ok(leido.foto, "debió poder abrirse");
  assert.deepEqual(
    leido.foto.datos.radar_demanda, {},
    "el módulo que no existía se restaura vacío, que es lo que había entonces"
  );
  assert.equal(leido.foto.datos.crm.clientes.length, 1, "y el resto de los datos intacto");
});

test("si el respaldo DECLARA una coleccion y el archivo no la trae, sigue siendo corrupcion", async () => {
  const DB = nuevoDB();
  const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });

  // Aquí el archivo sí declara haber guardado crm, pero el dato no está:
  // eso no es una versión vieja, es un archivo mutilado.
  await reescribirArchivo(drive, copia.drive_file_id, (foto) => {
    delete foto.datos.crm;
  });

  await assert.rejects(
    () => leerRespaldo(DB, drive, copia.id, LLAVE),
    /incompleto|falta/i,
    "un respaldo mutilado se sigue rechazando entero"
  );
});

test("los respaldos nuevos declaran que colecciones guardaron", async () => {
  const DB = nuevoDB();
  const drive = driveConMemoria();
  const copia = await crearRespaldo(DB, drive, { tipo: "dia", llave: LLAVE });

  const foto = desempaquetar(drive.archivos.get(copia.drive_file_id), LLAVE);
  assert.deepEqual(
    foto.colecciones, [...COLECCIONES_RESPALDADAS],
    "sin esto, el de mañana no puede distinguir un modulo nuevo de un dato perdido"
  );
});
