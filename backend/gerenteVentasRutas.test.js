/**
 * gerenteVentasRutas.test.js — El CABLEADO de Gerencia de Ventas.
 *
 * Le pega a las rutas REALES vía require("./server"), igual que
 * respaldosRutas.test.js y rutasEscrituraSucursal.test.js.
 *
 * Lo que más importa aquí: que una vendedora NO pueda ver ni tocar el tablero
 * de otra. Es el mismo tipo de hueco que tuvo Apartados en julio (actuar sobre
 * el registro de alguien más pasando su id), y este módulo mide el desempeño de
 * personas — ver el de la compañera es información sensible entre ellas.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ⚠️ ANTES de requerir server.js, o la prueba ensucia la base real.
const DB_TEMPORAL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gventas-")), "datos.sqlite");
process.env.DB_PATH = DB_TEMPORAL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-pruebas";

const app = require("./server");
const { firmarToken } = require("./auth");
const { listarPermisos } = require("./permisosCatalogo");

// Tokens con la forma que emite el login DE VERDAD (sucursal_id numérica).
// Ver la lección de respaldosRutas.test.js: firmar tokens con una forma que el
// sistema no puede producir esconde bugs enteros.
const TOKEN_ADMIN = firmarToken({ id: 1, nombre: "Victor", rol_id: 1, sucursal_id: 1 });
const TOKEN_CAJERA = firmarToken({ id: 50, nombre: "Ana López", rol_id: 3, sucursal_id: 1 });

let servidor = null;
let base = "";

before(async () => {
  await new Promise((listo) => { servidor = app.listen(0, listo); });
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

test("los dos permisos nuevos están en el catálogo, en el módulo pos", () => {
  const permisos = listarPermisos();
  const usar = permisos.find((p) => p.clave === "usar_gerente_ventas");
  const editar = permisos.find((p) => p.clave === "editar_objetivos_venta");
  assert.ok(usar, "falta usar_gerente_ventas");
  assert.ok(editar, "falta editar_objetivos_venta");
  assert.strictEqual(usar.modulo, "pos");
  assert.strictEqual(editar.modulo, "pos");
});

test("sin sesión no se ve ningún tablero", async () => {
  assert.strictEqual((await pedir("/api/gerente-ventas/1")).status, 401);
});

// ---------- Preparación: se ligan dos cuentas a dos vendedores ----------

test("preparación: liga cuentas de prueba con vendedores", async () => {
  // Se hace por la ruta real de personal, no tocando el DB a mano: así también
  // se prueba que el campo vendedor_id viaja de verdad por la API.
  const ana = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Ana López", usuario: "ana.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 1, vendedor_id: 1,
    }),
  });
  assert.strictEqual(ana.status, 200, JSON.stringify(ana.cuerpo));
  assert.strictEqual(ana.cuerpo.vendedor_id, 1, "el campo debe persistir");

  const carlos = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Carlos Ruiz", usuario: "carlos.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 1, vendedor_id: 2,
    }),
  });
  assert.strictEqual(carlos.status, 200);

  // Los tokens de arriba usan ids fijos (50 y 51); se realinean a los reales.
  ANA_ID = ana.cuerpo.id;
  CARLOS_ID = carlos.cuerpo.id;
});

let ANA_ID = null;
let CARLOS_ID = null;
const tokenDe = (id, nombre) => firmarToken({ id, nombre, rol_id: 3, sucursal_id: 1 });

test("una cuenta ligada ve SU tablero", async () => {
  const r = await pedir("/api/gerente-ventas/1", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
  assert.strictEqual(r.cuerpo.vendedor_id, 1);
  assert.ok("vendido_mes" in r.cuerpo);
  assert.ok(Array.isArray(r.cuerpo.tareas));
});

test("una vendedora NO puede ver el tablero de otra", async () => {
  // El caso que importa: Ana pidiendo el tablero de Carlos por su id.
  const r = await pedir("/api/gerente-ventas/2", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.strictEqual(r.status, 404, "no debe poder ver el desempeño de su compañero");
  // 404 y no 403: tampoco se le confirma que ese tablero exista.
  assert.match(r.cuerpo.error, /no encontrado/i);
});

test("una cuenta SIN vendedor ligado no ve ningún tablero", async () => {
  // El administrador de este token (id 1) no está ligado a ningún vendedor.
  // Como tampoco tiene el permiso de jefatura en este escenario, no ve nada.
  const sinLigar = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Sin Vendedor", usuario: "sinvendedor.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 1,
    }),
  });
  assert.strictEqual(sinLigar.status, 200);
  assert.strictEqual(sinLigar.cuerpo.vendedor_id, null);

  const r = await pedir("/api/gerente-ventas/1", {
    headers: { Authorization: `Bearer ${tokenDe(sinLigar.cuerpo.id, "Sin Vendedor")}` },
  });
  assert.strictEqual(r.status, 404);
});

test("/mi/vendedor dice con qué vendedor está ligada mi cuenta", async () => {
  const r = await pedir("/api/gerente-ventas/mi/vendedor", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.cuerpo.vendedor_id, 1);
});

// ---------- Tareas ----------

test("una vendedora NO puede cerrar una tarea del tablero de otra", async () => {
  // OJO con el fixture: el sembrado genera tareas para ANA (vendedor 1) porque
  // sus clientes estan en riesgo; a Carlos (vendedor 2) no le genera ninguna.
  // La version anterior de esta prueba atacaba "la tarea 1 del tablero de
  // Carlos", que en realidad es de Ana, asi que nunca probo el ataque que su
  // nombre promete -- sobrevivia a quitar el guard solo por accidente.
  const tableroAna = await pedir("/api/gerente-ventas/1", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.strictEqual(tableroAna.status, 200);
  assert.ok(tableroAna.cuerpo.tareas.length > 0, "el fixture debe darle tareas reales a Ana");
  const tareaDeAna = tableroAna.cuerpo.tareas[0].id;

  // Carlos intenta cerrar una tarea REAL de Ana, por el tablero de ella.
  const r = await pedir(`/api/gerente-ventas/1/tareas/${tareaDeAna}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${tokenDe(CARLOS_ID, "Carlos Ruiz")}` },
    body: JSON.stringify({ estado: "hecha" }),
  });
  assert.strictEqual(r.status, 404);
  // El MENSAJE es lo que vale: sin el guard el status puede seguir siendo un
  // error por otra razon, y la prueba pasaria sin probar nada.
  assert.match(r.cuerpo.error, /tarea no encontrada/i);

  // Y la tarea sigue pendiente: el intento no la toco.
  const despues = await pedir("/api/gerente-ventas/1", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.ok(
    despues.cuerpo.tareas.some((t) => t.id === tareaDeAna),
    "la tarea de Ana debe seguir en su lista",
  );
});

// ---------- Metas: solo jefatura ----------

test("una cajera NO puede fijarse su propia meta", async () => {
  // Si pudiera, el objetivo dejaría de significar nada: se pondría la meta que
  // ya alcanzó. La medición la fija quien manda, no quien es medido.
  const r = await pedir("/api/gerente-ventas/1/meta", {
    method: "PUT",
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
    body: JSON.stringify({ meta: 1 }),
  });
  assert.strictEqual(r.status, 403);
});

test("el administrador SÍ puede fijar la meta de un vendedor", async () => {
  const r = await pedir("/api/gerente-ventas/1/meta", {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({ meta: 80000 }),
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
  assert.strictEqual(r.cuerpo.meta_mensual, 80000);
});

test("una meta inválida se rechaza con mensaje claro", async () => {
  const r = await pedir("/api/gerente-ventas/1/meta", {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({ meta: -5 }),
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.cuerpo.error, /mayor o igual a cero/);
});

test("la lista de jefatura trae a los vendedores con su progreso", async () => {
  const r = await pedir("/api/gerente-ventas", {
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.cuerpo));
  assert.ok(r.cuerpo.length > 0);
  assert.ok("meta" in r.cuerpo[0] && "vendido_mes" in r.cuerpo[0]);
});

test("una cajera no puede ver la lista de desempeño de todo el personal", async () => {
  const r = await pedir("/api/gerente-ventas", {
    headers: { Authorization: `Bearer ${tokenDe(ANA_ID, "Ana López")}` },
  });
  assert.strictEqual(r.status, 403);
});

// ---------- Cruce entre SUCURSALES ----------
//
// Ninguna de estas rutas tenía cobertura de la rama
// `if (!verTodas && vendedor.sucursal_id !== token.sucursal_id)`, que aparece
// tres veces en server.js. La revisión independiente verificó a mano que el
// código es correcto; esto lo deja amarrado para mañana.

// Rol 2 = "Gerente de sucursal": tiene editar_objetivos_venta pero NO
// ver_todas_las_sucursales. Amarrado a la sucursal 2 (Yajalón).
const TOKEN_GERENTE_S2 = firmarToken({ id: 60, nombre: "Gerente Yajalón", rol_id: 2, sucursal_id: 2 });

test("un gerente NO alcanza el tablero de un vendedor de otra sucursal", async () => {
  // El vendedor 1 (Ana López) es de Ocosingo; el gerente es de Yajalón.
  const r = await pedir("/api/gerente-ventas/1", {
    headers: { Authorization: `Bearer ${TOKEN_GERENTE_S2}` },
  });
  assert.strictEqual(r.status, 404);
});

test("un gerente SÍ alcanza el de su propia sucursal", async () => {
  // El vendedor 3 (María R.) es de Yajalón, la sucursal del gerente. Sin este
  // contraste, la prueba de arriba pasaría aunque el guard bloqueara a todos.
  const r = await pedir("/api/gerente-ventas/3", {
    headers: { Authorization: `Bearer ${TOKEN_GERENTE_S2}` },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.cuerpo));
  assert.strictEqual(r.cuerpo.vendedor_id, 3);
});

test("un gerente NO puede fijar la meta de otra sucursal, ni pedir su sugerencia", async () => {
  const meta = await pedir("/api/gerente-ventas/1/meta", {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN_GERENTE_S2}` },
    body: JSON.stringify({ meta: 1 }),
  });
  assert.strictEqual(meta.status, 404);

  const sug = await pedir("/api/gerente-ventas/1/sugerencia-meta", {
    headers: { Authorization: `Bearer ${TOKEN_GERENTE_S2}` },
  });
  assert.strictEqual(sug.status, 404);
});

test("el selector del encabezado NO ensancha ni encoge el alcance del gerente", async () => {
  // `apiFetch` inyecta ?sucursal_id= desde localStorage. La trampa que ya mordió
  // TRES veces en este repo: el alcance debe salir del token, no del query.
  const conQuery = async (q) => {
    const r = await pedir(`/api/gerente-ventas?sucursal_id=${q}`, {
      headers: { Authorization: `Bearer ${TOKEN_GERENTE_S2}` },
    });
    assert.strictEqual(r.status, 200);
    return r.cuerpo.map((v) => v.vendedor_id).sort();
  };
  const suyos = await conQuery("2");
  assert.deepStrictEqual(await conQuery("1"), suyos, "pedir otra sucursal no debe REGALAR alcance");
  assert.deepStrictEqual(await conQuery("todas"), suyos, "'todas' tampoco");
});

// ---------- El catálogo de vendedores no puede filtrar metas ----------

test("una cajera NO lee la meta de sus compañeras por /api/vendedores", async () => {
  // BUG CRITICAL encontrado por la revisión independiente: ponerle sesión a esta
  // ruta cerró "cualquiera en internet" pero NO "cualquier cajera de la cadena",
  // y con eso se rodeaba entero el guard que protege las metas. Bastaba abrir la
  // pestaña de Red del navegador en cualquier pantalla que la use.
  const r = await pedir("/api/vendedores", {
    headers: { Authorization: `Bearer ${TOKEN_CAJERA}` },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.cuerpo.length > 0, "el selector sí debe seguir funcionando");
  for (const v of r.cuerpo) {
    assert.ok(v.nombre, "el nombre sí se necesita para el selector");
    assert.strictEqual(
      v.meta_mensual, undefined,
      `la meta de ${v.nombre} no debe salir para una cajera`,
    );
  }
});

test("jefatura sí lee las metas, pero solo las de su alcance", async () => {
  const r = await pedir("/api/vendedores", {
    headers: { Authorization: `Bearer ${TOKEN_GERENTE_S2}` },
  });
  assert.strictEqual(r.status, 200);
  const conMeta = r.cuerpo.filter((v) => v.meta_mensual !== undefined);
  const sinMeta = r.cuerpo.filter((v) => v.meta_mensual === undefined);
  assert.ok(conMeta.length > 0, "de su sucursal sí ve las metas");
  assert.ok(sinMeta.length > 0, "de las demás no");
  assert.ok(
    conMeta.every((v) => Number(v.sucursal_id) === 2),
    "solo las de su propia sucursal",
  );
});

test("el administrador ve todas las metas", async () => {
  const r = await pedir("/api/vendedores", {
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.cuerpo.every((v) => v.meta_mensual !== undefined));
});

// ---------- La liga cuenta ↔ vendedor se valida ----------

test("no se puede ligar una cuenta a un vendedor que no existe", async () => {
  // Dejaba la pantalla EN BLANCO, sin aviso: el componente cree que la cuenta
  // está ligada, el tablero nunca carga y no se renderiza nada.
  const r = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Fantasma", usuario: "fantasma.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 1, vendedor_id: 999,
    }),
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.cuerpo.error, /no existe/i);
});

test("no se puede ligar una cuenta a un vendedor de OTRA sucursal", async () => {
  // Una cuenta de Palenque viendo el tablero de una vendedora de Ocosingo es
  // exactamente lo que el módulo existe para impedir.
  const r = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Cruzada", usuario: "cruzada.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 4, vendedor_id: 1, // vendedor 1 es de la sucursal 1
    }),
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.cuerpo.error, /otra sucursal/i);
});

test("dos cuentas NO pueden quedar ligadas al mismo vendedor", async () => {
  // Sin esto, la segunda persona ve la meta, el avance y los clientes de la
  // primera, y puede cerrar sus tareas: el aislamiento del módulo roto por un
  // error de captura del administrador, y sin ningún aviso.
  const r = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Suplantador", usuario: "suplantador.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 1, vendedor_id: 1, // el vendedor 1 ya es de Ana
    }),
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.cuerpo.error, /ya está ligada/i);
});

test("la meta NO sale por el Asistente de IA", async () => {
  // El arreglo de /api/vendedores cerró esa puerta, pero pos.vendedores seguía
  // siendo consultable CRUDA por la herramienta del asistente, y el rol Cajero
  // tiene usar_asistente_ia: bastaba pedirle "dame la tabla vendedores".
  const { consultarModulo } = require("./consultarModulo");
  const DB = {
    pos: { vendedores: [{ id: 1, nombre: "Ana", sucursal_id: 1, meta_mensual: 50000 }] },
  };
  for (const alcance of [{ verTodas: false, sucursalId: 1 }, { verTodas: true }]) {
    const filas = consultarModulo({ modulo: "pos", tabla: "vendedores" }, alcance, DB);
    assert.ok(filas.length > 0, "el catálogo sí se sigue pudiendo consultar");
    for (const f of filas) {
      assert.strictEqual(f.meta_mensual, undefined, "la meta no debe salir por aquí para nadie");
      assert.ok(f.nombre, "el nombre sí, es lo que el asistente necesita");
    }
  }
});

test("tareas_venta no rompe la herramienta del asistente", async () => {
  const { consultarModulo } = require("./consultarModulo");
  const DB = { pos: { tareas_venta: { tareas: [], ultimo_id: 0 }, ventas: [] } };
  assert.throws(
    () => consultarModulo({ modulo: "pos", tabla: "tareas_venta" }, { verTodas: true }, DB),
    /no existe/i,
    "debe rechazarse limpio, no reventar con 'datos is not iterable'",
  );
  // Y no debe anunciarse como disponible, o el modelo la intentará una y otra vez.
  try {
    consultarModulo({ modulo: "pos", tabla: "inventada" }, { verTodas: true }, DB);
  } catch (e) {
    assert.ok(!e.message.includes("tareas_venta"), "no debe aparecer en 'Disponibles'");
  }
});

// ---------- El campo `activo` y sus consumidores ----------
//
// El catálogo de vendedores introdujo `activo`. Ninguno de los consumidores
// viejos de DB.pos.vendedores lo conocía, y el Punto de Venta llegó a filtrar
// por un campo que la ruta no devolvía: comparaba contra `undefined` y no
// filtraba nada.

test("/api/vendedores devuelve `activo` también en la vista recortada de una cajera", async () => {
  // Sin este campo, el filtro del Punto de Venta es letra muerta y la caja
  // sigue ofreciendo a alguien que ya no trabaja aquí.
  const r = await pedir("/api/vendedores", { headers: { Authorization: `Bearer ${TOKEN_CAJERA}` } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.cuerpo.length > 0);
  for (const v of r.cuerpo) {
    assert.strictEqual(typeof v.activo, "boolean", `${v.nombre} viene sin activo`);
    assert.strictEqual(v.meta_mensual, undefined, "una cajera no ve metas");
  }
});

test("/api/vendedores NO esconde a los desactivados: Reportes necesita consultarlos", async () => {
  // La caja los filtra por su cuenta. Filtrarlos aquí dejaría a Victor sin
  // poder consultar las ventas de quien ya se fue.
  const alta = await pedir("/api/vendedores", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({ nombre: "Temporal Navidad", sucursal_id: 1 }),
  });
  assert.strictEqual(alta.status, 200, JSON.stringify(alta.cuerpo));

  const baja = await pedir(`/api/vendedores/${alta.cuerpo.id}/desactivar`, {
    method: "PUT", headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
  });
  assert.strictEqual(baja.status, 200, JSON.stringify(baja.cuerpo));

  const lista = await pedir("/api/vendedores", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });
  const temporal = lista.cuerpo.find((v) => v.id === alta.cuerpo.id);
  assert.ok(temporal, "el desactivado debe seguir saliendo en el catálogo compartido");
  assert.strictEqual(temporal.activo, false, "pero marcado como inactivo");
});

test("el tablero de jefatura no lista a los desactivados", async () => {
  // Un renglón con meta y avance de alguien que ya se fue ensucia el promedio
  // del equipo y no se puede accionar.
  const alta = await pedir("/api/vendedores", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({ nombre: "Se Fue En Marzo", sucursal_id: 1, meta_mensual: 30000 }),
  });
  const id = alta.cuerpo.id;

  const conEl = await pedir("/api/gerente-ventas", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });
  assert.ok(conEl.cuerpo.some((v) => v.vendedor_id === id), "activo sí debe salir");

  await pedir(`/api/vendedores/${id}/desactivar`, {
    method: "PUT", headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
  });

  const sinEl = await pedir("/api/gerente-ventas", { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } });
  assert.ok(!sinEl.cuerpo.some((v) => v.vendedor_id === id), "desactivado NO debe salir");
});

test("no se puede ligar una cuenta a un vendedor desactivado", async () => {
  // Sería un estado sin salida: el vendedor queda inactivo con cuenta viva y
  // tablero funcional, y `desactivarVendedor` ya no lo puede tocar porque
  // rechaza mientras haya cuenta ligada.
  const alta = await pedir("/api/vendedores", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({ nombre: "Ya No Trabaja Aqui", sucursal_id: 1 }),
  });
  await pedir(`/api/vendedores/${alta.cuerpo.id}/desactivar`, {
    method: "PUT", headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
  });

  const intento = await pedir("/api/usuarios", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify({
      nombre: "Fantasma", usuario: "fantasma.prueba", password: "secreto123",
      rol_id: 3, sucursal_id: 1, vendedor_id: alta.cuerpo.id,
    }),
  });
  assert.notStrictEqual(intento.status, 200, "debe rechazarse");
  assert.match(intento.cuerpo.error, /desactivado/i);
});
