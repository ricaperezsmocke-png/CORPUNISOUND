const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { distanciaMetros, validarUbicacionLogin } = require("./auth");

test("distanciaMetros entre el mismo punto es 0", () => {
  assert.strictEqual(distanciaMetros(17.9, -92.9, 17.9, -92.9), 0);
});

test("distanciaMetros aproxima 1 grado de longitud en el ecuador a ~111.32 km", () => {
  const d = distanciaMetros(0, 0, 0, 1);
  assert.ok(Math.abs(d - 111320) < 500, `esperado ~111320m, obtuve ${d}`);
});

test("validarUbicacionLogin: usuario global (ver_todas_las_sucursales) siempre ok, sin pedir sucursal ni ubicación", () => {
  const DB = construirDBPrueba();
  const admin = { rol_id: 1, sucursal_id: 1 }; // rol 1 = Administrador (sembrado por construirDBPrueba)
  const r = validarUbicacionLogin(admin, undefined, undefined, undefined, DB);
  assert.deepStrictEqual(r, { ok: true });
});

test("validarUbicacionLogin: usuario amarrado con sucursal seleccionada distinta a la real -> sucursal_no_coincide", () => {
  const DB = construirDBPrueba();
  const cajero = { rol_id: 3, sucursal_id: 2 }; // rol 3 = Cajero
  const r = validarUbicacionLogin(cajero, 1, 17.9, -92.9, DB);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "sucursal_no_coincide");
});

test("validarUbicacionLogin: sucursal correcta pero sin coordenadas configuradas -> ok (no bloquea)", () => {
  const DB = construirDBPrueba();
  const cajero = { rol_id: 3, sucursal_id: 2 };
  const r = validarUbicacionLogin(cajero, 2, null, null, DB);
  assert.deepStrictEqual(r, { ok: true });
});

test("validarUbicacionLogin: sin lat/lng cuando la sucursal SÍ tiene coordenadas -> sin_permiso_ubicacion", () => {
  const DB = construirDBPrueba();
  const sucursal = DB.pos.sucursales.find((s) => s.id === 2);
  sucursal.lat = 17.9583; sucursal.lng = -92.9128;
  const cajero = { rol_id: 3, sucursal_id: 2 };
  const r = validarUbicacionLogin(cajero, 2, null, null, DB);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "sin_permiso_ubicacion");
});

test("validarUbicacionLogin: fuera del radio de tolerancia -> ubicacion_no_coincide", () => {
  const DB = construirDBPrueba();
  const sucursal = DB.pos.sucursales.find((s) => s.id === 2);
  sucursal.lat = 17.9583; sucursal.lng = -92.9128;
  const cajero = { rol_id: 3, sucursal_id: 2 };
  // ~1km al norte del punto configurado — muy fuera de los 300m de tolerancia
  const r = validarUbicacionLogin(cajero, 2, 17.9673, -92.9128, DB);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "ubicacion_no_coincide");
  assert.ok(r.distancia > 300);
});

test("validarUbicacionLogin: dentro del radio de tolerancia -> ok", () => {
  const DB = construirDBPrueba();
  const sucursal = DB.pos.sucursales.find((s) => s.id === 2);
  sucursal.lat = 17.9583; sucursal.lng = -92.9128;
  const cajero = { rol_id: 3, sucursal_id: 2 };
  const r = validarUbicacionLogin(cajero, 2, 17.9583, -92.9128, DB); // mismo punto exacto
  assert.deepStrictEqual(r, { ok: true });
});

test("validarUbicacionLogin: lat/lng no numéricos (basura) se tratan igual que ausentes -> sin_permiso_ubicacion", () => {
  const DB = construirDBPrueba();
  const sucursal = DB.pos.sucursales.find((s) => s.id === 2);
  sucursal.lat = 17.9583; sucursal.lng = -92.9128;
  const cajero = { rol_id: 3, sucursal_id: 2 };
  const r = validarUbicacionLogin(cajero, 2, "no-es-un-numero", "tampoco", DB);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "sin_permiso_ubicacion");
});
