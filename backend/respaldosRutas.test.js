/**
 * respaldosRutas.test.js — El CABLEADO de las rutas de Respaldos y Punto de
 * Restauración, más el middleware de mantenimiento que congela el sistema
 * mientras se restaura.
 *
 * Le pega a las rutas REALES vía require("./server"), igual que
 * rutasEscrituraSucursal.test.js: server.js expone solo la app (no abre
 * puerto ni arranca el reloj de respaldos) hasta que
 * ESTE_PROCESO_ES_EL_SERVIDOR es cierto.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ⚠️ ESTO VA ANTES DE REQUERIR server.js — sin esto la prueba lee y ENSUCIA la
// base real datos.sqlite del desarrollador. Requerir server.js abre SQLite y
// restaura el estado guardado. Copiado de rutasEscrituraSucursal.test.js, que
// ya resolvió exactamente este problema.
const DB_TEMPORAL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "respaldos-")), "datos.sqlite");
process.env.DB_PATH = DB_TEMPORAL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";
// Llave válida para que LLAVE_RESPALDO quede configurada en el servidor de
// pruebas: sin esto, las rutas fallan ANTES de llegar al candado que cada
// prueba dice estar probando (RESPALDO_LLAVE ausente, no CLAVE_RESTAURACION
// ni el token de descarga), y las pruebas de esos candados no muerden nada.
process.env.RESPALDO_LLAVE = process.env.RESPALDO_LLAVE || "a".repeat(64);

const { PALABRA_CONFIRMACION } = require("./respaldos");
const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");
const { listarPermisos } = require("./permisosCatalogo");
const mantenimiento = require("./mantenimiento");
// Mismo módulo que usa server.js (require cachea por ruta resuelta): mutar
// sus funciones aquí cambia lo que ven las rutas reales, sin tocar Google
// Drive de verdad. Patrón tomado de respaldos.test.js -> driveConMemoria().
const drive = require("./drive");

// Rol 1 = "Administrador" (sembrarRolesIniciales en backend/roles.js): tiene
// TODOS los permisos, incluidos los del módulo respaldos (reconciliarRoles se
// los da en cada arranque).
//
// ⚠️ `sucursal_id: 1` Y NO `null`, y esto NO es un detalle. La versión anterior
// firmaba los tokens de prueba con `sucursal_id: null`, una forma que el sistema
// real NO PUEDE PRODUCIR: `crearUsuario` fuerza `Number(...) || 1` y el setup
// inicial crea al primer administrador con sucursal_id 1. Como el candado de
// restaurar() exigía `sucursal_id == null`, las pruebas pasaban en verde
// mientras la restauración era IMPOSIBLE para toda cuenta real. El alcance
// global se decide por el PERMISO `ver_todas_las_sucursales`, que el rol 1 tiene.
// Regla: los tokens de prueba deben tener la forma que emite el login de verdad.
const TOKEN_ADMIN = firmarToken({ id: 1, nombre: "Administrador de prueba", rol_id: 1, sucursal_id: 1 });
// Rol 2 = "Gerente de sucursal": tiene casi todo, pero NO ver_todas_las_sucursales.
const TOKEN_GERENTE = firmarToken({ id: 2, nombre: "Gerente de Ocosingo", rol_id: 2, sucursal_id: 1 });
// Rol 3 = "Cajero": no tiene ningún permiso de respaldos.
const TOKEN_CAJERO = firmarToken({ id: 3, nombre: "Cajera de Ocosingo", rol_id: 3, sucursal_id: 1 });

/** Token de administrador recién firmado. Hace falta después de cada
 *  restauración: restaurar corta TODAS las sesiones abiertas (epoch en auth.js),
 *  incluida la de quien restauró. */
function tokenNuevo() {
  return firmarToken({ id: 1, nombre: "Administrador de prueba", rol_id: 1, sucursal_id: 1 });
}

let servidor = null;
let base = "";

before(async () => {
  // Cuentas REALES que respaldan los tokens firmados arriba: desde que la
  // sesión comprueba que la cuenta siga activa, un token de un usuario
  // inexistente ya no sirve (ver auth.js).
  sembrarCuentas(app, [{ id: 1, rol_id: 1, sucursal_id: 1 }, { id: 2, rol_id: 2, sucursal_id: 1 }, { id: 3, rol_id: 3, sucursal_id: 1 }]);
  await new Promise((listo) => {
    servidor = app.listen(0, listo); // puerto efímero: no choca con el backend de desarrollo
  });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
});

async function pedir(ruta, opciones = {}) {
  const r = await fetch(base + ruta, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(opciones.headers || {}) },
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (_) {}
  return { status: r.status, cuerpo };
}

test("los tres permisos del módulo están en el catálogo", () => {
  const claves = listarPermisos().map((p) => p.clave);
  assert.ok(claves.includes("ver_respaldos"));
  assert.ok(claves.includes("restaurar_respaldo"));
  // "Respaldar ahora" ESCRIBE (sube a Drive un archivo con toda la empresa), así
  // que tiene permiso propio en vez de ir prestado del de VER.
  assert.ok(claves.includes("crear_respaldo"));
  const modulos = listarPermisos().filter((p) => p.modulo === "respaldos");
  assert.strictEqual(modulos.length, 3);
});

test("GET /api/respaldos sin sesión responde 401", async () => {
  assert.strictEqual((await pedir("/api/respaldos")).status, 401);
});

test("GET /api/respaldos con sesión responde 200 con la lista de copias", async () => {
  const r = await pedir("/api/respaldos", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.cuerpo));
});

test("GET /api/respaldos/estado responde 200 con los avisos de configuración", async () => {
  const r = await pedir("/api/respaldos/estado", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });
  assert.strictEqual(r.status, 200);
  assert.ok("respaldo_configurado" in r.cuerpo);
  assert.ok("restauracion_habilitada" in r.cuerpo);
  assert.ok("mantenimiento" in r.cuerpo);
});

// ---------- Descarga: se necesita una copia REAL para que las pruebas muerdan ----------
//
// Sin una copia sembrada, "sin token" y "token malo" caen los dos en el MISMO
// 404 genérico de "copia no encontrada" — pasarían igual sin ningún chequeo de
// token. Se crea un respaldo de verdad (vía la propia ruta /ahora, con Drive
// mockeado) para que el contraste con "token correcto" sea real.
let copiaSembrada = null;

test("preparación: crea un respaldo real (Drive mockeado) para las pruebas de descarga", async () => {
  const asegurarOriginal = drive.asegurarCarpetaRespaldos;
  const subirOriginal = drive.subirArchivoADrive;
  drive.asegurarCarpetaRespaldos = async () => "carpeta-prueba";
  drive.subirArchivoADrive = async () => ({ id: "drive-file-fake-1", webViewLink: "https://drive/fake-1" });
  try {
    const r = await pedir("/api/respaldos/ahora", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
    assert.ok(r.cuerpo.drive_file_id, "la copia sembrada necesita drive_file_id para poder descargarse");
    copiaSembrada = r.cuerpo;
  } finally {
    drive.asegurarCarpetaRespaldos = asegurarOriginal;
    drive.subirArchivoADrive = subirOriginal;
  }
});

test("GET /api/respaldos/:id/descargar sin TOKEN_DESCARGA_RESPALDOS responde 404", async () => {
  const guardado = process.env.TOKEN_DESCARGA_RESPALDOS;
  delete process.env.TOKEN_DESCARGA_RESPALDOS;
  assert.strictEqual((await pedir(`/api/respaldos/${copiaSembrada.id}/descargar`)).status, 404);
  if (guardado !== undefined) process.env.TOKEN_DESCARGA_RESPALDOS = guardado;
});

test("GET /api/respaldos/:id/descargar con token equivocado responde 404", async () => {
  process.env.TOKEN_DESCARGA_RESPALDOS = "token-bueno";
  const r = await pedir(`/api/respaldos/${copiaSembrada.id}/descargar`, { headers: { "X-Token-Respaldo": "token-malo" } });
  assert.strictEqual(r.status, 404);
  delete process.env.TOKEN_DESCARGA_RESPALDOS;
});

test("GET /api/respaldos/:id/descargar con el token correcto SÍ sirve los bytes (contraste real con los 404 de arriba)", async () => {
  process.env.TOKEN_DESCARGA_RESPALDOS = "token-bueno";
  const bytesFalsos = Buffer.from("contenido-cifrado-de-prueba");
  const descargarOriginal = drive.descargarArchivoDeDrive;
  drive.descargarArchivoDeDrive = async () => bytesFalsos;
  try {
    const r = await fetch(`${base}/api/respaldos/${copiaSembrada.id}/descargar`, {
      headers: { "X-Token-Respaldo": "token-bueno" },
    });
    // Lo que importa: NO es el mismo 404 genérico de las dos pruebas de arriba.
    assert.notStrictEqual(r.status, 404);
    assert.strictEqual(r.status, 200);
    const bytesRecibidos = Buffer.from(await r.arrayBuffer());
    assert.ok(bytesRecibidos.equals(bytesFalsos), "debió servir exactamente los bytes que devolvió Drive");
  } finally {
    drive.descargarArchivoDeDrive = descargarOriginal;
    delete process.env.TOKEN_DESCARGA_RESPALDOS;
  }
});

// ---------- Índice: el mismo candado que /descargar, para el script de la PC ----------

test("GET /api/respaldos/indice sin TOKEN_DESCARGA_RESPALDOS responde 404", async () => {
  const guardado = process.env.TOKEN_DESCARGA_RESPALDOS;
  delete process.env.TOKEN_DESCARGA_RESPALDOS;
  assert.strictEqual((await pedir("/api/respaldos/indice")).status, 404);
  if (guardado !== undefined) process.env.TOKEN_DESCARGA_RESPALDOS = guardado;
});

test("GET /api/respaldos/indice con token equivocado responde 404", async () => {
  process.env.TOKEN_DESCARGA_RESPALDOS = "token-bueno";
  const r = await pedir("/api/respaldos/indice", { headers: { "X-Token-Respaldo": "token-malo" } });
  assert.strictEqual(r.status, 404);
  delete process.env.TOKEN_DESCARGA_RESPALDOS;
});

test("GET /api/respaldos/indice con el token correcto responde 200 con un arreglo que incluye la copia sembrada", async () => {
  process.env.TOKEN_DESCARGA_RESPALDOS = "token-bueno";
  try {
    const r = await pedir("/api/respaldos/indice", { headers: { "X-Token-Respaldo": "token-bueno" } });
    // Lo que importa: NO es el mismo 404 genérico de las dos pruebas de arriba.
    assert.notStrictEqual(r.status, 404);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.cuerpo));
    assert.ok(r.cuerpo.some((c) => c.id === copiaSembrada.id), "la copia sembrada debe aparecer en el índice");
  } finally {
    delete process.env.TOKEN_DESCARGA_RESPALDOS;
  }
});

test("GET /api/respaldos/indice NO filtra drive_file_id ni conteos (solo lo que el script necesita)", async () => {
  process.env.TOKEN_DESCARGA_RESPALDOS = "token-bueno";
  try {
    const r = await pedir("/api/respaldos/indice", { headers: { "X-Token-Respaldo": "token-bueno" } });
    assert.strictEqual(r.status, 200);
    const entrada = r.cuerpo.find((c) => c.id === copiaSembrada.id);
    assert.ok(entrada, "la copia sembrada debe aparecer en el índice");
    assert.ok(!("drive_file_id" in entrada), "el id de Drive no debe salir de esta ruta pública sin sesión");
    assert.ok(!("conteos" in entrada), "los conteos son dato del negocio, no le sirven al script de la PC");
    assert.deepStrictEqual(
      Object.keys(entrada).sort(),
      ["bytes", "estado", "fecha", "hora_local", "id", "nombre_archivo", "tipo"].sort()
    );
  } finally {
    delete process.env.TOKEN_DESCARGA_RESPALDOS;
  }
});

test("POST /api/respaldos/:id/restaurar sin CLAVE_RESTAURACION responde 400 con el mensaje del candado y no muta nada", async () => {
  const guardado = process.env.CLAVE_RESTAURACION;
  delete process.env.CLAVE_RESTAURACION;

  const antes = await pedir("/api/respaldos", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });

  const r = await pedir(`/api/respaldos/${copiaSembrada.id}/restaurar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({ clave: "x", confirmacion: PALABRA_CONFIRMACION }),
  });
  assert.strictEqual(r.status, 400);
  // El aserto que vale es el del MENSAJE: sin este candado, otros caminos
  // (respaldo no encontrado, clave incorrecta) también darían 400 — el
  // mensaje es lo único que distingue que se paró aquí y no más adelante.
  assert.match(r.cuerpo.error, /CLAVE_RESTAURACION/);

  // "No muta": ni el índice de respaldos cambió, ni quedó el sistema en
  // mantenimiento (el candado de la clave es el PRIMERO, antes de tocar nada).
  const despues = await pedir("/api/respaldos", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });
  assert.deepStrictEqual(despues.cuerpo, antes.cuerpo, "el índice de respaldos no debió cambiar");
  const estado = await pedir("/api/respaldos/estado", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });
  assert.strictEqual(estado.cuerpo.mantenimiento.activo, false, "no debió activarse el mantenimiento");

  if (guardado !== undefined) process.env.CLAVE_RESTAURACION = guardado;
});

// ---------- Mantenimiento: middleware global que congela las escrituras ----------

test("con el sistema en mantenimiento, una venta recibe 503 y NO se registra", async () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: null });
  mantenimiento.activar("Restaurando el respaldo del 2026-08-11 16:00");
  try {
    const r = await fetch(`${base}/api/ventas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sucursal_id: 1, lineas: [] }),
    });
    assert.strictEqual(r.status, 503);
    const cuerpo = await r.json();
    assert.strictEqual(cuerpo.mantenimiento, true);
    assert.match(cuerpo.error, /Restaurando|mantenimiento/i);
  } finally {
    mantenimiento.desactivar();
  }
});

test("en mantenimiento las LECTURAS siguen pasando (para poder ver por qué)", async () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: null });
  mantenimiento.activar("Restaurando");
  try {
    const r = await fetch(`${base}/api/respaldos/estado`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(r.status, 200);
    const cuerpo = await r.json();
    assert.strictEqual(cuerpo.mantenimiento.activo, true);
  } finally {
    mantenimiento.desactivar();
  }
});

test("apagado el mantenimiento, las escrituras vuelven solas", async () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: null });
  mantenimiento.activar("x");
  mantenimiento.desactivar();
  const r = await fetch(`${base}/api/ventas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sucursal_id: 1, lineas: [] }),
  });
  assert.notStrictEqual(r.status, 503, "el bloqueo se quedó pegado");
});

test("el LOGIN también recibe 503 en mantenimiento, con la marca que la pantalla usa", async () => {
  // Es la única razón de ser del cambio en src/Login.jsx. Sin esta prueba, nadie
  // impide que alguien "arregle" el middleware exceptuando el login y rompa esa
  // pantalla sin que ninguna prueba se entere.
  mantenimiento.activar("Restaurando el respaldo del 2026-08-11 16:00");
  try {
    const r = await pedir("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ usuario: "victor", password: "x" }),
    });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.cuerpo.mantenimiento, true);
    assert.match(r.cuerpo.error, /Restaurando|mantenimiento/i);
  } finally {
    mantenimiento.desactivar();
  }
});

// ---------- Permiso y ALCANCE por ruta ----------
//
// Estas pruebas no existían: TODAS las de ruta usaban el token de administrador
// o ninguno. Se podía quitar `requierePermiso` o `requiereAlcanceGlobal` de
// cualquiera de las cuatro rutas y la suite entera seguía verde. Es exactamente
// el bug de alcance de Apartados que los comentarios del propio módulo citan.

test("un CAJERO no puede ni ver los respaldos", async () => {
  const r = await pedir("/api/respaldos", { headers: { Authorization: `Bearer ${TOKEN_CAJERO}` } });
  assert.strictEqual(r.status, 403);
});

test("un CAJERO no puede disparar un respaldo", async () => {
  const r = await pedir("/api/respaldos/ahora", {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN_CAJERO}` },
  });
  assert.strictEqual(r.status, 403);
});

test("un GERENTE amarrado a su sucursal NO puede restaurar (le falta el alcance global)", async () => {
  const r = await pedir(`/api/respaldos/${copiaSembrada.id}/restaurar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_GERENTE}` },
    body: JSON.stringify({ clave: "x", confirmacion: PALABRA_CONFIRMACION }),
  });
  assert.strictEqual(r.status, 403);
  // El MENSAJE es lo que vale: requierePermiso y requiereAlcanceGlobal devuelven
  // los dos 403, y solo el texto distingue cuál de los dos actuó. Sin este
  // aserto, quitar el guard de alcance dejaría la prueba en verde.
  assert.match(r.cuerpo.error, /sucursal|alcance|todas/i);
});

test("un GERENTE tampoco puede comparar un respaldo con el estado actual", async () => {
  const r = await pedir(`/api/respaldos/${copiaSembrada.id}/comparar`, {
    headers: { Authorization: `Bearer ${TOKEN_GERENTE}` },
  });
  assert.strictEqual(r.status, 403);
});

// ---------- Restauración: el CAMINO FELIZ, de punta a punta ----------

/** Monta un Drive falso con memoria y deja restaurable la copia sembrada. */
function conDriveDeMemoria(fn) {
  return async () => {
    const originales = {
      asegurar: drive.asegurarCarpetaRespaldos,
      subir: drive.subirArchivoADrive,
      descargar: drive.descargarArchivoDeDrive,
    };
    const archivos = new Map();
    let n = 0;
    drive.asegurarCarpetaRespaldos = async () => "carpeta-prueba";
    drive.subirArchivoADrive = async (_DB, args) => {
      const id = `drive-mem-${++n}`;
      archivos.set(id, args.contenidoBuffer);
      return { id, webViewLink: `https://drive/${id}` };
    };
    drive.descargarArchivoDeDrive = async (_DB, id) => {
      if (!archivos.has(id)) throw new Error("404 en Drive");
      return archivos.get(id);
    };
    try {
      await fn({ archivos });
    } finally {
      drive.asegurarCarpetaRespaldos = originales.asegurar;
      drive.subirArchivoADrive = originales.subir;
      drive.descargarArchivoDeDrive = originales.descargar;
    }
  };
}

test("POST /:id/restaurar CON una cuenta real de administrador SÍ restaura", conDriveDeMemoria(async () => {
  // LA prueba que faltaba. Antes solo se probaba que restaurar FALLA (sin clave,
  // con clave mala, sin confirmación, con usuario amarrado). Nadie comprobó nunca
  // que el camino feliz funcionara — y no funcionaba: el candado exigía una forma
  // de cuenta que el sistema no puede crear.
  process.env.CLAVE_RESTAURACION = "clave-de-prueba-123";
  try {
    const creada = await pedir("/api/respaldos/ahora", {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    assert.strictEqual(creada.status, 200, JSON.stringify(creada.cuerpo));

    const r = await pedir(`/api/respaldos/${creada.cuerpo.id}/restaurar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
      body: JSON.stringify({ clave: "clave-de-prueba-123", confirmacion: PALABRA_CONFIRMACION }),
    });
    assert.strictEqual(r.status, 200, `la restauración debió funcionar: ${JSON.stringify(r.cuerpo)}`);
    assert.strictEqual(r.cuerpo.ok, true);
    assert.ok(r.cuerpo.restaurado_a, "debe decir a qué momento se restauró");
    assert.ok(r.cuerpo.respaldo_previo, "debe existir el respaldo de seguridad previo");

    // Y el sistema queda ABIERTO otra vez: el bloqueo no se quedó pegado.
    // OJO: hace falta un token NUEVO — restaurar corta todas las sesiones
    // abiertas a propósito (ver invalidarSesionesAnterioresA en auth.js), así que
    // el token de antes ya no vale. Que esta línea sea necesaria ES la prueba de
    // que el corte funciona; la de abajo lo comprueba de frente.
    const estado = await pedir("/api/respaldos/estado", { headers: { Authorization: `Bearer ${tokenNuevo()}` } });
    assert.strictEqual(estado.status, 200, JSON.stringify(estado.cuerpo));
    assert.strictEqual(estado.cuerpo.mantenimiento.activo, false, "el bloqueo se quedó pegado tras restaurar");
  } finally {
    delete process.env.CLAVE_RESTAURACION;
  }
}));

test("dos restauraciones a la vez: solo UNA procede y solo se crea UN respaldo previo", conDriveDeMemoria(async () => {
  // El bug: `mantenimiento` se prende DESPUÉS de bajar el archivo de Drive, así
  // que entre la entrada y ese punto pasaban las dos peticiones. La segunda creaba
  // su propio pre_restauracion — una foto del estado YA restaurado —, y el
  // instructivo le dice a Victor que para deshacer use "el pre_restauracion más
  // reciente": habría deshecho hacia el estado equivocado. Además el `finally` de
  // la primera reabría la tienda con la segunda todavía escribiendo.
  process.env.CLAVE_RESTAURACION = "clave-de-prueba-123";
  const descargarOriginal = drive.descargarArchivoDeDrive;
  try {
    const creada = await pedir("/api/respaldos/ahora", {
      method: "POST", headers: { Authorization: `Bearer ${tokenNuevo()}` },
    });
    assert.strictEqual(creada.status, 200, JSON.stringify(creada.cuerpo));

    // Se hace LENTA la descarga de Drive: es la ventana donde vivía el bug.
    const original = drive.descargarArchivoDeDrive;
    drive.descargarArchivoDeDrive = async (...args) => {
      await new Promise((listo) => setTimeout(listo, 300));
      return original(...args);
    };

    const cuerpo = JSON.stringify({ clave: "clave-de-prueba-123", confirmacion: PALABRA_CONFIRMACION });
    const cabeceras = { Authorization: `Bearer ${tokenNuevo()}` };
    // Se mide el INCREMENTO, no el total: el índice viene compartido con las
    // pruebas anteriores de este archivo (mismo servidor, mismo DB en memoria).
    const listaAntes = (await pedir("/api/respaldos", { headers: cabeceras })).cuerpo;
    const antes = listaAntes.length;
    const previosAntes = listaAntes.filter((c) => c.tipo === "pre_restauracion").length;

    const [a, b] = await Promise.all([
      pedir(`/api/respaldos/${creada.cuerpo.id}/restaurar`, { method: "POST", headers: cabeceras, body: cuerpo }),
      pedir(`/api/respaldos/${creada.cuerpo.id}/restaurar`, { method: "POST", headers: cabeceras, body: cuerpo }),
    ]);

    const exitos = [a, b].filter((r) => r.status === 200);
    const rechazos = [a, b].filter((r) => r.status !== 200);
    assert.strictEqual(exitos.length, 1, "solo una restauración debió proceder");
    assert.strictEqual(rechazos.length, 1);
    assert.match(rechazos[0].cuerpo.error, /en curso/i, "la segunda debe decir que ya hay una en curso");

    // Y lo que de verdad importa: UN solo respaldo previo, no dos.
    const despues = (await pedir("/api/respaldos", { headers: { Authorization: `Bearer ${tokenNuevo()}` } })).cuerpo;
    const previos = despues.filter((c) => c.tipo === "pre_restauracion").length - previosAntes;
    assert.strictEqual(
      previos, 1,
      "se crearon dos pre_restauracion: el segundo es una foto del estado YA restaurado, " +
      "y el instructivo manda usar el más reciente para deshacer — Victor se quedaría sin marcha atrás",
    );
    assert.strictEqual(despues.length, antes + 1, "solo debió agregarse el pre_restauracion de la que sí corrió");
  } finally {
    drive.descargarArchivoDeDrive = descargarOriginal;
    delete process.env.CLAVE_RESTAURACION;
  }
}));

// (La conservación de las credenciales de Drive/ML al restaurar se prueba a
// nivel de módulo en respaldos.test.js, donde se puede manipular el DB directo.)

test("el índice sin sesión tiene freno de fuerza bruta tras varios tokens malos", async () => {
  // Son las únicas rutas del sistema sin sesión que tocan datos del negocio, y
  // no hay rate limiting a nivel de red. Sin freno se podían probar tokens sin
  // límite, y cada acierto dispara una descarga de Drive con el OAuth del
  // negocio. El login y el botón de restaurar ya tenían su freno; estas no.
  process.env.TOKEN_DESCARGA_RESPALDOS = "token-bueno-para-el-freno";
  try {
    // Se agota el contador con tokens equivocados.
    for (let i = 0; i < 6; i++) {
      await pedir("/api/respaldos/indice", { headers: { "X-Token-Respaldo": `malo-${i}` } });
    }
    // Y ahora ni el token CORRECTO pasa: el freno está puesto.
    const r = await pedir("/api/respaldos/indice", {
      headers: { "X-Token-Respaldo": "token-bueno-para-el-freno" },
    });
    assert.strictEqual(
      r.status, 404,
      "tras varios intentos fallidos la ruta debe quedar frenada, incluso para el token bueno",
    );
    // 404 y no 429: desde fuera no se distingue "frenado" de "no existe". Que la
    // ruta no confirme nada es parte del diseño.
    assert.deepStrictEqual(r.cuerpo, { error: "No encontrado" });
  } finally {
    delete process.env.TOKEN_DESCARGA_RESPALDOS;
  }
});
