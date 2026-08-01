/**
 * gastosCategorias.js — Catálogo de categorías de gastos, de DOS niveles:
 * un grupo (categoria_padre_id === null) contiene subcategorías. Un gasto
 * apunta SIEMPRE a una subcategoría (hoja); el grupo se deriva del padre.
 *
 * Mismo patrón de dos niveles que DB["catalogo-productos"].categorias.
 *
 * Las categorías NUNCA se borran: se desactivan. Si se borraran, los gastos
 * históricos que ya apuntan a ellas quedarían huérfanos y el reporte de meses
 * pasados cambiaría solo.
 */

/** Semilla: lo que de verdad se gasta en las tiendas. Corto a propósito —
 *  un menú con 70 opciones se captura mal y ensucia el reporte. Victor puede
 *  agregar las que le falten desde la pantalla. */
const SEMILLA = [
  ["Servicios", ["Luz", "Agua", "Internet", "Teléfono", "Software y licencias"]],
  ["Rentas", ["Renta de local", "Renta de bodega"]],
  ["Operación", ["Papelería", "Limpieza", "Combustible", "Mensajería y paquetería",
    "Mantenimiento y reparaciones", "Viáticos", "Alimentos", "Uniformes", "Herramientas"]],
  ["Nómina", ["Sueldos", "Comisiones", "Bonos"]],
  ["Marketing", ["Publicidad digital", "Impresos y lonas", "Perifoneo"]],
  ["Bancarios", ["Comisiones bancarias", "Intereses", "Terminal / TPV"]],
  ["Otros", ["Imprevistos", "Multas"]],
];

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

/** Siembra el catálogo si está vacío. Idempotente: si ya hay categorías
 *  (porque se restauraron de SQLite) no vuelve a sembrar ni duplica. */
function sembrarCategoriasGastos(DB) {
  if (DB.gastos.categorias.length > 0) return DB.gastos.categorias;
  SEMILLA.forEach(([grupo, hojas]) => {
    const idGrupo = siguienteId(DB.gastos.categorias);
    DB.gastos.categorias.push({ id: idGrupo, nombre: grupo, categoria_padre_id: null, activa: true });
    hojas.forEach((hoja) => {
      DB.gastos.categorias.push({
        id: siguienteId(DB.gastos.categorias),
        nombre: hoja,
        categoria_padre_id: idGrupo,
        activa: true,
      });
    });
  });
  return DB.gastos.categorias;
}

function listarCategorias(DB, { soloActivas } = {}) {
  const lista = DB.gastos.categorias;
  return soloActivas ? lista.filter((c) => c.activa) : [...lista];
}

function crearCategoria(DB, datos) {
  const nombre = (datos.nombre || "").trim();
  if (!nombre) throw new Error("Escribe el nombre de la categoría");

  const padreId = datos.categoria_padre_id == null || datos.categoria_padre_id === ""
    ? null
    : Number(datos.categoria_padre_id);

  if (padreId !== null) {
    const padre = DB.gastos.categorias.find((c) => c.id === padreId);
    if (!padre) throw new Error("Categoría padre no encontrada");
    if (padre.categoria_padre_id !== null) {
      throw new Error("El catálogo es solo dos niveles: una subcategoría no puede contener otra");
    }
  }

  const categoria = {
    id: siguienteId(DB.gastos.categorias),
    nombre,
    categoria_padre_id: padreId,
    activa: true,
  };
  DB.gastos.categorias.push(categoria);
  return categoria;
}

function renombrarCategoria(DB, id, nombre) {
  const categoria = DB.gastos.categorias.find((c) => c.id === Number(id));
  if (!categoria) throw new Error("Categoría no encontrada");
  const limpio = (nombre || "").trim();
  if (!limpio) throw new Error("Escribe el nombre de la categoría");
  categoria.nombre = limpio;
  return categoria;
}

function desactivarCategoria(DB, id) {
  const categoria = DB.gastos.categorias.find((c) => c.id === Number(id));
  if (!categoria) throw new Error("Categoría no encontrada");

  if (categoria.categoria_padre_id === null) {
    const hijasActivas = DB.gastos.categorias.filter(
      (c) => c.categoria_padre_id === categoria.id && c.activa
    );
    if (hijasActivas.length > 0) {
      throw new Error("Desactiva primero sus subcategorías activas");
    }
  }

  categoria.activa = false;
  return categoria;
}

/** Valida que el id sea una subcategoría (hoja) ACTIVA — lo único a lo que
 *  se puede apuntar un gasto nuevo. */
function buscarHojaActiva(DB, id) {
  const categoria = DB.gastos.categorias.find((c) => c.id === Number(id));
  if (!categoria) throw new Error("Categoría no encontrada");
  if (categoria.categoria_padre_id === null) {
    throw new Error("Elige una subcategoría, no un grupo");
  }
  if (!categoria.activa) throw new Error("Esa categoría está desactivada");
  return categoria;
}

module.exports = {
  sembrarCategoriasGastos, listarCategorias, crearCategoria,
  renombrarCategoria, desactivarCategoria, buscarHojaActiva,
};
