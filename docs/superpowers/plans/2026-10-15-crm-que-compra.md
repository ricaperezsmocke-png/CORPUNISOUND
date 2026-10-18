# Plan: CRM qué compra, VIP y cuentas internas

Fecha: 2026-10-15. Rama: `feature/crm-que-compra`. HEAD inicial: `e470699`.
Contrato: `docs/superpowers/despachos/2026-10-15-crm-que-compra.md`.
Spec: `docs/superpowers/specs/2026-10-15-crm-que-compra-vip-design.md`.

## Secuencia y reglas

Este documento se commitea solo antes de implementar. Cada tarea lleva un commit sin acentos.
Primero se escriben sus pruebas, se ejecutan y se registra el fallo esperado; después se implementa
y se ejecutan las mismas pruebas y las regresiones afectadas. No se agregan dependencias.
Todas las pruebas se ejecutan desde `backend/` con
`node --preserve-symlinks --preserve-symlinks-main --test` y archivos explícitos durante las tareas.
La petición expresa de Victor autoriza los commits y la suite completa final en este worktree.
No hay push, merge, rebase ni staging global. No se modifica la base de datos del negocio.

## Tarea 1: almacenamiento de cuentas internas y respaldo

Archivos: `backend/sicarRepositorio.js`, `backend/sicarRespaldo.js`, módulo nuevo
`backend/crmCuentasInternas.js` y sus pruebas bajo `backend/`.

Pruebas rojas: tablas nuevas, marcado y desmarcado SICAR con historial atómico, conflicto sin historial,
restauración de respaldo nuevo y de generaciones de 10 y 12 tablas. Comprobar rollback ante fallo.
Implementar tablas y operaciones transaccionales; extender la validación de generaciones del respaldo.
Terminado: pruebas nuevas y regresiones de repositorio y respaldo pasan sin cambiar `respaldos.js`.

## Tarea 2: VIP y exclusión de cuentas internas en consultas

Archivos: `backend/crmFuentes.js` y pruebas nuevas o existentes de consultas CRM bajo `backend/`.

Pruebas rojas: umbrales de 2 000 000 y 1 999 999 centavos; días 365 y 366; canceladas y excluidas;
POS más identidades SICAR unidas; interna nunca VIP; filtro `vip=1` combinado y rechazo de otros valores.
Probar que internas siguen visibles pero no suman clientes, compradores ni montos de lista y resumen por tienda.
Implementar ventana con fecha local, suma SICAR en consulta agregada y marca heredada del nativo.
Terminado: casos nuevos y regresiones CRM pasan; score y segmento conservan sus reglas.

## Tarea 3: desglose de qué compra

Archivos: módulo nuevo `backend/crmQueCompra.js`, `backend/crmFuentes.js` y sus pruebas bajo `backend/`.

Pruebas rojas: categorías POS por catálogo y SICAR por SKU recortado; sin categoría; unión de artículos
POS y SICAR; descripción normalizada sin clave; top 20 por monto; fecha más reciente; cantidad SICAR
no finita suma cero piezas y conserva importe; ventas no vigentes excluidas; cuadre con descuentos
globales; total idéntico al de ficha; persona fuera de alcance devuelve 404.
Implementar agregación histórica y ajustes como diferencia exacta, sin modificar dinero.
Terminado: pruebas pasan y los importes fuente son compatibles con el supuesto del spec.

## Tarea 4: escritura de cuentas internas y rutas

Archivos: `backend/crmCuentasInternas.js`, `backend/crmFuentes.js`, módulo nuevo de rutas si es necesario,
`backend/permisosCatalogo.js` (solo permiso nuevo), `backend/server.js` (solo registro junto a CRM v2
y semilla `cuentas_internas_historial: []`), y pruebas bajo `backend/`.

Pruebas rojas: permiso propio con permisos vecinos; otra tienda devuelve 404 aunque query sugiera otra;
IDs de cuerpo normalizados cuando corresponda; booleano estricto; motivos recortados de 3 a 200;
conflictos 409 sin historial; dos cambios dejan usuario, motivo, anterior y nuevo; ficha devuelve nombre
del usuario y últimos 20 cambios; identidad unida se representa por nativo. Ruta de qué compra protegida.
Implementar persistencia nativa e historial, validación y rutas con alcance desde token.
Terminado: pruebas nuevas, permisos y rutas CRM pasan; Administrador recibe permiso por reconciliación.

## Tarea 5: lista y ficha

Archivos: `src/CRMListaClientes.jsx`, `src/CRMFichaCliente.jsx`, componentes nuevos bajo `src/`
y sus pruebas bajo `backend/`, usando las herramientas ya instaladas.

Pruebas rojas: filtro Solo VIP y etiquetas, monto en 12 meses, categorías y artículos, ajuste visible solo
si no es cero, permiso del botón, motivo y actualización de ficha, historial y totales tras cambiar marca.
Cubrir errores y respuestas tardías al cambiar de cliente según los patrones existentes.
Implementar interfaz en español con UTF-8 y sin nombres que difieran solo por mayúsculas de existentes.
Terminado: pruebas pasan; navegador queda a cargo de Claude, como ordena el despacho.

## Verificación final y entrega

Ejecutar suite backend completa con ambas banderas, `npx eslint src backend`, revisar diff,
longitud máxima de 200 caracteres en JS/JSX tocados y `git status`. Registrar números exactos
de pruebas, TODO, fallas y eslint. Entregar commits y archivos tocados, limitaciones y pendientes
de revisión independiente y navegador por Claude. No atribuir resultados no ejecutados.

## Condiciones de paro

Detener y reportar ante archivo prohibido necesario, dependencia nueva, regla de negocio no escrita
o contradicción entre spec y código, incluidos importes SICAR y compatibilidad de respaldos.
Si Git no permite el commit por `index.lock`, conservar el trabajo en el árbol e informar;
no eludir el sandbox ni escribir fuera del worktree.
