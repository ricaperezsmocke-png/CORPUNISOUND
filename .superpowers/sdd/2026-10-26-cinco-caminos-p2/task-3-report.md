# Task 3 report: pantalla Manual de tacticas

Implementado: src/metas/manualTacticas.js (logica pura), manualTacticas.test.js (9 pruebas), ManualTacticas.jsx (pantalla),
CincoCaminos.jsx (boton "Manual de tacticas" junto a Categorias; estado unico tablero|manual|categorias).

Pantalla: lista agrupada por camino, nombre/descripcion/quien/numero (nombres del tablero)/candado/medicion/PDF, etiqueta de la
tienda + "Probada en N tiendas", filtro de camino, "Mostrar retiradas" apagado, Nueva/Editar/Retirar(motivo)/Reactivar solo con
administrar_manual_tacticas, Historial, nota de excluidas. Modales propios con <form onSubmit>, scroll (max-h-[90vh] overflow-y-auto)
y botones type="submit". Selects/checkboxes con valores del catalogo. No existe control de etiqueta; los cuerpos nunca llevan `etiquetas`.
PUT solo manda campos cambiados.

TDD: RED = con el modulo ausente, `node --test src/metas/manualTacticas.test.js` -> ERR_MODULE_NOT_FOUND, pass 0 fail 1
(la prueba se escribio junto con el modulo; el RED se comprobo moviendo el modulo). GREEN: 9/9.
Pruebas: `node --test src/metas/` 62 pass 0 fail; `npx vite build` OK; `npx eslint src backend` 0 errores (826 warnings preexistentes).
No corri suites de backend/agente-sicar (no toque backend). Sin lineas >200 en src/metas.

Hallazgos / dudas:
- Nombres en historial: GET /usuarios exige administrar_roles; no hay via limpia. Se muestra "Usuario #N" ("El sistema" si usuario_id null).
  entradaHistorial ya acepta un resolvedor de nombres si luego hay endpoint.
- Servidor: nada raro que cambiar. Observacion: la tarjeta de numero que mueve incluye margen/descuento_promedio con rotulo "(fase 3)".
- Sin prueba en navegador (la hace el controlador). Un solo boton "Manual de tacticas" visible a todo el que ve Cinco Caminos.

## Fix report (commit fix sobre 2c7b0f7)

1. NOMBRES_NUMERO ahora incluye registros_por_10_tickets ("Registros al Radar por cada 10 tickets"). Prueba nueva compara claves de
   NUMEROS, CAMINOS, QUIEN y MEDICIONES contra backend/cincoCaminos/manual.js (createRequire, funciona en src).
2. GET manual/:id/historial agrega usuario_nombre (de DB.admin.usuarios, Number(id)); borrado -> "Usuario #N (ya no existe)"; null -> null.
   No se guarda en la base. La pantalla muestra usuario_nombre o "El sistema". Prueba de ruta nueva (rutas.test.js). RED: fallaba antes
   de implementar; GREEN 10/10.
3. numero_v1 se rotula "Número en el manual v1"; cualquier clave desconocida sale como "Otro dato", nunca cruda. Prueba nueva.
4. "PDF: PDF 1" ahora "Hoja: PDF 1".
5. Alta: camino, numero y como_se_mide arrancan en "Elige…", quien vacio, errorDelFormulario dice que falta. Editar sigue precargado.
Pruebas: node --test src/metas/ 65/0; backend node --test cincoCaminos/ 51/0 (no corri la suite completa de backend); build OK; eslint 0 errores.

## Fix final

- reconciliarRestauracion.js: reconciliarTrasRestaurar ahora llama a sembrarManual(db) tras asegurarChecklistInicial. Una foto sin `tacticas` queda con 30; un manual corregido no se toca. validarAntesDeRestaurar (ensayo sobre copia) lo cubre porque llama a la misma funcion; prueba agregada (no muta la foto original).
- cincoCaminos/manual.js: `e && e.estado` en probada_en (etiqueta null ya no revienta).
- Pruebas nuevas: 3 en reconciliarRestauracion.test.js, 1 en manual.test.js.
- RED: `node --test reconciliarRestauracion.test.js cincoCaminos/` -> 62 pass, 2 fail (etiqueta null; foto sin tacticas).
- GREEN: mismo comando -> 64 pass, 0 fail. Suite backend completa: 3339 tests, 3337 pass, 0 fail (2 TODO preexistentes del radar). eslint src backend: 0 errores (826 warnings preexistentes).
