/**
 * sucursales.js — Reconciliación de la sucursal CEDIS (id 6) contra lo que
 * quede persistido en SQLite.
 *
 * server.js siembra DB.pos.sucursales con CEDIS incluido, pero el bloque de
 * restauración de arranque reemplaza esa tabla por completo con lo último
 * guardado en disco. En cualquier instancia que ya tenía datos persistidos
 * ANTES de esta feature (5 sucursales, sin CEDIS, sin sin_ubicacion en la 5),
 * CEDIS desaparecería y MercadoLibre volvería a ser "configurable" por error.
 *
 * Esta función se aplica siempre, después de la restauración, para garantizar
 * que CEDIS exista y que las sucursales 5 y 6 tengan sin_ubicacion=true —
 * sin tocar nada más (ni las sucursales 1-4, ni otros campos de la 5/6).
 * Es idempotente: correrla varias veces da el mismo resultado.
 */

function reconciliarSucursalesCedis(sucursales) {
  const CEDIS = { id: 6, nombre: "CEDIS", ciudad: "Chiapas", sin_ubicacion: true, lat: null, lng: null };
  const conCedis = sucursales.some((s) => s.id === 6) ? sucursales : [...sucursales, CEDIS];
  return conCedis.map((s) => (s.id === 5 || s.id === 6) ? { ...s, sin_ubicacion: true } : s);
}

const { fechaLocal } = require("./fechas");
const { sembrarCajasSinValidar, validarPredeterminadaDeSucursal } = require("./cajas");

function normalizarNombre(nombre) {
  return nombre.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "").toLowerCase().replace(/[\s\p{White_Space}]/gu, "");
}

function limpiarTexto(valor, campo) {
  if (typeof valor !== "string") throw new Error(`El campo ${campo} es obligatorio y debe ser texto`);
  const limpio = valor.replace(/\p{Cf}/gu, "").replace(/[\s\p{White_Space}]+/gu, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(limpio)) {
    throw new Error(campo === "nombre"
      ? "El nombre de la tienda debe tener letras o números"
      : "La ciudad de la tienda debe tener letras o números");
  }
  if (limpio.length > 60) throw new Error(`El campo ${campo} no puede exceder 60 caracteres`);
  return limpio;
}

function validarCoordenadas(lat, lng, { permitirVacias = false, tieneUbicacion = false } = {}) {
  const vacios = [lat, lng].map((valor) => valor == null || (typeof valor === "string" && !valor.trim()));
  if (vacios.every(Boolean) && tieneUbicacion) {
    throw new Error("Esta tienda ya tiene ubicación GPS: no se puede dejar en blanco, solo cambiarla");
  }
  if (vacios.every(Boolean) && permitirVacias) return { lat: null, lng: null };
  if (vacios.some(Boolean)) {
    throw new Error("Captura la ubicación GPS de la tienda (latitud y longitud)");
  }
  for (const [campo, valor, limite] of [["latitud", lat, 90], ["longitud", lng, 180]]) {
    if (!["number", "string"].includes(typeof valor) || !Number.isFinite(Number(valor)) || Math.abs(Number(valor)) > limite) {
      throw new Error(`La ${campo} debe ser un número entre ${-limite} y ${limite}`);
    }
  }
  return { lat: Number(lat), lng: Number(lng) };
}

function crearSucursal(DB, datos, usuario) {
  const nombre = limpiarTexto(datos?.nombre, "nombre");
  const ciudad = limpiarTexto(datos?.ciudad, "ciudad");
  const existente = DB.pos.sucursales.find((s) => normalizarNombre(s.nombre) === normalizarNombre(nombre));
  if (existente) throw new Error(`Ya existe una tienda con ese nombre: ${existente.nombre}`);
  const coordenadas = validarCoordenadas(datos?.lat, datos?.lng);
  const id = Math.max(0, ...DB.pos.sucursales.map((s) => Number(s.id))) + 1;
  const colecciones = [DB.pos.cajas, DB.admin.usuarios, DB.pos.vendedores];
  if (colecciones.some((lista) => (lista || []).some((registro) => Number(registro.sucursal_id) === id))) {
    throw new Error(`Hay registros huérfanos con la sucursal ${id}; revisa antes de crear la tienda`);
  }
  const cuenta = DB.admin.usuarios.find((u) => Number(u.id) === Number(usuario.id));
  const nueva = {
    id, nombre, ciudad, ...coordenadas,
    fecha_alta: fechaLocal(), creada_por: { usuario_id: usuario.id, nombre: cuenta?.nombre ?? null },
  };
  // Sembrar solo esta tienda sobre una copia: ninguna validación altera el estado real.
  const cajasNumericas = (DB.pos.cajas || []).filter((c) => Number.isFinite(Number(c.id)));
  const temporal = { pos: { sucursales: [nueva], cajas: cajasNumericas.map((c) => ({ ...c })) } };
  sembrarCajasSinValidar(temporal);
  validarPredeterminadaDeSucursal(temporal, id);
  const nuevasCajas = temporal.pos.cajas.slice(cajasNumericas.length);
  DB.pos.sucursales.push(nueva);
  if (!DB.pos.cajas) DB.pos.cajas = [];
  DB.pos.cajas.push(...nuevasCajas);
  return nueva;
}

module.exports = { reconciliarSucursalesCedis, crearSucursal, validarCoordenadas };
