/**
 * auth.js — Autenticación y control de permisos.
 *
 * IMPORTANTE (léelo antes de usar esto en producción real):
 * - Las contraseñas se guardan hasheadas con bcrypt, nunca en texto plano.
 * - JWT_SECRET debe venir de .env/entorno — si no existe, se genera uno
 *   ALEATORIO en cada arranque (lo cual invalida sesiones anteriores, pero
 *   nunca usa una clave fija publicada en el repo); para uso real define
 *   JWT_SECRET fijo en el entorno (Render) para que las sesiones persistan.
 * - Esto es una base funcional, no una auditoría de seguridad completa.
 *   Antes de exponer el backend a internet (Fase 4 del plan de sucursales),
 *   pide una revisión de seguridad específica.
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { permisosDeRol } = require("./roles");

// Si JWT_SECRET no está en el entorno, se genera una clave ALEATORIA por
// arranque en vez de caer a un valor fijo. Un valor fijo escrito aquí quedaría
// publicado en GitHub, y cualquiera podría firmar un token de administrador
// con él y entrar sin contraseña. Con una clave aleatoria eso es imposible; el
// único costo es que, sin JWT_SECRET fijo, las sesiones se invalidan al
// reiniciar el servidor (por eso conviene configurarlo en Render — ver el
// aviso de arranque en server.js).
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString("hex");
const EXPIRA_EN = "12h";

async function hashearPassword(passwordPlano) {
  return bcrypt.hash(passwordPlano, 10);
}

async function verificarPassword(passwordPlano, hash) {
  return bcrypt.compare(passwordPlano, hash);
}

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nombre: usuario.nombre, rol_id: usuario.rol_id, sucursal_id: usuario.sucursal_id },
    JWT_SECRET,
    { expiresIn: EXPIRA_EN }
  );
}

function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Corte de sesiones ("epoch"). Todo token emitido ANTES de este instante deja de
 * valer, aunque su firma sea buena y no haya expirado.
 *
 * Existe por la restauración. `requiereLogin` solo verifica la firma y
 * `requierePermiso` resuelve los permisos con el `rol_id` que viene DENTRO del
 * token, contra el DB de ese momento. Al restaurar se reemplaza `DB.admin`
 * entero —usuarios y roles—, y los ids de rol se reciclan: una cajera con sesión
 * abierta podía quedar apuntando a un rol que en la foto restaurada era
 * Administrador, y una cuenta borrada revivía con su token todavía válido.
 *
 * Vive en memoria y NO en el DB a propósito: el DB es justo lo que se está
 * reemplazando, y persistirlo dejaría el corte apuntando a un instante restaurado.
 * Un reinicio del servidor ya invalida todo por su cuenta si no hay JWT_SECRET
 * fijo, y si lo hay, las sesiones sobreviven — que es el comportamiento normal.
 */
let sesionesValidasDesdeMs = 0;

function invalidarSesionesAnterioresA(instanteMs = Date.now()) {
  sesionesValidasDesdeMs = instanteMs;
}

function sesionesValidasDesde() {
  return sesionesValidasDesdeMs;
}

/** Middleware: exige un JWT válido, y adjunta req.usuarioToken con lo que trae el token */
/**
 * Comprobación de que la cuenta SIGUE existiendo y activa. La inyecta server.js
 * al arrancar, porque auth.js no conoce el DB y las 142 rutas ya llaman a
 * `requiereLogin` sin parámetros.
 */
let revisarCuenta = null;
function configurarRevisionDeCuenta(fn) { revisarCuenta = fn; }

function requiereLogin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  try {
    const datos = verificarToken(token);
    // `iat` viene en segundos. Se compara con el corte redondeado hacia abajo al
    // segundo para no rechazar por error un token emitido en el mismo segundo.
    if (sesionesValidasDesdeMs && Number(datos.iat) * 1000 < Math.floor(sesionesValidasDesdeMs / 1000) * 1000) {
      return res.status(401).json({
        error: "Se restauró un respaldo del sistema. Vuelve a iniciar sesión.",
      });
    }
    /**
     * El token dura 12 horas, así que hasta aquí desactivar a una persona NO la
     * sacaba del sistema: comprobado, su sesión seguía abriendo productos,
     * ventas y clientes. Se corre a alguien enojado a las 9 de la mañana y
     * hasta las 9 de la noche podía seguir entrando desde su casa.
     *
     * Se consulta el estado VIVO en cada petición. Es una búsqueda en un
     * arreglo de unas decenas de usuarios que ya está en memoria: no se nota.
     *
     * Y de paso se refrescan `rol_id` y `sucursal_id` desde el DB. El token los
     * lleva congelados, así que cambiarle el rol a alguien no surtía efecto
     * hasta que volviera a entrar — y como los ids de rol se reciclan, podía
     * despertar con los permisos de otro rol. Es el mismo defecto que ya se
     * había visto al restaurar un respaldo.
     */
    if (revisarCuenta) {
      const cuenta = revisarCuenta(datos.id);
      if (!cuenta) {
        return res.status(401).json({ error: "Tu cuenta ya no está activa. Habla con quien administra el sistema." });
      }
      // Se refresca SOLO el rol. La sucursal NO: el login firma el registro del
      // usuario, así que la del token ya es la de la base — sobrescribirla no
      // aportaría nada y sí abriría la puerta a romper el alcance por sorpresa.
      datos.rol_id = cuenta.rol_id;
    }
    req.usuarioToken = datos;
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida o expirada" });
  }
}

/**
 * Middleware: exige que el usuario logueado tenga cierto permiso.
 * Requiere que ya haya corrido requiereLogin, y recibe una función para
 * resolver los permisos del rol (para no acoplar este archivo a la DB).
 */
function requierePermiso(clave, resolverPermisosDeRol) {
  return (req, res, next) => {
    if (!req.usuarioToken) return res.status(401).json({ error: "No autenticado" });
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    if (!permisos.includes(clave)) {
      return res.status(403).json({ error: `No tienes el permiso requerido: ${clave}` });
    }
    next();
  };
}

/**
 * Middleware: exige alcance GLOBAL, no solo el permiso de la acción.
 *
 * Para rutas cuyo efecto no cabe en una sucursal: borrar un producto arrasa
 * el catálogo y las existencias de TODAS las tiendas (ver eliminarProducto en
 * productos.js), y los roles y las coordenadas de una sucursal son
 * configuración del sistema entero.
 *
 * Hasta ahora eso lo contenía únicamente la semilla de roles.js, que excluye
 * a mano "eliminar_producto" y "administrar_roles" del Gerente de sucursal.
 * Eso es defensa por CONFIGURACIÓN: se evapora en cuanto alguien concede ese
 * permiso a un rol amarrado desde la pantalla de roles, sin tocar código y
 * sin que nada avise. Este middleware la vuelve invariante de CÓDIGO.
 *
 * Va DESPUÉS de requierePermiso: primero "¿tienes la llave?", luego
 * "¿tu llave alcanza para todas las tiendas?".
 */
function requiereAlcanceGlobal(resolverPermisosDeRol) {
  return (req, res, next) => {
    if (!req.usuarioToken) return res.status(401).json({ error: "No autenticado" });
    const permisos = resolverPermisosDeRol(req.usuarioToken.rol_id);
    if (!Array.isArray(permisos) || !permisos.includes("ver_todas_las_sucursales")) {
      return res.status(403).json({
        error: "Esta acción afecta a todas las sucursales y requiere una cuenta con alcance global.",
      });
    }
    next();
  };
}

/**
 * Resuelve qué sucursal(es) puede ver este request.
 * - Con permiso "ver_todas_las_sucursales": respeta ?sucursal_id= si viene
 *   (para filtrar a una tienda) o devuelve verTodas si no.
 * - Sin ese permiso: se ignora el query y se fuerza la sucursal del token.
 *
 * FALLA CERRADO a propósito. Antes, cualquier ?sucursal_id= que no parseara
 * caía al `return verTodas` del final: un `?sucursal_id=undefined` armado por
 * el frontend (o un arreglo `?sucursal_id=1&sucursal_id=2`, que Express
 * entrega como Array y Number() convierte en NaN) ENSANCHABA el alcance en
 * silencio, justo al revés de lo que se quería. Un alcance de más no lo nota
 * nadie; uno de menos se reporta enseguida. Por eso lo que no parsea ya no
 * degrada a "todas": cae en un alcance vacío que no muestra ni deja tocar
 * nada. Se marca además con `invalido` por si alguna ruta quiere distinguir
 * "no hay nada" de "me mandaste basura" y responder 400 — hoy NINGUNA lo lee,
 * así que la basura sale como lista vacía o 404, no como un mensaje claro.
 *
 * Los tres consumidores quedan cerrados solos, sin cambiarlos:
 * filtrarPorSucursal devuelve [], dentroDeAlcance devuelve false (404) y
 * sucursalDeEscritura devuelve null (400).
 */
function alcanceSucursal(req, permisos) {
  const puedeVerTodas = Array.isArray(permisos) && permisos.includes("ver_todas_las_sucursales");
  const solicitada = req.query ? req.query.sucursal_id : undefined;

  if (puedeVerTodas) {
    // Ausente, vacío o "todas": intención explícita de ver todo.
    if (solicitada === undefined || solicitada === "" || solicitada === "todas") {
      return { verTodas: true, sucursalId: null };
    }
    // Vino algo distinto: o es un id válido, o es basura que no se interpreta.
    const n = typeof solicitada === "string" ? Number(solicitada) : NaN;
    if (Number.isInteger(n) && n > 0) {
      return { verTodas: false, sucursalId: n };
    }
    return { verTodas: false, sucursalId: null, invalido: true };
  }
  const sucursalToken = req.usuarioToken && req.usuarioToken.sucursal_id != null ? Number(req.usuarioToken.sucursal_id) : null;
  return { verTodas: false, sucursalId: sucursalToken };
}

/**
 * Resuelve a QUÉ SUCURSAL SE ESCRIBE en una ruta que crea registros.
 *
 * El selector de sucursal del encabezado nació para filtrar lo que se VE, y
 * el sistema terminó usándolo también para decidir dónde se GUARDA. Cuando
 * el encabezado dice "Todas" (el valor con el que entra el administrador),
 * alcance.verTodas es true y antes se caía a `Number(body.sucursal_id) || 1`:
 * la venta, el gasto, el ajuste de inventario o el corte se registraban en
 * silencio en la sucursal 1 — la tienda equivocada, sin ningún aviso.
 *
 * Regla actual: la sucursal del encabezado manda también al escribir, y con
 * "Todas" NO se escribe. Esta función devuelve null en ese caso y la ruta
 * responde 400 con un mensaje que le dice al usuario qué elegir. La pantalla
 * correspondiente frena antes (ver src/api.js → sinSucursalElegida), así que
 * este 400 es la última red, no el camino normal.
 *
 * @param alcance         lo que devuelve alcanceSucursal()
 * @param sucursalIdBody  la sucursal que mandó el formulario, si tiene una propia
 * @returns el id de sucursal donde escribir, o null si no se puede saber
 */
function sucursalDeEscritura(alcance, sucursalIdBody) {
  // Usuario amarrado: siempre la suya, sin importar lo que mande el cliente.
  if (!alcance || !alcance.verTodas) {
    const propia = alcance ? Number(alcance.sucursalId) : NaN;
    return Number.isInteger(propia) && propia > 0 ? propia : null;
  }
  // Encabezado en "Todas": solo vale la que traiga el formulario.
  const delFormulario = Number(sucursalIdBody);
  return Number.isInteger(delFormulario) && delFormulario > 0 ? delFormulario : null;
}

/**
 * Resuelve la sucursal para las pantallas que tienen su PROPIO selector y en
 * las que ese selector debe ganar SIEMPRE (Migración de Datos, importación de
 * historial de ventas).
 *
 * OJO: aquí no se puede usar alcanceSucursal(). apiFetch (src/api.js) agrega
 * ?sucursal_id=<selección del encabezado> a TODA request que no lo traiga, así
 * que un administrador con una tienda concreta elegida arriba haría que
 * alcance.verTodas diera false y la sucursal del encabezado pisara la que el
 * usuario eligió explícitamente en ESE formulario. En Migración eso significa
 * importar el Excel de una tienda a otra sin ninguna señal. Por eso el permiso
 * se resuelve a mano y gana el valor del formulario.
 *
 * @returns el id de sucursal, o null si el formulario no eligió ninguna
 */
function sucursalDelFormulario(permisos, usuarioToken, valorDelFormulario) {
  const puedeVerTodas = Array.isArray(permisos) && permisos.includes("ver_todas_las_sucursales");
  const elegida = puedeVerTodas
    ? Number(valorDelFormulario)
    : Number(usuarioToken && usuarioToken.sucursal_id);
  return Number.isInteger(elegida) && elegida > 0 ? elegida : null;
}

/** Filtra un arreglo (que tenga campo sucursal_id) según el alcance resuelto. */
function filtrarPorSucursal(lista, alcance) {
  if (alcance.verTodas) return [...lista];
  return lista.filter((x) => Number(x.sucursal_id) === alcance.sucursalId);
}

/**
 * Versión de filtrarPorSucursal para UN solo registro (rutas por :id).
 * Se usa para decidir si un registro puntual (cliente, venta...) es visible
 * dentro del alcance resuelto, antes de devolverlo o de mutarlo. Un usuario
 * amarrado que pide el registro de otra sucursal debe recibir 404 (no 403,
 * para no confirmar que el registro existe en otra tienda).
 */
function dentroDeAlcance(sucursalId, alcance) {
  if (!alcance || alcance.verTodas) return true;
  return Number(sucursalId) === alcance.sucursalId;
}

const RADIO_TOLERANCIA_METROS = 300;

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000; // radio de la Tierra en metros
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Valida que quien inicia sesión esté físicamente en la sucursal que dice
 * ser. Usuario con "ver_todas_las_sucursales" (Administrador) siempre pasa
 * sin evaluar nada más. Usuario amarrado: la sucursal seleccionada debe
 * coincidir con la de su cuenta; si esa sucursal tiene coordenadas
 * configuradas, además su ubicación GPS debe caer dentro del radio de
 * tolerancia. Sin coordenadas configuradas en la sucursal, no se valida GPS
 * todavía (para no bloquear una tienda antes de que Victor la configure).
 */
function validarUbicacionLogin(usuario, sucursalSeleccionadaId, lat, lng, DB) {
  const permisos = permisosDeRol(DB, usuario.rol_id);
  if (permisos.includes("ver_todas_las_sucursales")) return { ok: true };

  const sucursalReal = usuario.sucursal_id != null ? Number(usuario.sucursal_id) : null;
  if (sucursalReal == null || Number(sucursalSeleccionadaId) !== sucursalReal) {
    return { ok: false, motivo: "sucursal_no_coincide" };
  }

  const sucursal = DB.pos.sucursales.find((s) => s.id === sucursalReal);
  if (!sucursal || sucursal.lat == null || sucursal.lng == null) {
    return { ok: true };
  }

  if (lat == null || lng == null) {
    return { ok: false, motivo: "sin_permiso_ubicacion" };
  }
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    return { ok: false, motivo: "sin_permiso_ubicacion" };
  }

  const distancia = distanciaMetros(latN, lngN, sucursal.lat, sucursal.lng);
  if (distancia > RADIO_TOLERANCIA_METROS) {
    return { ok: false, motivo: "ubicacion_no_coincide", distancia };
  }
  return { ok: true };
}

/** Traduce el motivo de bloqueo a un mensaje claro, sin revelar la sucursal real de la cuenta. */
function mensajePorMotivoUbicacion(motivo) {
  if (motivo === "sucursal_no_coincide") return "La sucursal seleccionada no coincide con tu cuenta.";
  if (motivo === "ubicacion_no_coincide") return "Tu ubicación no coincide con la sucursal seleccionada. Verifica que tengas el GPS activado y que estés en la tienda.";
  if (motivo === "sin_permiso_ubicacion") return "Debes permitir el acceso a tu ubicación para iniciar sesión.";
  return "No se pudo iniciar sesión.";
}

module.exports = {
  hashearPassword, verificarPassword, firmarToken, verificarToken, requiereLogin, requierePermiso,
  requiereAlcanceGlobal, invalidarSesionesAnterioresA, sesionesValidasDesde,
  configurarRevisionDeCuenta,
  alcanceSucursal, filtrarPorSucursal, dentroDeAlcance,
  sucursalDeEscritura, sucursalDelFormulario,
  distanciaMetros, validarUbicacionLogin, mensajePorMotivoUbicacion,
};
