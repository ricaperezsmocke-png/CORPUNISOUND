/**
 * vendedores.js — El catálogo de quién vende en cada tienda.
 *
 * Existía desde el principio como una lista sembrada a mano en server.js, sin
 * ninguna forma de tocarla desde el sistema. Gerencia de Ventas lo convirtió en
 * pieza central —la meta, el avance y las tareas cuelgan de aquí— así que sin
 * un alta real el módulo solo servía para los cinco nombres de ejemplo.
 *
 * DOS REGLAS QUE NO SE NEGOCIAN:
 *
 * 1. NUNCA se borra un vendedor, se DESACTIVA. Cada venta guarda su
 *    `vendedor_id` (ventas.js), y los reportes resuelven el nombre por ese id
 *    (reportes.js). Borrar el renglón dejaría las ventas históricas mostrando
 *    "—" para siempre, sin forma de recuperar quién vendió.
 *
 * 2. La `sucursal_id` de un vendedor NO es cosmética. Decide, vía
 *    `esVentaDeSuTienda` en gerenteVentas.js, cuáles de sus ventas cuentan para
 *    su meta. Cambiarla mueve sus números, y si no cuadra con la cuenta de
 *    usuario ligada la persona vería un tablero que no es el suyo — por eso
 *    aquí se valida contra esa cuenta.
 */

const { fechaLocal } = require("./fechas");

/** Un vendedor sembrado antes de esta pantalla no trae el campo `activo`.
 *  Ausente = activo, mismo criterio que usa el catálogo de productos. */
function estaActivo(vendedor) {
  return vendedor.activo !== false;
}

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((v) => v.id)) + 1 : 1;
}

/** Cuenta de usuario ligada a este vendedor, si existe. */
function cuentaLigada(DB, vendedorId) {
  return (DB.admin?.usuarios || []).find((u) => u.vendedor_id === Number(vendedorId)) || null;
}

/**
 * El alcance sale de quien pregunta, NUNCA de `?sucursal_id=` — la trampa que
 * ya mordió tres veces en este repo (ver feedback del proyecto).
 */
function dentroDelAlcance(vendedor, alcance) {
  if (!alcance || alcance.verTodas) return true;
  return Number(vendedor.sucursal_id) === Number(alcance.sucursalId);
}

function listarVendedores(DB, alcance, { incluirInactivos = false } = {}) {
  return DB.pos.vendedores
    .filter((v) => dentroDelAlcance(v, alcance))
    .filter((v) => incluirInactivos || estaActivo(v))
    .map((v) => ({
      ...v,
      activo: estaActivo(v),
      // Se dice si ya tiene cuenta para que el administrador no ligue dos veces
      // ni se pregunte por qué el selector de personal no la ofrece.
      cuenta_ligada: cuentaLigada(DB, v.id)?.usuario || null,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

function validarNombre(DB, nombre, sucursalId, idQueSeEdita = null) {
  const limpio = String(nombre || "").trim();
  if (!limpio) throw new Error("El nombre del vendedor es obligatorio");
  // La unicidad es POR SUCURSAL, que es donde de verdad estorba el homónimo:
  // el selector de la caja y el de Personal ya solo muestran a los de una
  // tienda. Global tenía dos defectos: le filtraba a un gerente el nombre
  // exacto de alguien de otra sucursal que ni siquiera puede ver —lo contrario
  // de la regla de "no encontrado" que sigue el resto del módulo— y lo dejaba
  // sin salida propia si de verdad contrató a una tocaya.
  const repetido = DB.pos.vendedores.find(
    (v) =>
      v.nombre.trim().toLowerCase() === limpio.toLowerCase() &&
      Number(v.sucursal_id) === Number(sucursalId) &&
      v.id !== Number(idQueSeEdita)
  );
  if (repetido) {
    throw new Error(
      `Ya existe un vendedor llamado "${repetido.nombre}" en esta sucursal` +
      (repetido.activo === false ? " (está desactivado; puedes reactivarlo)" : "")
    );
  }
  return limpio;
}

function validarSucursal(DB, sucursalId) {
  const id = Number(sucursalId);
  const sucursal = DB.pos.sucursales.find((s) => s.id === id);
  if (!sucursal) throw new Error("Selecciona una sucursal válida");
  return id;
}

function validarMeta(meta) {
  if (meta === undefined || meta === null || meta === "") return 0;
  const valor = Number(meta);
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error("La meta debe ser un número mayor o igual a cero");
  }
  return Math.round(valor);
}

function crearVendedor(DB, datos, alcance) {
  const sucursal_id = validarSucursal(DB, datos.sucursal_id);
  // Quien administra una sola tienda no da de alta vendedores de otra.
  if (alcance && !alcance.verTodas && sucursal_id !== Number(alcance.sucursalId)) {
    throw new Error("Solo puedes dar de alta vendedores de tu propia sucursal");
  }
  const nuevo = {
    id: siguienteId(DB.pos.vendedores),
    nombre: validarNombre(DB, datos.nombre, sucursal_id),
    sucursal_id,
    meta_mensual: validarMeta(datos.meta_mensual),
    activo: true,
    alta_en: fechaLocal(),
  };
  DB.pos.vendedores.push(nuevo);
  return { ...nuevo, cuenta_ligada: null };
}

function buscarConAlcance(DB, id, alcance) {
  const vendedor = DB.pos.vendedores.find((v) => v.id === Number(id));
  // Mismo mensaje para "no existe" y "es de otra tienda": no se confirma que
  // el vendedor de otra sucursal exista.
  if (!vendedor || !dentroDelAlcance(vendedor, alcance)) {
    throw new Error("Vendedor no encontrado");
  }
  return vendedor;
}

function actualizarVendedor(DB, id, datos, alcance) {
  const vendedor = buscarConAlcance(DB, id, alcance);

  // El nombre se valida contra la sucursal DONDE VA A QUEDAR, no donde estaba:
  // si el mismo PUT lo mueve de tienda, el homónimo que importa es el de la
  // tienda destino.
  const sucursalFinal = datos.sucursal_id !== undefined ? Number(datos.sucursal_id) : vendedor.sucursal_id;
  if (datos.nombre !== undefined) vendedor.nombre = validarNombre(DB, datos.nombre, sucursalFinal, vendedor.id);
  if (datos.meta_mensual !== undefined) vendedor.meta_mensual = validarMeta(datos.meta_mensual);

  if (datos.sucursal_id !== undefined) {
    const nueva = validarSucursal(DB, datos.sucursal_id);
    if (alcance && !alcance.verTodas && nueva !== Number(alcance.sucursalId)) {
      throw new Error("No puedes mover un vendedor a otra sucursal");
    }
    // La cuenta ligada tiene que seguir cuadrando: si no, esa persona entraría
    // y vería un tablero cuyas ventas ya no son las suyas.
    const cuenta = cuentaLigada(DB, vendedor.id);
    if (cuenta && Number(cuenta.sucursal_id) !== nueva) {
      throw new Error(
        `La cuenta "${cuenta.usuario}" está ligada a este vendedor y pertenece a otra sucursal. ` +
        "Cambia primero la sucursal de esa cuenta en Personal."
      );
    }
    vendedor.sucursal_id = nueva;
  }

  if (datos.activo !== undefined) {
    // Desactivar POR AQUÍ tiene que pasar por el mismo guard que
    // `desactivarVendedor`, o la ruta genérica se lo salta: quedaba inactivo
    // con la cuenta viva, fuera del tablero de jefatura y fuera de la caja
    // —su avance ya no podía subir— pero él seguía viendo su pantalla como si
    // nada. Reactivar no necesita guard: siempre devuelve a un estado sano.
    if (!datos.activo) {
      const cuenta = cuentaLigada(DB, vendedor.id);
      if (cuenta) {
        throw new Error(
          `La cuenta "${cuenta.usuario}" está ligada a este vendedor. ` +
          "Desligala primero en Roles y Personal."
        );
      }
    }
    vendedor.activo = !!datos.activo;
  }

  return { ...vendedor, activo: estaActivo(vendedor), cuenta_ligada: cuentaLigada(DB, vendedor.id)?.usuario || null };
}

/**
 * Desactiva un vendedor. NO lo borra: sus ventas históricas siguen resolviendo
 * su nombre en los reportes.
 *
 * Si tiene una cuenta ligada se rechaza, en vez de dejar a esa persona con una
 * pantalla que ya no le corresponde. Primero se desliga en Personal.
 */
function desactivarVendedor(DB, id, alcance) {
  const vendedor = buscarConAlcance(DB, id, alcance);
  const cuenta = cuentaLigada(DB, vendedor.id);
  if (cuenta) {
    throw new Error(
      `La cuenta "${cuenta.usuario}" está ligada a este vendedor. ` +
      "Desligala primero en Roles y Personal."
    );
  }
  vendedor.activo = false;
  return { ...vendedor, activo: false, cuenta_ligada: null };
}

module.exports = {
  listarVendedores, crearVendedor, actualizarVendedor, desactivarVendedor,
  estaActivo, cuentaLigada,
};
