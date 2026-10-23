const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  asegurarCarpetaRaiz, asegurarCarpetaGastosSucursal, asegurarCarpetaRespaldos, asegurarCarpetaGarantia, asegurarCarpetaCorporativo,
} = require("./drive");

// Una carpeta guardada puede dejar de servir: alguien la manda a la papelera, o Victor reconecta Drive
// con otra cuenta (que no la ve). Subir a una carpeta en la papelera NO da error: el comprobante se va a
// la papelera y Google lo borra a los 30 días. Por eso se pregunta a Drive antes de usarla.

function cuentaVigente() {
  return { access_token: "AT1", refresh_token: "RT1", expires_at: Date.now() + 3_600_000 };
}

// Drive falso: `carpetas` es { id: { trashed } }; las que no están responden 404. Registra cada llamada.
function driveFalso(t, carpetas, { encontrada = null, errorRevision = null } = {}) {
  const llamadas = [];
  let creadas = 0;
  t.mock.method(globalThis, "fetch", async (url, opciones = {}) => {
    const u = String(url);
    if (opciones.method === "POST") {
      creadas++;
      llamadas.push("crear");
      return { ok: true, json: async () => ({ id: `nueva-${creadas}` }) };
    }
    if (u.includes("q=")) {
      llamadas.push("buscar");
      return { ok: true, json: async () => ({ files: encontrada ? [{ id: encontrada }] : [] }) };
    }
    const id = decodeURIComponent(u.split("/files/")[1].split("?")[0]);
    llamadas.push("revisar " + id);
    if (errorRevision) return { ok: false, status: errorRevision, text: async () => "falla de Drive" };
    if (!carpetas[id]) return { ok: false, status: 404, text: async () => "File not found" };
    return { ok: true, status: 200, json: async () => ({ id, trashed: carpetas[id].trashed }) };
  });
  return llamadas;
}

test("una carpeta guardada que sigue viva se usa tal cual, con una sola revisión", async (t) => {
  const llamadas = driveFalso(t, { "raiz-1": { trashed: false } });
  const DB = { drive: { cuenta: cuentaVigente(), carpeta_raiz_id: "raiz-1" } };
  assert.equal(await asegurarCarpetaRaiz(DB), "raiz-1");
  assert.deepEqual(llamadas, ["revisar raiz-1"]);
});

test("una carpeta guardada que ya no existe (otra cuenta o borrada) se vuelve a buscar por nombre", async (t) => {
  const llamadas = driveFalso(t, {}, { encontrada: "raiz-encontrada" });
  const DB = { drive: { cuenta: cuentaVigente(), carpeta_raiz_id: "raiz-vieja" } };
  assert.equal(await asegurarCarpetaRaiz(DB), "raiz-encontrada");
  assert.equal(DB.drive.carpeta_raiz_id, "raiz-encontrada");
  assert.deepEqual(llamadas, ["revisar raiz-vieja", "buscar"]);
});

test("una carpeta guardada en la papelera no se usa: se busca otra y si no hay se crea", async (t) => {
  const llamadas = driveFalso(t, { "raiz-1": { trashed: true } });
  const DB = { drive: { cuenta: cuentaVigente(), carpeta_raiz_id: "raiz-1" } };
  assert.equal(await asegurarCarpetaRaiz(DB), "nueva-1");
  assert.equal(DB.drive.carpeta_raiz_id, "nueva-1");
  assert.deepEqual(llamadas, ["revisar raiz-1", "buscar", "crear"]);
});

test("si Drive falla al revisar (no es 'no existe'), se detiene sin crear nada ni cambiar lo guardado", async (t) => {
  for (const status of [500, 403, 401]) {
    const llamadas = driveFalso(t, {}, { errorRevision: status });
    const DB = { drive: { cuenta: cuentaVigente(), carpeta_raiz_id: "raiz-1" } };
    await assert.rejects(() => asegurarCarpetaRaiz(DB), /Google Drive/);
    assert.equal(DB.drive.carpeta_raiz_id, "raiz-1");
    assert.deepEqual(llamadas, ["revisar raiz-1"]);
    t.mock.restoreAll();
  }
});

test("subcarpeta de sucursal en la papelera junto con su raíz: se rehacen las dos", async (t) => {
  const llamadas = driveFalso(t, { "gastos-raiz": { trashed: true }, "gastos-oco": { trashed: true } });
  const DB = { drive: { cuenta: cuentaVigente(), carpeta_gastos_id: "gastos-raiz" } };
  const sucursal = { id: 1, nombre: "Ocosingo", drive_folder_gastos_id: "gastos-oco" };
  const id = await asegurarCarpetaGastosSucursal(DB, sucursal);
  assert.equal(DB.drive.carpeta_gastos_id, "nueva-1");
  assert.equal(id, "nueva-2");
  assert.equal(sucursal.drive_folder_gastos_id, "nueva-2");
  assert.deepEqual(llamadas, ["revisar gastos-oco", "revisar gastos-raiz", "buscar", "crear", "buscar", "crear"]);
});

test("subcarpeta viva: no revisa ni toca la raíz", async (t) => {
  const llamadas = driveFalso(t, { "gastos-oco": { trashed: false } });
  const DB = { drive: { cuenta: cuentaVigente(), carpeta_gastos_id: "raiz-que-ya-no-existe" } };
  const sucursal = { id: 1, nombre: "Ocosingo", drive_folder_gastos_id: "gastos-oco" };
  assert.equal(await asegurarCarpetaGastosSucursal(DB, sucursal), "gastos-oco");
  assert.deepEqual(llamadas, ["revisar gastos-oco"]);
});

test("carpeta de garantía que ya no existe se vuelve a buscar dentro de su raíz", async (t) => {
  const llamadas = driveFalso(t, { "garantias-raiz": { trashed: false } }, { encontrada: "G-0001-id" });
  const DB = { drive: { cuenta: cuentaVigente(), carpeta_garantias_id: "garantias-raiz" } };
  const garantia = { id: 1, folio: "G-0001", drive_folder_id: "borrada" };
  assert.equal(await asegurarCarpetaGarantia(DB, garantia), "G-0001-id");
  assert.equal(garantia.drive_folder_id, "G-0001-id");
  assert.deepEqual(llamadas, ["revisar borrada", "revisar garantias-raiz", "buscar"]);
});

test("la carpeta de respaldos también se revisa: si no existe se rehace", async (t) => {
  const llamadas = driveFalso(t, {});
  const DB = { drive: { cuenta: cuentaVigente() }, respaldos: { carpeta_drive_id: "respaldos-vieja" } };
  assert.equal(await asegurarCarpetaRespaldos(DB), "nueva-1");
  assert.equal(DB.respaldos.carpeta_drive_id, "nueva-1");
  assert.deepEqual(llamadas, ["revisar respaldos-vieja", "buscar", "crear"]);
});

test("carpeta Corporativo: se crea dentro de Evidencias de Actividades y se guarda aparte de las de empleados", async (t) => {
  const llamadas = driveFalso(t, {});
  const DB = { drive: { cuenta: cuentaVigente() } };
  const id = await asegurarCarpetaCorporativo(DB);
  assert.equal(DB.drive.carpeta_actividades_id, "nueva-1");
  assert.equal(DB.drive.carpeta_corporativo_id, "nueva-2");
  assert.equal(id, "nueva-2");
  assert.deepEqual(llamadas, ["buscar", "crear", "buscar", "crear"]);
});
