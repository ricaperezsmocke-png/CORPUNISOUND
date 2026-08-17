/**
 * expedientesAlcance.test.js — El expediente de personal no cruza sucursales.
 *
 * Los documentos de expediente (identificaciones, contratos) viven en Drive y
 * se leen, suben y borran por `/api/usuarios/:id/documentos`. Esas tres rutas
 * exigían el permiso "gestionar_expedientes" y NADA MÁS: ningún control de
 * alcance por sucursal.
 *
 * Eso no era una hipótesis. El rol sembrado "Gerente de sucursal" (roles.js)
 * recibe todos los permisos menos cuatro, y "gestionar_expedientes" no es uno
 * de esos cuatro — mientras que "ver_todas_las_sucursales" sí lo es. O sea que
 * un gerente amarrado a una tienda podía abrir y BORRAR el expediente de un
 * empleado de otra. Y aunque no puede LISTAR usuarios (eso pide
 * "administrar_roles", que no tiene), los ids son 1, 2, 3...: enumerarlos es
 * trivial.
 *
 * Esta prueba levanta la app real y comprueba las dos mitades, porque una sola
 * no dice nada: que el gerente NO alcance a un empleado de otra tienda, y que
 * SÍ alcance a uno de la suya. La segunda es la que impide "arreglar" esto
 * dejando al gerente sin poder trabajar.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Va ANTES de requerir server.js: DB desechable para no tocar la base real.
const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-expedientes-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";

const app = require("./server");
const { sembrarCuentas } = require("./testHelpers");
const { firmarToken } = require("./auth");

// Rol 1 = Administrador (ve todas). Rol 2 = Gerente de sucursal: tiene
// gestionar_expedientes pero NO ver_todas_las_sucursales. Ver roles.js.
const TOKEN_ADMIN = firmarToken({ id: 1, nombre: "Admin", rol_id: 1, sucursal_id: 1 });
const TOKEN_GERENTE_S1 = firmarToken({ id: 2, nombre: "Gerente Ocosingo", rol_id: 2, sucursal_id: 1 });

let servidor = null;
let base = "";
let empleadoS1 = null; // empleado de la tienda del gerente
let empleadoS2 = null; // empleado de OTRA tienda

function pegar(ruta, token, opciones = {}) {
  return fetch(`${base}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opciones.headers || {}) },
  });
}

before(async () => {
  // Cuentas REALES que respaldan los tokens firmados arriba: desde que la
  // sesión comprueba que la cuenta siga activa, un token de un usuario
  // inexistente ya no sirve (ver auth.js).
  sembrarCuentas(app, [{ id: 1, rol_id: 1, sucursal_id: 1 }, { id: 2, rol_id: 2, sucursal_id: 1 }]);
  await new Promise((listo) => { servidor = app.listen(0, listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;

  // Se crean con el token de administrador, que sí tiene dar_alta_personal.
  const crear = async (nombre, usuario, sucursal_id) => {
    const r = await pegar("/api/usuarios", TOKEN_ADMIN, {
      method: "POST",
      body: JSON.stringify({ nombre, usuario, password: "claveDePrueba1", rol_id: 3, sucursal_id }),
    });
    assert.strictEqual(r.status, 200, `no se pudo sembrar el empleado ${usuario}`);
    return (await r.json()).id;
  };
  empleadoS1 = await crear("Empleado Ocosingo", `emp-s1-${process.pid}`, 1);
  empleadoS2 = await crear("Empleado Yajalón", `emp-s2-${process.pid}`, 2);
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  try { fs.unlinkSync(BASE_DESECHABLE); } catch { /* ya no estaba: da igual */ }
});

test("el gerente de una sucursal NO alcanza el expediente de un empleado de otra", async () => {
  const r = await pegar(`/api/usuarios/${empleadoS2}/documentos`, TOKEN_GERENTE_S1);
  assert.strictEqual(
    r.status, 404,
    `un gerente de la sucursal 1 no debe poder leer el expediente de un empleado de la 2 (respondió ${r.status})`
  );
  // 404 y no 403: un 403 le confirmaría que esa persona existe en otra tienda.
  const datos = await r.json();
  assert.match(datos.error, /no encontrado/i);
});

test("el gerente SÍ alcanza el expediente de un empleado de su propia sucursal", async () => {
  // El control que impide pasarse de estricto: sin esto, un guard que rechace
  // TODO también pasaría la prueba de arriba, y el gerente se quedaría sin
  // poder hacer su trabajo.
  const r = await pegar(`/api/usuarios/${empleadoS1}/documentos`, TOKEN_GERENTE_S1);
  assert.strictEqual(r.status, 200, `el gerente debe poder ver el expediente de su propia gente (respondió ${r.status})`);
  assert.ok(Array.isArray(await r.json()));
});

test("el administrador alcanza el expediente de cualquier sucursal", async () => {
  // Control de que el 404 de la primera prueba es por ALCANCE y no porque la
  // ruta esté rota o el empleado no exista.
  for (const id of [empleadoS1, empleadoS2]) {
    const r = await pegar(`/api/usuarios/${id}/documentos`, TOKEN_ADMIN);
    assert.strictEqual(r.status, 200, `el administrador debe alcanzar al empleado ${id} (respondió ${r.status})`);
  }
});

test("el selector del encabezado NO le quita expedientes al administrador", async () => {
  // Regresión real encontrada en la revisión: el guard usaba resolverAlcance(),
  // que mira ?sucursal_id= — el valor que apiFetch inyecta desde el selector
  // del ENCABEZADO. Con el encabezado en Ocosingo, el administrador seguía
  // viendo al empleado de Yajalón en la lista (GET /api/usuarios no filtra por
  // sucursal) pero su expediente respondía "Usuario no encontrado".
  const r = await pegar(`/api/usuarios/${empleadoS2}/documentos?sucursal_id=1`, TOKEN_ADMIN);
  assert.strictEqual(
    r.status, 200,
    `el encabezado es un filtro de listas, no un permiso: no debe esconder expedientes al administrador (respondió ${r.status})`
  );
});

test("y tampoco se lo REGALA al gerente que manda sucursal_id=todas", async () => {
  // La otra mitad: si el encabezado no puede quitar alcance, tampoco puede
  // darlo. Un gerente que arme la petición a mano con ?sucursal_id=todas sigue
  // sin alcanzar otra tienda, porque su alcance sale de su token, no del query.
  for (const query of ["?sucursal_id=todas", "?sucursal_id=2", ""]) {
    const r = await pegar(`/api/usuarios/${empleadoS2}/documentos${query}`, TOKEN_GERENTE_S1);
    assert.strictEqual(r.status, 404, `el gerente amplió su alcance con "${query}" (respondió ${r.status})`);
  }
});

test("subir y borrar documentos también respetan el alcance", async () => {
  // Leer de más es grave; BORRAR de más lo es más. Se comprueba que el guard
  // corre ANTES que cualquier otra validación de la ruta (incluida la de
  // Drive), porque si corriera después el 404 dependería de si Drive está
  // conectado o no.
  const subir = await pegar(`/api/usuarios/${empleadoS2}/documentos`, TOKEN_GERENTE_S1, {
    method: "POST",
    body: JSON.stringify({ nombre_archivo: "credencial.pdf", tipo_mime: "application/pdf", contenido_base64: "AAAA" }),
  });
  assert.strictEqual(subir.status, 404, `subir al expediente de otra sucursal debe dar 404 (respondió ${subir.status})`);

  const borrar = await pegar(`/api/usuarios/${empleadoS2}/documentos/1`, TOKEN_GERENTE_S1, { method: "DELETE" });
  assert.strictEqual(borrar.status, 404, `borrar del expediente de otra sucursal debe dar 404 (respondió ${borrar.status})`);
});
