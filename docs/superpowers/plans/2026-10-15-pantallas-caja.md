# Reanudacion 2026-10-15 — parada de alcance antes de implementar

Estado comprobado: rama `feature/pantallas-caja`, HEAD `33fe15f`, arbol inicialmente limpio.
La seccion 3b resuelve la decision de negocio anterior: importar ML sigue permitido y su corte
siempre funciona. No se reabre esa decision. El documento anterior se conserva debajo como historial;
sus prohibiciones de suite completa y su politica ML pendiente ya no son vigentes.

## Impedimento tecnico dentro de los archivos autorizados

- `backend/mercadolibre.js:20` declara `const SUCURSAL_ML = 5`, privada al modulo.
- La importacion usa ademas literales: `cajaPredeterminadaDeSucursal(DB, 5)` en linea 494 y
  `sucursal_id: 5` en linea 505.
- `backend/mercadolibre.js:567-571` no exporta la constante ni un resolver de sucursal.
- El spec exige identificar ML como lo hace ese modulo, sin introducir otro numero fijo.
- El despacho autoriza una lista cerrada de archivos y prohibe todo lo demas: `mercadolibre.js`
  no esta autorizado. No se copiara el 5, no se inferira por nombre ni por ventas previas, y no se
  analizara el texto del fuente desde el producto para extraer una constante.

Para desbloquear: ampliar expresamente el alcance para exponer la identidad existente desde
`backend/mercadolibre.js`, y usarla tambien en la importacion donde hoy hay literales. No requiere
cambiar la decision de negocio ni dependencias. Esta modificacion NO se ha hecho.

Condicion aplicable del despacho: detenerse si hace falta un archivo prohibido. Por eso no se
presenta este documento como plan ejecutable completo ni se inicia TDD de producto.

## Inventario comprobado en 33fe15f

Las rutas y lineas de la tabla historica inferior siguen vigentes. La fila 3351 ahora tiene la
excepcion expresa de la seccion 3b, sin interruptor. Ademas se reviso:

- `POST /api/ml/pendientes-vinculo/:id/vincular`, `backend/server.js:3362`: llama a
  `resolverPendienteVinculo` (`backend/mercadolibre.js:381-422`); cambia producto del detalle e
  inventario, no importe, caja, estado ni sello del movimiento monetario. No se bloquea.
- `POST /api/cortes`, linea 2142: corte_caja con excepcion ML; alcance y caja deben ser los mismos
  que usa crearCorte, normalizando ids de texto y sin confiar en el cuerpo para el usuario.
- No se encontraron rutas HTTP de apertura, cotizaciones ni tickets en espera.
- La configuracion general (PUT, linea 2116) acepta un merge arbitrario: la implementacion debe
  proteger pantallas e historial para evitar saltarse el permiso nuevo.

## Verificacion de esta reanudacion

- Pruebas existentes focalizadas: cajas.test.js y mercadolibreCorteCaja.test.js, 22 pasan / 0 fallan,
  ejecutadas con ambas banderas de symlinks.
- Suite completa: iniciada desde backend con ambas banderas por instruccion expresa de Victor.
- ESLint ejecutado con Node y ambas banderas sobre src backend: 0 errores, 743 advertencias. npx fallo por EPERM.
- Staging rechazado: Permission denied al crear .git/worktrees/pantallas-caja/index.lock. Sin commits nuevos; no se intento rodearlo.
- Sin pruebas nuevas, sin ciclo TDD iniciado, sin modificaciones de producto.
- Navegador y revision independiente quedan a Claude segun el despacho.

---

## Registro historico del intento anterior (no ejecutable)
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
