/**
 * rutasEscrituraSucursal.test.js — El CABLEADO de las rutas, no la lógica.
 *
 * escrituraSucursal.test.js prueba muy bien sucursalDeEscritura(), pero lo hace
 * reproduciendo a mano lo que hace una ruta. Eso no puede detectar la falla más
 * probable de este cambio: que a UNA de las rutas se le olvide su
 * `if (!sucursal_id) return 400`. Los módulos (crearVenta, crearCorte...) casi
 * siempre atrapan el null y también responden 400, así que mirando solo el
 * código de estado nadie se enteraría — pero el usuario recibiría un mensaje
 * técnico ("Falta la sucursal donde se cierra la venta") en vez del mensaje que
 * le dice qué hacer ("Elige una sucursal en el encabezado...").
 *
 * Por eso aquí se levanta la app REAL en un puerto efímero y se le pega a las
 * doce rutas como administrador con el encabezado en "Todas", afirmando el 400
 * Y que el mensaje sea el de "Elige...". Y una prueba extra cuenta los usos de
 * sucursalDeEscritura en server.js para que una ruta nueva no pueda entrar sin
 * pasar por aquí.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// OJO: esto va ANTES de requerir server.js.
// - DB_PATH a un archivo desechable: requerir server.js abre SQLite y restaura
//   el estado guardado. Sin esto, la prueba leería (y podría ensuciar) la base
//   real datos.sqlite del desarrollador.
// - JWT_SECRET fijo: no es imprescindible (auth.js genera una clave aleatoria
//   por proceso y aquí firmamos en ese mismo proceso), pero deja la prueba
//   explícita en vez de depender de un detalle interno.
const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-prueba-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-solo-para-pruebas";

const app = require("./server");
const { firmarToken } = require("./auth");

// Rol 1 = "Administrador" (sembrarRolesIniciales en backend/roles.js): tiene
// TODOS los permisos, incluido ver_todas_las_sucursales. Es justo el usuario
// que entra con el encabezado en "Todas" y al que este cambio protege.
const TOKEN_ADMIN = firmarToken({ id: 1, nombre: "Administrador de prueba", rol_id: 1, sucursal_id: 1 });

let servidor = null;
let base = "";

before(async () => {
  await new Promise((listo) => {
    servidor = app.listen(0, listo); // puerto efímero: no choca con el backend de desarrollo
  });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  try { fs.unlinkSync(BASE_DESECHABLE); } catch { /* ya no estaba: da igual */ }
});

/**
 * Las doce rutas que resuelven a QUÉ sucursal escriben con sucursalDeEscritura.
 * `pista` es un pedazo del mensaje propio de cada ruta: sirve para que un
 * copy/paste no deje dos rutas con el mensaje de la otra.
 */
const RUTAS = [
  { metodo: "POST", ruta: "/api/productos",           body: { descripcion: "Bocina de prueba" },                     pista: /dar de alta un producto/ },
  { metodo: "PUT",  ruta: "/api/productos/1",         body: { descripcion: "Arroz 1kg (renombrado)" },               pista: /editar un producto/ },
  { metodo: "POST", ruta: "/api/productos/1/clonar",  body: {},                                                      pista: /clonar un producto/ },
  { metodo: "POST", ruta: "/api/productos/1/ajustar", body: { cantidad: -5, motivo: "prueba" },                      pista: /ajustar la existencia/ },
  { metodo: "POST", ruta: "/api/traspasos",           body: { producto_id: 1, cantidad: 1, sucursal_destino_id: 2 }, pista: /sale la mercancía/ },
  { metodo: "POST", ruta: "/api/compras",             body: { proveedor_id: 1, renglones: [] },                      pista: /recibe la mercancía/ },
  { metodo: "POST", ruta: "/api/clientes",            body: { nombre: "Juan Pérez" },                                pista: /sucursal del cliente/ },
  { metodo: "POST", ruta: "/api/ventas",              body: { cliente_id: 0, lineas: [] },                           pista: /para poder vender/ },
  { metodo: "POST", ruta: "/api/apartados",           body: { cliente_id: 1, anticipo_monto: 50 },                   pista: /crear un apartado/ },
  { metodo: "POST", ruta: "/api/garantias",           body: { producto_id: 1 },                                      pista: /origen de la garantía/ },
  { metodo: "GET",  ruta: "/api/cortes/en-curso",     body: null,                                                    pista: /ver el corte/ },
  { metodo: "POST", ruta: "/api/cortes",              body: { contado: { EFECTIVO: 100 }, retiro: {} },              pista: /guardar el corte/ },
];

/** Le pega a una ruta como administrador. `query` vacío = encabezado en "Todas". */
function pegar({ metodo, ruta, body }, query = "") {
  const opciones = { method: metodo, headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } };
  if (body) {
    opciones.headers["Content-Type"] = "application/json";
    opciones.body = JSON.stringify(body);
  }
  return fetch(`${base}${ruta}${query}`, opciones);
}

test("las doce rutas responden 400 (y con el mensaje de 'Elige...') cuando el administrador tiene el encabezado en 'Todas'", async () => {
  for (const caso of RUTAS) {
    const etiqueta = `${caso.metodo} ${caso.ruta}`;
    const respuesta = await pegar(caso);
    const datos = await respuesta.json();

    assert.strictEqual(
      respuesta.status, 400,
      `${etiqueta} debe rechazar la escritura sin sucursal, no guardar nada (respondió ${respuesta.status})`
    );
    // Este assert es el que de verdad cuida el `if (!sucursal_id)` de la ruta:
    // sin él, el módulo lanza y también sale un 400, pero con un mensaje
    // técnico que empieza con "Falta..." / "Selecciona..." en vez de "Elige...".
    assert.match(
      datos.error, /^Elige /,
      `${etiqueta} perdió su guarda: el 400 viene del módulo, no de la ruta, así que el usuario no lee qué hacer — decía: ${JSON.stringify(datos.error)}`
    );
    assert.match(datos.error, caso.pista, `${etiqueta} no está devolviendo su propio mensaje`);
  }
});

test("con una sucursal elegida en el encabezado, ninguna de las doce vuelve a pedir que se elija", async () => {
  // Control: sin esto, las doce podrían estar respondiendo 400 por otro motivo
  // (permiso faltante, ruta mal escrita) y la prueba de arriba pasaría igual.
  for (const caso of RUTAS) {
    const respuesta = await pegar(caso, "?sucursal_id=2");
    const datos = await respuesta.json().catch(() => ({}));
    const error = typeof datos.error === "string" ? datos.error : "";
    assert.ok(
      !/^Elige /.test(error),
      `${caso.metodo} ${caso.ruta} sigue pidiendo elegir sucursal aunque el encabezado ya trae la 2: ${JSON.stringify(error)}`
    );
  }
});

test("no hay ninguna ruta que use sucursalDeEscritura fuera de esta lista", async () => {
  // Guarda contra la falla que este archivo existe para evitar: alguien agrega
  // una ruta de creación con sucursalDeEscritura, se le olvida el 400, y nadie
  // se entera porque ninguna prueba le pega. Si esto se pone rojo, agrega la
  // ruta nueva a RUTAS (y revisa que tenga su `if (!sucursal_id)`).
  const fuente = await fs.promises.readFile(path.join(__dirname, "server.js"), "utf8");
  const usos = (fuente.match(/sucursalDeEscritura\(/g) || []).length;
  assert.strictEqual(
    usos, RUTAS.length,
    `server.js usa sucursalDeEscritura en ${usos} rutas, pero esta prueba solo cubre ${RUTAS.length}`
  );
});
