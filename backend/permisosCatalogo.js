/**
 * permisosCatalogo.js — Catálogo fijo de permisos disponibles en el sistema.
 *
 * Las etiquetas están tomadas directamente de la pantalla de Roles de SICAR
 * que compartiste, para que el personal que ya conoce SICAR no tenga que
 * aprender nombres nuevos.
 *
 * `implementado: true` = el Punto de Venta ya respeta este permiso de verdad
 * (oculta/deshabilita el botón correspondiente).
 * `implementado: false` = el permiso existe y se puede asignar, pero el
 * módulo correspondiente todavía no está construido — se deja aquí para que
 * la pantalla de Roles ya esté completa y no haya que rediseñarla después.
 */

const PERMISOS = [
  // ---- Punto de Venta ----
  { clave: "abrir_cajon_dinero", etiqueta: "Abrir Cajón de Dinero", modulo: "pos", implementado: true },
  { clave: "agregar_articulo_rapido", etiqueta: "Agregar Artículo Rápido", modulo: "pos", implementado: true },
  { clave: "agregar_nota_credito_venta", etiqueta: "Agregar Nota de Crédito a la Venta", modulo: "pos", implementado: true },
  { clave: "aplicar_abonos_clientes", etiqueta: "Aplicar Abonos a Clientes", modulo: "pos", implementado: false },
  { clave: "aplicar_descuentos_articulos_venta", etiqueta: "Aplicar Descuentos a Artículos de la Venta", modulo: "pos", implementado: true },
  { clave: "buscar_articulos", etiqueta: "Buscar Artículos", modulo: "pos", implementado: true },
  { clave: "cambiar_cliente", etiqueta: "Cambiar Cliente", modulo: "pos", implementado: true },
  { clave: "cambiar_moneda_venta", etiqueta: "Cambiar Moneda en Venta", modulo: "pos", implementado: false },
  { clave: "cambiar_numero_precio", etiqueta: "Cambiar Número de Precio", modulo: "pos", implementado: true },
  { clave: "cambiar_tipo_documento", etiqueta: "Cambiar Tipo de Documento", modulo: "pos", implementado: true },
  { clave: "cambiar_vendedor", etiqueta: "Cambiar Vendedor", modulo: "pos", implementado: true },
  { clave: "cargar_cotizacion", etiqueta: "Cargar Cotización", modulo: "pos", implementado: true },
  { clave: "cerrar_venta", etiqueta: "Cerrar Venta", modulo: "pos", implementado: true },
  { clave: "cerrar_venta_masiva_credito", etiqueta: "Cerrar Venta Masiva a Crédito", modulo: "pos", implementado: false },
  { clave: "checador_precios", etiqueta: "Checador de Precios", modulo: "pos", implementado: false },
  { clave: "editar_caracteristicas_articulo_venta", etiqueta: "Editar Características en Venta", modulo: "pos", implementado: false },
  { clave: "editar_descripcion_venta", etiqueta: "Editar Descripción en Venta", modulo: "pos", implementado: true },
  { clave: "imprimir_ultimo_documento", etiqueta: "Imprimir Último Documento", modulo: "pos", implementado: true },
  { clave: "modificar_fecha_venta", etiqueta: "Modificar Fecha de Venta", modulo: "pos", implementado: false },
  { clave: "poner_ticket_en_espera", etiqueta: "Poner Ticket en Espera", modulo: "pos", implementado: true },
  { clave: "cancelar_ticket", etiqueta: "Cancelar Ticket", modulo: "pos", implementado: true },

  // ---- Consultas de Ventas (calcado de la pantalla de Roles de SICAR) ----
  { clave: "ver_lista_ventas", etiqueta: "Recargar/Ver Lista de Ventas", modulo: "pos", implementado: true },
  { clave: "mostrar_detalle_venta", etiqueta: "Mostrar el Detalle de la Venta", modulo: "pos", implementado: true },
  { clave: "cancelar_ventas", etiqueta: "Cancelar Ventas", modulo: "pos", implementado: true },
  { clave: "exportar_ventas", etiqueta: "Exportar Factura(s)", modulo: "pos", implementado: true },
  { clave: "imprimir_ventas", etiqueta: "Imprimir Ventas", modulo: "pos", implementado: true },
  { clave: "aplicar_abonos_clientes_venta", etiqueta: "Aplicar Abonos a Clientes", modulo: "pos", implementado: false },
  { clave: "consultar_estado_cfdi", etiqueta: "Consultar Estado de Facturas CFDI", modulo: "pos", implementado: false },
  { clave: "editar_parametros_cancelacion", etiqueta: "Editar Parámetros de Cancelación de Documentos", modulo: "pos", implementado: false },
  { clave: "enviar_factura_email", etiqueta: "Enviar Factura por eMail", modulo: "pos", implementado: false },
  { clave: "liberar_sicar_pago", etiqueta: "Liberar SICAR Pago", modulo: "pos", implementado: false },
  { clave: "modificar_comentario_venta", etiqueta: "Modificar Comentario de Venta", modulo: "pos", implementado: false },
  { clave: "modificar_vendedor_venta", etiqueta: "Modificar Vendedor (de una venta ya cerrada)", modulo: "pos", implementado: false },
  { clave: "mostrar_ventas_todos_vendedores", etiqueta: "Mostrar Ventas de todos los Usuarios/Vendedores", modulo: "pos", implementado: false },
  { clave: "mostrar_acuse_cancelacion_cfdi", etiqueta: "Mostrar el Acuse de Cancelación de la Factura CFDI", modulo: "pos", implementado: false },
  { clave: "mostrar_documentos_origen_factura", etiqueta: "Mostrar los Documentos a partir de los cuales se Generó la Factura", modulo: "pos", implementado: false },
  { clave: "cancelar_sin_autenticacion", etiqueta: "Permitir Cancelar Ventas sin Autenticación de Usuario con Privilegios", modulo: "pos", implementado: false },
  { clave: "ver_xml_cfdi", etiqueta: "Ver XML del CFDI", modulo: "pos", implementado: false },
  { clave: "editar_configuracion_pos", etiqueta: "Editar Configuración del Punto de Venta", modulo: "pos", implementado: true },

  // ---- Corte de Caja ----
  { clave: "realizar_corte_caja", etiqueta: "Realizar Corte de Caja", modulo: "corte", implementado: true },
  { clave: "ver_historial_cortes", etiqueta: "Ver Historial de Cortes de Caja", modulo: "corte", implementado: true },
  { clave: "ver_montos_corte", etiqueta: "Ver Montos Calculados en el Corte de Caja", modulo: "corte", implementado: true },
  { clave: "registrar_propina", etiqueta: "Registrar Propina (restaurante)", modulo: "pos", implementado: false },

  // ---- Inventario y Productos ----
  { clave: "crear_producto", etiqueta: "Agregar Artículo", modulo: "inventario", implementado: true },
  { clave: "editar_producto", etiqueta: "Editar Artículo", modulo: "inventario", implementado: true },
  { clave: "eliminar_producto", etiqueta: "Eliminar Artículo", modulo: "inventario", implementado: true },
  { clave: "clonar_producto", etiqueta: "Clonar Artículo", modulo: "inventario", implementado: true },
  { clave: "ajustar_existencia", etiqueta: "Ajustar Inventario", modulo: "inventario", implementado: true },
  { clave: "realizar_traspasos", etiqueta: "Realizar Traspasos entre Sucursales", modulo: "inventario", implementado: true },
  { clave: "recibir_compra", etiqueta: "Recibir Compras a Proveedor", modulo: "inventario", implementado: true },

  // ---- Clientes (dentro de CRM / catálogo de clientes) ----
  { clave: "crear_cliente", etiqueta: "Agregar Cliente", modulo: "crm", implementado: true },
  { clave: "editar_cliente", etiqueta: "Editar Cliente", modulo: "crm", implementado: false },
  { clave: "cambiar_estado_cliente", etiqueta: "Cambiar Estado de Pipeline", modulo: "crm", implementado: true },
  { clave: "registrar_contacto_cliente", etiqueta: "Registrar Contacto con Cliente", modulo: "crm", implementado: true },
  { clave: "enviar_campana_masiva", etiqueta: "Enviar Campaña Masiva", modulo: "crm", implementado: true },

  // ---- Administración ----
  { clave: "administrar_roles", etiqueta: "Administrar Roles y Personal", modulo: "admin", implementado: true },
  { clave: "dar_alta_personal", etiqueta: "Dar de Alta Personal", modulo: "admin", implementado: true },
  { clave: "usar_asistente_ia", etiqueta: "Usar el Asistente de IA del Inicio", modulo: "admin", implementado: true },
  { clave: "ver_todas_las_sucursales", etiqueta: "Ver Todas las Sucursales", modulo: "admin", implementado: true },

  // ---- MercadoLibre ----
  { clave: "gestionar_publicaciones_ml", etiqueta: "Publicar y Editar en MercadoLibre", modulo: "ml", implementado: true },
  { clave: "importar_ordenes_ml",        etiqueta: "Importar Órdenes de MercadoLibre",  modulo: "ml", implementado: true },
  { clave: "conectar_cuenta_ml",         etiqueta: "Conectar / Desconectar Cuenta ML",  modulo: "ml", implementado: true },
];

const MODULOS_SISTEMA = [
  { id: "pos",       nombre: "Punto de Venta" },
  { id: "corte",     nombre: "Corte de Caja" },
  { id: "inventario", nombre: "Inventario y Productos" },
  { id: "crm",       nombre: "Clientes" },
  { id: "admin",     nombre: "Roles y Personal" },
  { id: "ml",        nombre: "MercadoLibre" },
];

function listarPermisos() {
  return PERMISOS;
}

function listarModulosSistema() {
  return MODULOS_SISTEMA;
}

module.exports = { listarPermisos, listarModulosSistema, PERMISOS, MODULOS_SISTEMA };
