/**
 * testHelpers.js — Construye un DB de prueba con la misma forma que el de
 * server.js, para poder probar las funciones de datos en aislamiento sin
 * levantar el servidor. Datos mínimos repartidos en las 4 sucursales.
 */

const { sembrarRolesIniciales } = require("./roles");

function construirDBPrueba() {
  const DB = {
    pos: {
      ventas: [
        { id: 1, fecha: "2026-05-10", fecha_hora: "2026-05-10T10:00:00.000Z", sucursal_id: 1, vendedor_id: 1, cliente_id: 1, total: 1200, metodo_pago: "efectivo", estatus: "cerrada", motivo_cancelacion: null },
        { id: 2, fecha: "2026-05-20", fecha_hora: "2026-05-20T10:00:00.000Z", sucursal_id: 2, vendedor_id: 3, cliente_id: 2, total: 800, metodo_pago: "tarjeta", estatus: "cerrada", motivo_cancelacion: null },
        { id: 3, fecha: "2026-06-05", fecha_hora: "2026-06-05T10:00:00.000Z", sucursal_id: 3, vendedor_id: 4, cliente_id: 0, total: 2100, metodo_pago: "efectivo", estatus: "cerrada", motivo_cancelacion: null },
      ],
      venta_detalle: [
        { id: 1, venta_id: 1, producto_id: 1, cantidad: 20, precio_unitario: 25, descuento: 0, subtotal: 500 },
        { id: 2, venta_id: 2, producto_id: 2, cantidad: 40, precio_unitario: 16, descuento: 0, subtotal: 640 },
        { id: 3, venta_id: 3, producto_id: 3, cantidad: 25, precio_unitario: 32, descuento: 0, subtotal: 800 },
      ],
      historial_ventas_mensual: [],
      vendedores: [
        { id: 1, nombre: "Ana López", sucursal_id: 1, meta_mensual: 50000 },
        { id: 3, nombre: "María R.", sucursal_id: 2, meta_mensual: 50000 },
        { id: 4, nombre: "Pedro L.", sucursal_id: 3, meta_mensual: 50000 },
      ],
      sucursales: [
        { id: 1, nombre: "Ocosingo", ciudad: "Chiapas" },
        { id: 2, nombre: "Yajalón", ciudad: "Chiapas" },
        { id: 3, nombre: "San Cristóbal", ciudad: "Chiapas" },
        { id: 4, nombre: "Palenque", ciudad: "Chiapas" },
        { id: 5, nombre: "MercadoLibre", ciudad: "Online", sin_ubicacion: true },
        { id: 6, nombre: "CEDIS", ciudad: "Chiapas", sin_ubicacion: true },
      ],
      condiciones_pago: [],
      configuracion: null,
      cortes_caja: [],
    },
    crm: {
      clientes: [
        { id: 0, clave: "", nombre: "Público en General", tipo: "menudeo", sucursal_id: 1, estado: "compro", ultimo_contacto: null, limite_credito: 0, saldo: 0, vendedor_asignado_id: null },
        { id: 1, clave: "CLI001", nombre: "Abarrotes Mary", tipo: "mayoreo", sucursal_id: 1, estado: "compro", ultimo_contacto: "2026-06-05", limite_credito: 5000, saldo: 0, vendedor_asignado_id: 1 },
        { id: 2, clave: "CLI002", nombre: "Juan Pérez", tipo: "menudeo", sucursal_id: 2, estado: "compro", ultimo_contacto: "2026-06-25", limite_credito: 0, saldo: 0, vendedor_asignado_id: 3 },
      ],
      contactos_cliente: [],
      oportunidades: [],
    },
    inventario: {
      existencias: [
        { producto_id: 1, sucursal_id: 1, cantidad_actual: 120, cantidad_minima: 30, cantidad_maxima: 300 },
        { producto_id: 2, sucursal_id: 2, cantidad_actual: 80, cantidad_minima: 20, cantidad_maxima: 200 },
        { producto_id: 3, sucursal_id: 3, cantidad_actual: 60, cantidad_minima: 20, cantidad_maxima: 150 },
      ],
      movimientos_inventario: [],
      compras: [],
      compra_detalle: [],
      traspasos: [],
    },
    "catalogo-productos": {
      productos: [
        { id: 1, sku: "AB-001", nombre: "Arroz 1kg", categoria_id: 1, precio_venta: 25, costo: 20, precios: [{ utilidad: 25, precioVenta: 25 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }], activo: true },
        { id: 2, sku: "BE-001", nombre: "Refresco 600ml", categoria_id: 2, precio_venta: 16, costo: 12, precios: [{ utilidad: 33, precioVenta: 16 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }], activo: true },
        { id: 3, sku: "LI-001", nombre: "Detergente 1L", categoria_id: 3, precio_venta: 32, costo: 20, precios: [{ utilidad: 60, precioVenta: 32 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }], activo: true },
      ],
      categorias: [
        { id: 1, nombre: "Abarrotes", categoria_padre_id: null },
        { id: 2, nombre: "Bebidas", categoria_padre_id: null },
        { id: 3, nombre: "Limpieza", categoria_padre_id: null },
      ],
      departamentos: [],
      proveedores: [],
      producto_proveedor: [],
    },
    admin: { roles: [], usuarios: [] },
  };
  sembrarRolesIniciales(DB);
  return DB;
}

module.exports = { construirDBPrueba };
