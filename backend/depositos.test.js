const { test } = require("node:test");
const assert = require("node:assert");
const { crearDeposito, cancelarDeposito, listarDepositos, adjuntarComprobante } = require("./depositos");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const driveFalso = {
  asegurarCarpetaDepositosSucursal: async () => "carpeta-1",
  subirArchivoADrive: async () => ({ id: "file-1", webViewLink: "https://drive/file-1" }),
};

function nuevoDB() {
  return {
    pos: { sucursales: [{ id: 1, nombre: "Ocosingo" }, { id: 2, nombre: "Yajalón" }] },
    cuenta_comun: { depositos: [], deposito_movimientos: [], ultimo_id: 0 },
  };
}

test("crearDeposito exige monto > 0", async () => {
  await assert.rejects(() => crearDeposito(nuevoDB(), { monto: 0, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso), /mayor que cero/);
});

test("crearDeposito usa la sucursal del token, no del body", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 5000, forma_pago: "EFECTIVO", sucursal_id: 999 }, 1, { nombre: "Ana" }, driveFalso);
  assert.strictEqual(d.sucursal_id, 1);
  assert.strictEqual(d.folio, "DEP-0001");
  assert.strictEqual(d.estatus, "activo");
});

test("crearDeposito sin comprobante queda registrado sin bloquear", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 1000, forma_pago: "TRANSFERENCIA" }, 1, { nombre: "Ana" }, driveFalso);
  assert.strictEqual(d.drive_link, null);
  assert.strictEqual(DB.cuenta_comun.depositos.length, 1);
});

test("crearDeposito con comprobante adjunta el link de Drive", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, {
    monto: 1000, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "ficha.jpg" },
  }, 1, { nombre: "Ana" }, driveFalso);
  assert.strictEqual(d.drive_link, "https://drive/file-1");
});

test("si Drive falla, el depósito igual queda registrado (comprobante opcional)", async () => {
  const DB = nuevoDB();
  const driveCaido = { asegurarCarpetaDepositosSucursal: async () => { throw new Error("Drive caído"); }, subirArchivoADrive: async () => ({}) };
  const d = await crearDeposito(DB, {
    monto: 1000, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "f.jpg" },
  }, 1, { nombre: "Ana" }, driveCaido);
  assert.strictEqual(d.drive_link, null, "sin comprobante, pero el depósito existe");
  assert.strictEqual(DB.cuenta_comun.depositos.length, 1);
});

test("crearDeposito rechaza un archivo con MIME inválido y NO crea nada", async () => {
  const DB = nuevoDB();
  await assert.rejects(() => crearDeposito(DB, {
    monto: 100, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "text/plain", nombre_archivo: "x.txt" },
  }, 1, { nombre: "Ana" }, driveFalso), /permitido/);
  assert.strictEqual(DB.cuenta_comun.depositos.length, 0, "no debe crear el depósito");
});

test("crearDeposito rechaza un archivo mayor a 10 MB y NO crea nada", async () => {
  const DB = nuevoDB();
  await assert.rejects(() => crearDeposito(DB, {
    monto: 100, forma_pago: "EFECTIVO",
    archivo: { contenido_base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "grande.jpg" },
  }, 1, { nombre: "Ana" }, driveFalso), /10 MB/);
  assert.strictEqual(DB.cuenta_comun.depositos.length, 0, "no debe crear el depósito");
});

test("folios únicos bajo capturas concurrentes (id síncrono)", async () => {
  const DB = nuevoDB();
  // Con archivo + subida async que en verdad cede el control (setTimeout), las
  // 12 capturas se intercalan de verdad en el `await` de Drive: si la reserva
  // de folio no fuera síncrona, aquí colisionarían.
  const driveLento = {
    asegurarCarpetaDepositosSucursal: async () => "c1",
    subirArchivoADrive: async () => { await new Promise((r) => setTimeout(r, 0)); return { id: "f", webViewLink: "https://drive/f" }; },
  };
  const ds = await Promise.all(Array.from({ length: 12 }, () =>
    crearDeposito(DB, {
      monto: 100, forma_pago: "EFECTIVO",
      archivo: { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "f.jpg" },
    }, 1, { nombre: "Ana" }, driveLento)));
  const folios = new Set(ds.map((d) => d.folio));
  assert.strictEqual(folios.size, 12, "12 folios distintos");
});

test("cancelarDeposito no borra, exige motivo, y respeta el alcance", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 100, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso);
  assert.throws(() => cancelarDeposito(DB, d.id, "  ", { nombre: "Ana" }, ALCANCE_TODAS), /motivo/);
  // una cajera de la sucursal 2 no puede cancelar un depósito de la 1
  const alcanceS2 = { verTodas: false, sucursalId: 2 };
  assert.throws(() => cancelarDeposito(DB, d.id, "error", { nombre: "Otra" }, alcanceS2), /no encontrado/);
  const c = cancelarDeposito(DB, d.id, "duplicado", { nombre: "Ana" }, ALCANCE_TODAS);
  assert.strictEqual(c.estatus, "cancelado");
});

// ---------- Adjuntar el comprobante a un depósito ya capturado ----------

const FICHA = { contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "ficha.jpg" };

/** Depósito activo SIN comprobante, que es el caso que esta operación resuelve. */
async function depositoSinFicha(DB, sucursalId = 1) {
  return crearDeposito(DB, { monto: 500, forma_pago: "EFECTIVO" }, sucursalId, { nombre: "Ana" }, driveFalso);
}

test("adjuntarComprobante sube la ficha a un depósito activo que no tenía", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  assert.strictEqual(d.drive_link, null);
  const actualizado = await adjuntarComprobante(DB, d.id, FICHA, { nombre: "Ana" }, ALCANCE_TODAS, driveFalso);
  assert.strictEqual(actualizado.drive_link, "https://drive/file-1");
  assert.strictEqual(actualizado.drive_file_id, "file-1");
  assert.strictEqual(actualizado.nombre_archivo, "ficha.jpg");
  assert.strictEqual(actualizado.estatus, "activo", "adjuntar no cambia el estatus");
});

test("adjuntarComprobante deja en la bitácora quién adjuntó", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  await adjuntarComprobante(DB, d.id, FICHA, { nombre: "Beto" }, ALCANCE_TODAS, driveFalso);
  const movs = DB.cuenta_comun.deposito_movimientos.filter((m) => m.deposito_id === d.id);
  const adjunto = movs.find((m) => m.tipo === "comprobante");
  assert.ok(adjunto, "debe existir un movimiento tipo comprobante");
  assert.strictEqual(adjunto.usuario, "Beto");
  assert.match(adjunto.descripcion, /ficha\.jpg/);
});

test("adjuntarComprobante NO reemplaza un comprobante que ya existe", async () => {
  const DB = nuevoDB();
  const d = await crearDeposito(DB, { monto: 500, forma_pago: "EFECTIVO", archivo: FICHA }, 1, { nombre: "Ana" }, driveFalso);
  const driveOtro = {
    asegurarCarpetaDepositosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async () => ({ id: "file-2", webViewLink: "https://drive/file-2" }),
  };
  await assert.rejects(
    () => adjuntarComprobante(DB, d.id, FICHA, { nombre: "Ana" }, ALCANCE_TODAS, driveOtro),
    /ya tiene comprobante/
  );
  assert.strictEqual(d.drive_file_id, "file-1", "conserva la evidencia original");
});

test("adjuntarComprobante rechaza un depósito cancelado", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  cancelarDeposito(DB, d.id, "duplicado", { nombre: "Ana" }, ALCANCE_TODAS);
  await assert.rejects(
    () => adjuntarComprobante(DB, d.id, FICHA, { nombre: "Ana" }, ALCANCE_TODAS, driveFalso),
    /cancelado/
  );
  assert.strictEqual(d.drive_link, null);
});

test("adjuntarComprobante exige un archivo", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  await assert.rejects(() => adjuntarComprobante(DB, d.id, undefined, { nombre: "Ana" }, ALCANCE_TODAS, driveFalso), /Adjunta la ficha/);
});

test("adjuntarComprobante rechaza MIME inválido y NO toca el depósito ni sube nada", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  let subidas = 0;
  const driveEspia = {
    asegurarCarpetaDepositosSucursal: async () => "carpeta-1",
    subirArchivoADrive: async () => { subidas++; return { id: "f", webViewLink: "https://drive/f" }; },
  };
  await assert.rejects(() => adjuntarComprobante(DB, d.id, {
    contenido_base64: Buffer.from("x").toString("base64"), tipo_mime: "text/plain", nombre_archivo: "x.txt",
  }, { nombre: "Ana" }, ALCANCE_TODAS, driveEspia), /permitido/);
  assert.strictEqual(subidas, 0, "la validación es previa a Drive");
  assert.strictEqual(d.drive_link, null);
  assert.strictEqual(DB.cuenta_comun.deposito_movimientos.filter((m) => m.tipo === "comprobante").length, 0);
});

test("adjuntarComprobante rechaza un archivo mayor a 10 MB", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  await assert.rejects(() => adjuntarComprobante(DB, d.id, {
    contenido_base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"), tipo_mime: "image/jpeg", nombre_archivo: "grande.jpg",
  }, { nombre: "Ana" }, ALCANCE_TODAS, driveFalso), /10 MB/);
  assert.strictEqual(d.drive_link, null);
});

test("adjuntarComprobante respeta el alcance: otra sucursal no ve el depósito", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB, 1);
  const alcanceS2 = { verTodas: false, sucursalId: 2 };
  await assert.rejects(
    () => adjuntarComprobante(DB, d.id, FICHA, { nombre: "Otra" }, alcanceS2, driveFalso),
    /no encontrado/
  );
  assert.strictEqual(d.drive_link, null);
  // y la propia sucursal sí puede
  const ok = await adjuntarComprobante(DB, d.id, FICHA, { nombre: "Ana" }, { verTodas: false, sucursalId: 1 }, driveFalso);
  assert.strictEqual(ok.drive_link, "https://drive/file-1");
});

test("si Drive falla al adjuntar, el depósito queda intacto y el error se propaga", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  const driveCaido = {
    asegurarCarpetaDepositosSucursal: async () => { throw new Error("Drive caído"); },
    subirArchivoADrive: async () => ({}),
  };
  await assert.rejects(() => adjuntarComprobante(DB, d.id, FICHA, { nombre: "Ana" }, ALCANCE_TODAS, driveCaido), /Drive caído/);
  assert.strictEqual(d.drive_link, null, "no se marca como respaldado si no se subió");
  assert.strictEqual(DB.cuenta_comun.deposito_movimientos.filter((m) => m.tipo === "comprobante").length, 0);
  // Y tras la falla se puede reintentar: la marca de "subida en curso" se limpió.
  const ok = await adjuntarComprobante(DB, d.id, FICHA, { nombre: "Ana" }, ALCANCE_TODAS, driveFalso);
  assert.strictEqual(ok.drive_link, "https://drive/file-1");
});

test("si Drive no confirma la subida, no se marca comprobante", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  const driveMudo = { asegurarCarpetaDepositosSucursal: async () => "c1", subirArchivoADrive: async () => ({}) };
  await assert.rejects(() => adjuntarComprobante(DB, d.id, FICHA, { nombre: "Ana" }, ALCANCE_TODAS, driveMudo), /no confirmó/);
  assert.strictEqual(d.drive_link, null);
});

test("dos adjuntos simultáneos al mismo depósito: solo uno gana, sin reemplazo", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  // Drive que cede el control de verdad: sin la marca síncrona previa al await,
  // las dos llamadas pasarían el chequeo de "ya tiene comprobante" y la segunda
  // pisaría el enlace de la primera.
  let n = 0;
  const driveLento = {
    asegurarCarpetaDepositosSucursal: async () => "c1",
    subirArchivoADrive: async () => { await new Promise((r) => setTimeout(r, 0)); n++; return { id: `file-${n}`, webViewLink: `https://drive/file-${n}` }; },
  };
  const res = await Promise.allSettled([
    adjuntarComprobante(DB, d.id, FICHA, { nombre: "Ana" }, ALCANCE_TODAS, driveLento),
    adjuntarComprobante(DB, d.id, FICHA, { nombre: "Beto" }, ALCANCE_TODAS, driveLento),
  ]);
  assert.strictEqual(res.filter((r) => r.status === "fulfilled").length, 1);
  assert.strictEqual(res.filter((r) => r.status === "rejected").length, 1);
  assert.strictEqual(n, 1, "solo se sube un archivo a Drive");
  assert.strictEqual(DB.cuenta_comun.deposito_movimientos.filter((m) => m.tipo === "comprobante").length, 1);
});

test("adjuntar mientras la captura sube su propia ficha NO reemplaza la evidencia", async () => {
  // Caso real: la cajera captura con una ficha pesada y el enlace de la tienda
  // es lento. Durante esos segundos el depósito ya sale en la lista con
  // drive_link null, así que la pantalla le pinta el clip y la administradora
  // le adjunta otra. Sin la marca en crearDeposito, las dos subidas corren
  // ciegas: el registro apunta a una ficha y la bitácora nombra la otra.
  const DB = nuevoDB();
  let subidas = 0;
  const driveLento = {
    asegurarCarpetaDepositosSucursal: async () => "c1",
    subirArchivoADrive: async () => {
      await new Promise((r) => setTimeout(r, 0));
      subidas++;
      return { id: `file-${subidas}`, webViewLink: `https://drive/file-${subidas}` };
    },
  };
  const captura = crearDeposito(
    DB, { monto: 500, forma_pago: "EFECTIVO", archivo: { ...FICHA, nombre_archivo: "de-captura.jpg" } },
    1, { nombre: "Ana" }, driveLento
  );
  // El depósito ya está en la lista (push síncrono) antes de que Drive termine.
  const visible = DB.cuenta_comun.depositos[0];
  assert.strictEqual(visible.drive_link, null, "durante la subida se ve sin ficha: la UI ofrece el clip");

  const porElClip = adjuntarComprobante(
    DB, visible.id, { ...FICHA, nombre_archivo: "del-clip.jpg" }, { nombre: "Beto" }, ALCANCE_TODAS, driveLento
  );
  await assert.rejects(() => porElClip, /ya se está subiendo|ya tiene comprobante/i);
  const d = await captura;

  assert.strictEqual(d.nombre_archivo, "de-captura.jpg", "gana la ficha de la captura");
  assert.strictEqual(subidas, 1, "no se sube un segundo archivo a Drive");
  const nombrados = DB.cuenta_comun.deposito_movimientos.filter((m) => m.tipo === "comprobante");
  assert.strictEqual(nombrados.length, 0, "la bitácora no nombra una ficha que no quedó pegada");
});

test("cancelar durante la subida: el comprobante NO se pega a un depósito cancelado", async () => {
  const DB = nuevoDB();
  const d = await depositoSinFicha(DB);
  const driveLento = {
    asegurarCarpetaDepositosSucursal: async () => "c1",
    subirArchivoADrive: async () => {
      // La cancelación entra con la subida en vuelo.
      cancelarDeposito(DB, d.id, "capturado por error", { nombre: "Ana" }, ALCANCE_TODAS);
      return { id: "file-9", webViewLink: "https://drive/file-9" };
    },
  };
  await assert.rejects(
    () => adjuntarComprobante(DB, d.id, FICHA, { nombre: "Beto" }, ALCANCE_TODAS, driveLento),
    /cancelado/
  );
  assert.strictEqual(d.drive_file_id, null, "un depósito cancelado no queda con comprobante");
  assert.strictEqual(DB.cuenta_comun.deposito_movimientos.filter((m) => m.tipo === "comprobante").length, 0);
});

test("listarDepositos respeta el alcance de sucursal", async () => {
  const DB = nuevoDB();
  await crearDeposito(DB, { monto: 100, forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }, driveFalso);
  await crearDeposito(DB, { monto: 200, forma_pago: "EFECTIVO" }, 2, { nombre: "Beto" }, driveFalso);
  const soloS1 = listarDepositos(DB, {}, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(soloS1.length, 1);
  assert.strictEqual(soloS1[0].sucursal_id, 1);
});
