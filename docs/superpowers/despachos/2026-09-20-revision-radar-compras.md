# Despacho: revisión independiente de `feature/radar-compras`

**Fecha:** 2026-09-20 · **Segunda pasada: 2026-09-22**
**Para:** Codex
**Tipo:** revisión, **SOLO LECTURA**. No implementas, no corriges, no commiteas.

---

## 0. LEE ESTO PRIMERO — segunda pasada

**Tu revisión anterior se cortó.** Nombraste dos puntos que necesitaban reproducción y ahí terminó el
informe: los otros seis del apartado 4 quedaron sin cubrir. Esta pasada es para cerrarlos.

**Los dos que sí nombraste eran REALES.** Claude los reprodujo ejecutando y ya están cerrados en el
commit `bdb2fde`, que es el octavo y último de la rama:

1. Una fila marcada como pedida no caía en ninguna sección y desaparecía de la pantalla, llevándose
   el botón para quitar la marca. El reparto de filas se extrajo a
   `src/radar-demanda/seccionesCompras.js` con 10 pruebas, y lo ya pedido tiene sección propia.
2. Una existencia negativa inflaba la compra (−5 con mínimo 10 pedía 15 piezas y $750). Ahora se
   bloquea con `EXISTENCIA_NEGATIVA`.

**No vuelvas sobre esos dos salvo que el arreglo te parezca mal hecho** — y si te lo parece, dilo,
que para eso estás. Empieza por los seis que faltan y repártete el esfuerzo entre todos, no lo
gastes entero en el primero.

**Si vas a quedarte sin espacio o sin tiempo, entrega lo que lleves con el veredicto parcial y di
expresamente qué puntos no alcanzaste a mirar.** Un informe que se corta sin avisar es peor que uno
corto que lo confiesa: la vez pasada hubo que adivinar qué se había revisado y qué no.

**Estado verificado hoy:** rama `feature/radar-compras` en `bdb2fde`, **8 commits** sobre `master` =
`887770f`, árbol limpio, sin mutaciones vivas. Suite de backend **1730/1730**, pruebas de pantalla
**20/20** (esas se corren aparte, no entran en la suite de `backend/`), eslint **0 errores**,
`vite build` OK.

---

## 1. Por qué te toca a ti

**Todo el código de esta rama lo escribió Claude.** Tú escribiste el plan del módulo, no la
implementación, así que puedes revisarla sin romper la regla de que nadie valida su propio trabajo.

Varios de los defectos que se cerraron aquí **los encontraste tú** verificando el módulo. Esta
revisión es para comprobar si los arreglos de verdad los cierran, y si abrieron algo nuevo.

---

## 2. Dónde

- **Worktree:** `C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/radar-compras-impl`
- **Rama:** `feature/radar-compras`, 7 commits sobre `master` = `887770f`
- **Entorno ya preparado**: las cuatro copias están puestas. No las toques.
- **Pruebas, siempre con las dos banderas y de archivos sueltos:**
  `node --preserve-symlinks --preserve-symlinks-main --test backend/<archivo>.test.js`
  **No corras la suite completa**: desde tu sandbox se arrastra. Claude ya la corrió: **1728/1728 en
  verde, eslint 0 errores, `vite build` OK**. Si crees que ese número es falso, dilo y explica cómo
  comprobarlo.
- **No escribes nada** salvo, si necesitas ejecutar algo para comprobar una afirmación, scripts
  desechables dentro de `scratchpad/`. Prohibido tocar `backend/`, `src/` y la configuración.

## 3. Qué se cambió, en orden

1. `537c8d1` — **Compras ya ve los agotados que nadie capturó en el Radar.** Antes solo se armaba un
   expediente por cada par producto/sucursal presente en `radar_demanda.registros`. Ahora entra
   también el que el inventario señala: faltante (agotado o bajo su mínimo) **con ventas** que
   respalden que se mueve. En `backend/radarDemandaInteligencia.js`.
2. `15eccdf` — **Una venta cancelada ya no acredita una recuperación.** Una sola definición en
   `backend/radar/consultas.js` usada por el selector de candidatas, la validación al vincular y el
   conteo del reporte.
3. `357de4f` — **El filtro de tienda deja de usarse como permiso.** Nuevo `resolverAlcanceAutorizado`
   en `backend/server.js`, aplicado a las CINCO rutas por `:id` del Radar. Las listas y el análisis
   siguen usando el filtro.
4. `29aa49a` — **Fechas dañadas.** Nuevo `backend/radar/fechaRegistro.js`: una fecha que no se
   entiende devuelve `null` en vez de hoy y queda fuera de las ventanas. `backend/fechas.js` no se
   tocó a propósito.
5. `4ae3bd3` — **"Ya lo pedí".** Nuevo `backend/radar/pedidosMarcados.js`, colección propia
   `DB.radar_demanda.pedidos_marcados`, permiso propio `marcar_pedido_proveedor`, tres rutas.
   Silencia la fila 21 días. Decisión de Victor: sin capturar fecha de entrega.
6. `1dc858d` — **La brecha:** `calcularReposicion` en `backend/radarDemandaReglas.js`.
   `piezas = mínimo − existencia − tránsito entrante`; importe = piezas × último costo conocido.
7. `49bb1a3` — **La pantalla:** `src/radar-demanda/GraficosCompras.jsx` nuevo (dos gráficos con
   recharts, que ya estaba instalado), columnas "Faltan" y "Pedido" en `InteligenciaCompras.jsx`.
8. `bdb2fde` — **Tus dos hallazgos de la primera pasada**, ya cerrados. Ver el apartado 0.

## 4. Lo que quiero que mires, en este orden

**Primero, lo que puede costar dinero o inventario:**

1. **¿El candidato nuevo de reposición mete ruido o deja fuera algo que debería entrar?** Mira el
   bucle que agrega claves en `radarDemandaInteligencia.js`. ¿Qué pasa con productos inactivos, con
   existencias negativas, con un producto que vende en una tienda y no en otra, con la sucursal 5
   (MercadoLibre) y la 6 (CEDIS)? ¿Puede crecer tanto que la consulta se vuelva lenta con un catálogo
   real de miles de productos por cinco tiendas?
2. **¿`resolverAlcanceAutorizado` abre algo?** Es lo más delicado de la rama: cambia quién puede
   abrir qué. Comprueba que un usuario amarrado a su tienda no pueda alcanzar registros de otra por
   ninguna de las cinco rutas, ni con ids de texto, ni con `sucursal_id` en el cuerpo, ni con el
   token de otra sucursal. Y que las listas sigan filtrando.
3. **El permiso `marcar_pedido_proveedor`:** ¿está bien dado de alta, la ruta usa el suyo y no uno
   prestado, y el guard de arranque sigue pasando? ¿Alguien sin ese permiso puede marcar por otra
   vía? ¿Puede marcar en una tienda ajena?
4. **`calcularReposicion`:** busca el caso en que dé un número que engañe. Existencia negativa,
   mínimo enorme, tránsito mayor que el mínimo, costos raros. Y confirma que sin `ver_reportes` no se
   filtre ningún importe por ningún camino.

**Después, lo demás:**

5. **¿Las pruebas prueban?** Para cada archivo nuevo, comprueba que **fallarían sin el arreglo**. Hay
   un antecedente en esta misma rama: tres pruebas de `radarDatosInvalidos.test.js` pasaban al
   principio por la razón equivocada (la fecha de prueba era de agosto y el respaldo cae en el día
   real). Busca más casos así.
6. **¿Alguna lectura muta el DB?** Ya pasó una vez aquí: `pedidosMarcados.js` creaba la colección al
   leer y tres pruebas existentes lo atraparon. Verifica que no quede ninguna otra.
7. **Mojibake y líneas largas:** acentos correctos en código e interfaz, y ninguna línea nueva o
   modificada de `.js`/`.jsx` por encima de 200 caracteres.
8. **Dependencias:** cero nuevas. Confirma que `package.json` no se tocó.

## 5. Lo que NO es hallazgo

- Que falte la prueba en navegador: se sabe, está pendiente.
- Que los gráficos sean dos y no los cuatro de tu plan: fue decisión explícita, los otros dos
  necesitan series por semana que la respuesta de hoy no trae, y no se inventaron datos.
- Que el silencio sea de 21 días sin capturar fecha: lo decidió Victor el 2026-09-20.
- Que `apartados.js` siga duplicando guardas o que MercadoLibre no pase por `crearVenta`: es otra
  rama.

## 6. Cómo entregar

Separa siempre **lo que comprobaste ejecutando código** de **lo que solo leíste**. Un hallazgo
ejecutado vale; uno leído es una sospecha que hay que confirmar, y quiero saber cuál es cuál.

Por cada hallazgo: qué pasa, quién lo sufre, qué se ve en pantalla, archivo y línea, cómo lo
comprobaste, y si bloquea el merge o no. Si no encuentras nada en alguno de los ocho puntos, dilo
explícitamente en vez de callarlo.

Y el veredicto en una línea: **¿se puede mergear o no?**
