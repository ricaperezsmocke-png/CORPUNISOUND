/**
 * usuarios.js — Personal del sistema. Cada usuario tiene un rol asignado
 * (de roles.js) que determina qué puede ver y hacer.
 */

const { hashearPassword, verificarPassword } = require("./auth");

/**
 * Normaliza el nombre de usuario para COMPARARLO: sin espacios sobrantes y sin
 * distinguir mayúsculas. El teclado del celular autocapitaliza la primera
 * letra, así que la cajera que teclea "Maria" tiene que entrar a la cuenta
 * "maria" en vez de sumar un fallo al freno de fuerza bruta.
 *
 * Es el MISMO criterio que usa normalizar() en intentosLogin.js (trim +
 * minúsculas): si los dos difirieran, el cerrojo contaría los fallos bajo una
 * clave distinta a la del usuario que realmente se buscó.
 *
 * La CONTRASEÑA no se normaliza nunca: esa sí distingue mayúsculas.
 */
function normalizarUsuario(usuario) {
  return typeof usuario === "string" ? usuario.trim().toLowerCase() : "";
}

/**
 * Cuentas YA guardadas que se pisan entre sí al normalizar (trim + minúsculas).
 *
 * crearUsuario impide crear nuevas y actualizarUsuario no deja renombrar, así
 * que esto no puede aparecer de aquí en adelante — pero una base vieja podría
 * tener "Maria" y "maria" desde antes. iniciarSesion se queda con la PRIMERA
 * del arreglo, así que la segunda no puede entrar nunca y solo ve el mensaje
 * genérico "Usuario o contraseña incorrectos": para el dueño se ve como "a
 * Fulana le dejó de funcionar la cuenta", sin ninguna pista de por qué.
 *
 * Por eso el arranque de server.js lo dice en voz alta (avisa, no bloquea).
 * Las cuentas con el nombre en blanco se ignoran: esas ya no pueden entrar por
 * la guarda de nombre vacío de iniciarSesion, choquen o no.
 *
 * @returns [{ clave, usuarios: ["Maria", "maria"] }] — vacío si no hay choques
 */
function usuariosQueChocanAlNormalizar(DB) {
  const porClave = new Map();
  for (const u of (DB && DB.admin && DB.admin.usuarios) || []) {
    const clave = normalizarUsuario(u.usuario);
    if (!clave) continue;
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(u.usuario);
  }
  return [...porClave.entries()]
    .filter(([, usuarios]) => usuarios.length > 1)
    .map(([clave, usuarios]) => ({ clave, usuarios }));
}

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function listarUsuarios(DB) {
  return DB.admin.usuarios.map(({ password_hash, ...resto }) => resto);
}

/**
 * Valida la liga con el catálogo de vendedores (Gerencia de Ventas).
 *
 * Sin esto se aceptaba cualquier número: un `vendedor_id` inexistente dejaba a
 * la persona con la pantalla EN BLANCO —sin aviso, sin error, un div vacío—
 * porque el componente cree que sí está ligada y el tablero nunca carga. Y un
 * `vendedor_id` de otra sucursal dejaba a una cuenta de Palenque viendo el
 * tablero de una vendedora de Ocosingo, que es justo lo que el módulo entero
 * existe para impedir.
 *
 * @returns el id ya normalizado, o null si la cuenta no participa
 */
function validarVendedorId(DB, valor, sucursalDeLaCuenta, idCuentaQueSeEdita = null) {
  if (valor === undefined || valor === null || valor === "") return null;
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("El vendedor seleccionado no es válido");
  }
  const vendedor = (DB.pos?.vendedores || []).find((v) => v.id === id);
  if (!vendedor) {
    throw new Error("Ese vendedor no existe en el catálogo");
  }
  if (typeof valor === "boolean") throw new Error("El vendedor seleccionado no es válido");
  // Ligar a alguien desactivado deja un estado del que no se sale por el camino
  // previsto: el vendedor queda `activo: false` con una cuenta viva y un tablero
  // funcional, y `desactivarVendedor` ya no lo puede tocar porque rechaza
  // mientras haya cuenta ligada.
  if (vendedor.activo === false) {
    throw new Error(`${vendedor.nombre} está desactivado; reactívalo primero en Roles y Personal → Vendedores`);
  }
  if (Number(vendedor.sucursal_id) !== Number(sucursalDeLaCuenta)) {
    throw new Error(
      `${vendedor.nombre} es vendedor de otra sucursal; elige uno de la misma sucursal que la cuenta`
    );
  }
  // UNA cuenta por vendedor. Sin esto, dos cuentas ligadas al mismo vendedor
  // comparten tablero: la segunda persona ve la meta, el avance y los clientes
  // de la primera, y puede cerrar sus tareas -- el aislamiento que este modulo
  // existe para proteger, roto por un error de captura y sin ningun aviso.
  const yaLigada = DB.admin.usuarios.find(
    (u) => u.vendedor_id === id && u.id !== Number(idCuentaQueSeEdita)
  );
  if (yaLigada) {
    throw new Error(
      `La cuenta "${yaLigada.usuario}" ya está ligada a ${vendedor.nombre}; cada vendedor puede tener una sola cuenta`
    );
  }
  return id;
}

async function crearUsuario(DB, datos) {
  if (!datos.nombre || !datos.nombre.trim()) throw new Error("El nombre es obligatorio");
  if (!datos.usuario || !datos.usuario.trim()) throw new Error("El usuario (para iniciar sesión) es obligatorio");
  if (!datos.password || datos.password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");
  // Se compara normalizado: dos cuentas que solo difieren en mayúsculas o
  // espacios serían indistinguibles al entrar (el login busca normalizado y
  // se quedaría siempre con la primera).
  if (DB.admin.usuarios.some((u) => normalizarUsuario(u.usuario) === normalizarUsuario(datos.usuario))) throw new Error("Ese nombre de usuario ya existe");
  if (!datos.rol_id) throw new Error("Debes asignar un rol");

  const nuevo = {
    id: siguienteId(DB.admin.usuarios),
    nombre: datos.nombre.trim(),
    usuario: datos.usuario.trim(),
    password_hash: await hashearPassword(datos.password),
    rol_id: Number(datos.rol_id),
    sucursal_id: Number(datos.sucursal_id) || 1,
    // Liga con el catálogo DB.pos.vendedores (Gerencia de Ventas). null = esta
    // cuenta no participa del programa de objetivos, que es el comportamiento
    // de siempre. Es un dato administrativo: lo pone quien da de alta al
    // personal, nunca la propia persona.
    vendedor_id: validarVendedorId(DB, datos.vendedor_id, Number(datos.sucursal_id) || 1),
    activo: true,
  };
  DB.admin.usuarios.push(nuevo);
  const { password_hash, ...sinPassword } = nuevo;
  return sinPassword;
}

async function actualizarUsuario(DB, id, datos) {
  const idx = DB.admin.usuarios.findIndex((u) => u.id === Number(id));
  if (idx === -1) throw new Error("Usuario no encontrado");
  if (datos.password && datos.password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");

  // El vendedor se valida contra la sucursal QUE VA A QUEDAR, no la anterior:
  // si se mueve la cuenta de tienda y de vendedor en la misma edición, lo que
  // debe cuadrar es el resultado final.
  const sucursalFinal = datos.sucursal_id !== undefined
    ? Number(datos.sucursal_id)
    : DB.admin.usuarios[idx].sucursal_id;

  DB.admin.usuarios[idx] = {
    ...DB.admin.usuarios[idx],
    nombre: datos.nombre ?? DB.admin.usuarios[idx].nombre,
    rol_id: datos.rol_id !== undefined ? Number(datos.rol_id) : DB.admin.usuarios[idx].rol_id,
    sucursal_id: datos.sucursal_id !== undefined ? Number(datos.sucursal_id) : DB.admin.usuarios[idx].sucursal_id,
    // Se acepta null explícito para DESLIGAR una cuenta de su vendedor (por eso
    // se distingue `undefined` de `null` en vez de usar `||`).
    vendedor_id: datos.vendedor_id !== undefined
      ? validarVendedorId(DB, datos.vendedor_id, sucursalFinal, Number(id))
      : (DB.admin.usuarios[idx].vendedor_id ?? null),
    activo: datos.activo !== undefined ? !!datos.activo : DB.admin.usuarios[idx].activo,
  };
  if (datos.password) {
    DB.admin.usuarios[idx].password_hash = await hashearPassword(datos.password);
  }
  const { password_hash, ...sinPassword } = DB.admin.usuarios[idx];
  return sinPassword;
}

function esAccionSobreSiMismo(idObjetivo, idSolicitante) {
  return Number(idObjetivo) === Number(idSolicitante);
}

function eliminarUsuario(DB, id) {
  const idx = DB.admin.usuarios.findIndex((u) => u.id === Number(id));
  if (idx === -1) throw new Error("Usuario no encontrado");
  DB.admin.usuarios.splice(idx, 1);
  return { ok: true };
}

async function iniciarSesion(DB, usuario, password) {
  // Se normalizan los DOS lados: los usuarios ya guardados conservan las
  // mayúsculas con que se capturaron, así que "Maria" en la base debe
  // encontrarse escribiendo "maria", "MARIA" o " Maria ". Sin migrar nada.
  const clave = normalizarUsuario(usuario);
  const encontrado = clave ? DB.admin.usuarios.find((u) => normalizarUsuario(u.usuario) === clave && u.activo) : null;
  if (!encontrado) throw new Error("Usuario o contraseña incorrectos");
  const ok = await verificarPassword(password, encontrado.password_hash);
  if (!ok) throw new Error("Usuario o contraseña incorrectos");
  return encontrado;
}

module.exports = {
  validarVendedorId,
  listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario,
  esAccionSobreSiMismo, iniciarSesion, normalizarUsuario, usuariosQueChocanAlNormalizar,
};
