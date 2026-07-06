const { test } = require("node:test");
const assert = require("node:assert");
const { firmarToken, verificarToken } = require("./auth");

test("el token incluye sucursal_id del usuario", () => {
  const token = firmarToken({ id: 5, nombre: "Cajera Yajalón", rol_id: 3, sucursal_id: 2 });
  const payload = verificarToken(token);
  assert.strictEqual(payload.sucursal_id, 2);
  assert.strictEqual(payload.id, 5);
  assert.strictEqual(payload.rol_id, 3);
});
