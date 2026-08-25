import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIAS, moduloVisible, categoriasVisibles } from "./menuCategorias.js";

/** Administrador de verdad: todos los módulos y todos los permisos que el menú pide. */
const ADMIN = {
  modulos: ["pos", "corte", "gastos", "cuenta_comun", "inventario", "crm",
            "radar_demanda", "ml", "reportes", "admin", "respaldos"],
  permisos: ["realizar_corte_caja", "ver_gastos", "ver_estado_cuenta", "realizar_traspasos",
             "gestionar_garantias", "ver_respaldos", "usar_gerente_ventas",
             "editar_objetivos_venta", "ver_radar_demanda", "registrar_demanda",
             "ver_resumen_demanda", "ver_reportes", "editar_configuracion_pos"],
};

test("el administrador ve las tres categorías y los 15 módulos", () => {
  const vistas = categoriasVisibles(ADMIN);
  assert.equal(vistas.length, 3);
  assert.deepEqual(vistas.map((c) => c.id), ["operacion", "comercial", "administracion"]);
  assert.equal(vistas.reduce((n, c) => n + c.modulos.length, 0), 15);
});

test("una categoría sin módulos visibles no se dibuja", () => {
  // Cajera: solo Punto de Venta y Corte de Caja. Comercial y Administración
  // le quedan vacías y no deben aparecer como encabezados muertos.
  const cajera = { modulos: ["pos", "corte"], permisos: ["realizar_corte_caja"] };
  const vistas = categoriasVisibles(cajera);
  assert.deepEqual(vistas.map((c) => c.id), ["operacion"]);
  assert.deepEqual(vistas[0].modulos.map((m) => m.id), ["pos", "corte"]);
});

test("basta CUALQUIERA de los permisos de la lista", () => {
  // A "Mi Objetivo de Venta" se entra por dos puertas distintas: la vendedora
  // con usar_gerente_ventas y la jefatura con editar_objetivos_venta. Con una
  // sola clave, un rol que solo tuviera la de jefatura no vería el módulo.
  const soloJefatura = { modulos: ["pos"], permisos: ["editar_objetivos_venta"] };
  const objetivo = CATEGORIAS
    .flatMap((c) => c.modulos)
    .find((m) => m.id === "gerencia_ventas");
  assert.equal(moduloVisible(objetivo, soloJefatura), true);

  const soloVendedora = { modulos: ["pos"], permisos: ["usar_gerente_ventas"] };
  assert.equal(moduloVisible(objetivo, soloVendedora), true);

  const ninguno = { modulos: ["pos"], permisos: ["cerrar_venta"] };
  assert.equal(moduloVisible(objetivo, ninguno), false);
});

test("un usuario sin listas declaradas no se filtra", () => {
  // El default permisivo del código actual: si el backend todavía no mandó
  // modulos/permisos, se muestra todo en vez de dejar el menú vacío.
  const vistas = categoriasVisibles({});
  assert.equal(vistas.length, 3);
  assert.equal(vistas.reduce((n, c) => n + c.modulos.length, 0), 15);
});

test("hacen falta el módulo Y el permiso, no uno solo", () => {
  const gastos = CATEGORIAS.flatMap((c) => c.modulos).find((m) => m.id === "gastos");
  assert.equal(moduloVisible(gastos, { modulos: ["gastos"], permisos: [] }), false);
  assert.equal(moduloVisible(gastos, { modulos: [], permisos: ["ver_gastos"] }), false);
  assert.equal(moduloVisible(gastos, { modulos: ["gastos"], permisos: ["ver_gastos"] }), true);
});

test("filtrar no muta CATEGORIAS", () => {
  // categoriasVisibles se llama en cada dibujado. Si mutara la fuente, el menú
  // se iría vaciando solo.
  const antes = CATEGORIAS.map((c) => c.modulos.length);
  categoriasVisibles({ modulos: [], permisos: [] });
  assert.deepEqual(CATEGORIAS.map((c) => c.modulos.length), antes);
});

test("Configuración es módulo de primer nivel en administración", () => {
  const admin = CATEGORIAS.find((c) => c.id === "administracion");
  const config = admin.modulos.find((m) => m.id === "configuracion");
  assert.ok(config, "Configuración debe estar en ADMINISTRACIÓN");
  assert.equal(config.modulo, "pos");
  assert.equal(config.permiso, "editar_configuracion_pos");
});

test("las subcategorías cuelgan de Punto de Venta y de Inventario", () => {
  const porId = Object.fromEntries(CATEGORIAS.flatMap((c) => c.modulos).map((m) => [m.id, m]));
  assert.deepEqual(porId.pos.hijos.map((h) => h.id), ["consultas", "apartados"]);
  assert.deepEqual(porId.inventario.hijos.map((h) => h.id), ["recepcion"]);
});
