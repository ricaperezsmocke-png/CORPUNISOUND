/**
 * sesionesEpoch.test.js — El corte de sesiones que dispara la restauración.
 *
 * Por qué existe: `requiereLogin` solo verifica la FIRMA del token, y
 * `requierePermiso` resuelve los permisos con el `rol_id` que viene DENTRO del
 * token, contra el DB del momento. Restaurar reemplaza `DB.admin` entero
 * —usuarios y roles—, y los ids de rol se reciclan (`siguienteId` = max + 1).
 *
 * Sin corte, dos cosas malas y silenciosas:
 *  1. Una cajera con sesión abierta cuyo `rol_id` en la foto restaurada
 *     corresponda a otro rol, despierta con los permisos de ESE rol.
 *  2. Una cuenta borrada revive con su token todavía válido (12 h).
 *
 * Y el sistema le PROMETÍA a Victor por escrito que esto no pasaba: la respuesta
 * de restaurar dice "Todos los usuarios conectados tienen que volver a iniciar
 * sesión", la pantalla lo repite y el instructivo lo eleva a advertencia. Antes
 * de este corte, lo único que ocurría era que el navegador de QUIEN restauró
 * borraba su propio localStorage.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas-epoch";

const { test } = require("node:test");
const assert = require("node:assert");
const {
  firmarToken, requiereLogin, invalidarSesionesAnterioresA, sesionesValidasDesde,
} = require("./auth");

/** Corre requiereLogin sin levantar Express y devuelve lo que respondió. */
function pasarPorRequiereLogin(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  let status = null;
  let cuerpo = null;
  let siguio = false;
  const res = {
    status(c) { status = c; return this; },
    json(o) { cuerpo = o; return this; },
  };
  requiereLogin(req, res, () => { siguio = true; });
  return { siguio, status, cuerpo, usuarioToken: req.usuarioToken };
}

test("sin ninguna restauración, un token válido pasa", () => {
  const token = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
  const r = pasarPorRequiereLogin(token);
  assert.strictEqual(r.siguio, true);
  assert.strictEqual(r.usuarioToken.nombre, "Victor");
});

test("tras una restauración, el token emitido ANTES deja de valer", () => {
  const tokenViejo = firmarToken({ id: 3, nombre: "Cajera", rol_id: 3, sucursal_id: 1 });
  // El corte se fija un segundo COMPLETO en el futuro respecto al `iat` del
  // token (que jwt guarda en segundos): así la prueba no depende de que el
  // token y la restauración caigan en segundos distintos por casualidad.
  invalidarSesionesAnterioresA(Date.now() + 2000);
  try {
    const r = pasarPorRequiereLogin(tokenViejo);
    assert.strictEqual(r.siguio, false, "el token viejo NO debió pasar");
    assert.strictEqual(r.status, 401);
    // El MENSAJE importa: si dijera solo "sesión inválida", Victor y sus cajeras
    // pensarían que se rompió algo. Tiene que explicar qué pasó.
    assert.match(r.cuerpo.error, /restaur/i);
  } finally {
    invalidarSesionesAnterioresA(0); // se suelta para no contaminar otras pruebas
  }
});

test("un token emitido DESPUÉS de la restauración sí vale", () => {
  invalidarSesionesAnterioresA(Date.now() - 5000); // la restauración fue hace rato
  try {
    const tokenNuevo = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
    const r = pasarPorRequiereLogin(tokenNuevo);
    assert.strictEqual(r.siguio, true, "quien vuelve a entrar debe poder trabajar");
  } finally {
    invalidarSesionesAnterioresA(0);
  }
});

test("el corte arranca apagado: sin restauraciones no invalida nada", () => {
  // Se comprueba el estado inicial ANTES de tocar nada. La versión tautológica
  // de esta idea (llamar a la función y luego afirmar) no probaría el default.
  assert.strictEqual(sesionesValidasDesde(), 0);
});

test("el corte NO vive en el DB — sobrevive a que le reemplacen los datos", () => {
  // Es a propósito: el DB es justo lo que se está reemplazando durante una
  // restauración, así que persistir el corte ahí lo dejaría apuntando a un
  // instante restaurado (o lo borraría). Vive en memoria del proceso.
  invalidarSesionesAnterioresA(1234567890);
  try {
    assert.strictEqual(sesionesValidasDesde(), 1234567890);
  } finally {
    invalidarSesionesAnterioresA(0);
  }
});
