# Pantallas de caja — plan detenido durante el inventario

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar tarea por tarea cuando se resuelva la condición de parada. Este documento todavía no es un plan ejecutable completo.

**Goal:** Permitir apagar las cinco pantallas del spec con validación en servidor y constancia de cada cambio, sin dejar movimientos pendientes sin corte.

**Architecture:** Un módulo nuevo `backend/pantallasCaja.js` resolverá los booleanos, dependencias e historial. Las rutas HTTP aplicarán el bloqueo; la consulta de movimientos pendientes reutilizará `calcularCorteEnCurso`, que usa `esDeEstaCaja`. La interfaz leerá el estado persistido.

**Tech Stack:** Node, Express y React existentes; pruebas con `node:test`, sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-10-15-pantallas-caja-design.md`.

## Estado y restricciones

- Verificado: rama `feature/pantallas-caja`, HEAD `02bcbaf`, árbol inicialmente limpio.
- Leídos completos: AGENTS.md, CLAUDE.md, despacho y spec.
- No modificar archivos prohibidos ni la zona CRM de `backend/server.js`.
- Pruebas con ambas banderas de symlinks. No ejecutar suite completa en este worktree.
- Sin push, merge, rebase ni staging general. Mensajes de commit sin acentos.
- No se ha escrito código de producto ni pruebas nuevas: el despacho exige detenerse antes de implementar si una ruta no encaja en un interruptor.

## Condición de parada encontrada

`POST /api/ml/ordenes/:ordenId/importar`, en `backend/server.js:3351`, llama a `importarOrdenComoVenta`.
Esta función crea una venta cerrada de la sucursal 5, con caja y fecha de incorporación a la contabilidad
(`backend/mercadolibre.js:492-526`). El corte la incluye como venta y registra el importe en transferencias,
sin sumarlo al efectivo. Al cerrar el corte, la venta recibe `corte_id` como las demás ventas.

El spec, sección 2, dice que «MercadoLibre […] no cambian». La regla 7 exige incluir y reportar otras rutas
que creen movimientos de caja. El despacho exige asignar cada ruta a un interruptor y detenerse si alguna
no encaja. No hay asignación explícita ni excepción para esta ruta de MercadoLibre.

Asignarla a `punto_venta` cambiaría MercadoLibre; dejarla libre permitiría incorporar nuevas ventas al corte
con `corte_caja` apagado. No se decide ninguna de las dos políticas. Hace falta definir en el encargo cómo
convive la importación de MercadoLibre con los interruptores y con el corte apagado.

Evidencia ejecutada: `backend/mercadolibreCorteCaja.test.js` comprueba una importación de $375:
`ventas_incluidas === 1`, `transferencias === 375`, `calculado.EFECTIVO === 0`.
No se afirma que ese importe sea efectivo ni un faltante de cajera.

## Inventario de rutas hasta la parada

Líneas de `backend/server.js` en HEAD `02bcbaf`. Incluye las rutas expresamente pedidas aunque no todas
alteren el efectivo del corte (categorías, comprobantes y depósitos).

| Línea | Método y ruta | Interruptor |
|---|---|---|
| 1907 | POST /api/ventas | punto_venta |
| 1923 | PUT /api/ventas/:id/cancelar | punto_venta; también cancela apartados |
| 1960 | PUT /api/ventas/:id/caja | punto_venta |
| 1977 | POST /api/apartados | punto_venta |
| 1988 | POST /api/apartados/:id/abonos | punto_venta |
| 1999 | PUT /api/apartados/:id/cancelar | punto_venta |
| 2082 | POST /api/garantias/:id/gastos | dinero_garantias_caja para gastos en efectivo |
| 2092 | DELETE /api/garantias/:id/gastos/:gastoId | dinero_garantias_caja cuando elimina un gasto en efectivo pendiente |
| 2106 | POST /api/garantias/:id/cobros | dinero_garantias_caja |
| 2142 | POST /api/cortes | corte_caja |
| 2167 | POST /api/gastos | gastos_caja |
| 2209 | PUT /api/gastos/:id/origen | gastos_caja |
| 2218 | PUT /api/gastos/:id/cancelar | gastos_caja |
| 2241 | POST /api/gastos/categorias | gastos_caja |
| 2246 | PUT /api/gastos/categorias/:id | gastos_caja |
| 2272 | POST /api/depositos | depositos |
| 2283 | POST /api/depositos/:id/comprobante | depositos |
| 2290 | PUT /api/depositos/:id/cancelar | depositos |
| 3351 | POST /api/ml/ordenes/:ordenId/importar | SIN ASIGNACIÓN: condición de parada |

La búsqueda en `backend/server.js` no encontró rutas de apertura de caja, cotizaciones ni tickets en espera.
Se rastrearon `corte_id`, `caja_id`, `esDeEstaCaja` y las inserciones de ventas, abonos, cobros y gastos de garantías.
El inventario queda detenido por la ruta indicada; no se declara una auditoría exhaustiva terminada.

## Secuencia pendiente tras resolver el alcance

Estas tareas deberán detallarse con interfaces y pruebas exactas antes de iniciar implementación:

- [ ] Completar y commitear el plan con la asignación o excepción explícita de MercadoLibre.
- [ ] Booleanos, dependencias, configuración e historial: pruebas rojas antes del módulo nuevo y de modificar `backend/configuracion.js`.
- [ ] Dinero pendiente: pruebas rojas de movimientos por sucursal/caja, históricos sin caja, ids de texto y movimientos cuyo neto sea cero; reutilizar el cálculo existente.
- [ ] Permiso y rutas HTTP: pruebas rojas por ruta apagada/encendida, GET accesibles, permiso vecino insuficiente, registro de usuario del token y catálogo de arranque válido.
- [ ] Menú, Dashboard y acceso directo: pruebas rojas antes de editar los archivos autorizados y añadir componentes de pantalla.
- [ ] Panel de configuración y controles de Garantías: pruebas rojas de visibilidad, motivos de rechazo e historial antes de implementar.
- [ ] Verificar pruebas focalizadas, eslint, longitud de líneas y diff; un commit por tarea. Navegador y suite completa quedan a Claude según las reglas del encargo.

## Focos de revisión al completar el plan

1. Importaciones de MercadoLibre mientras corte está apagado: política pendiente, no inferirla.
2. Movimientos de ingreso y egreso con neto cero: no confundir saldo cero con ausencia de movimientos.
3. Venta histórica sin caja: conservar su pertenencia a Administrativa mediante la regla existente.
4. Peticiones de dinero con esperas asíncronas: verificar el efecto de un apagado concurrente antes de decidir mecanismos dentro del alcance permitido.
5. Configuración general: impedir que su PUT permita saltarse el nuevo permiso o reescribir el historial.

## Verificación realizada antes de detenerse

```text
node --preserve-symlinks --preserve-symlinks-main --test backend/mercadolibreCorteCaja.test.js backend/cajas.test.js
tests 22
pass 22
fail 0
```

No hay pruebas nuevas ni ciclo TDD iniciado. No se ejecutó la suite completa (prohibida en worktree);
las cinco fallas de entorno indicadas por el despacho no se reprodujeron ni se tocaron.
