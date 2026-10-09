# Metas personalizadas (KPIs y OKRs) y eliminar metas — Diseño Fase 1

**Fecha:** 2026-10-08 · **Aprobado por Victor:** 2026-10-08 ("si apruebo el plan y si construye encima")
**Rama:** `feature/metas-personalizadas`, sale de `feature/objetivos-inventarios` @ `10a8fc9`
(inventarios rotativos, aún sin subir a producción).

## 1. Para qué

Victor quiere crear, desde una pantalla, metas nuevas para cada tienda —sin que haya que programar cada
tipo—, agruparlas en OKRs (un objetivo con varios resultados clave), editarlas, eliminarlas y darles
seguimiento en un tablero. Primer caso de uso: **metas de videos** (videos de tips, videos por persona,
videos por tienda, videos de seguimiento a productos elegidos). Otros ejemplos: reseñas en Google,
visitas a escuelas e iglesias, talleres en tienda, llamadas de seguimiento, revisión de exhibición.

Hoy el módulo de Objetivos solo conoce tipos fijos (`backend/objetivos.js:10`: venta, actividad, marca,
producto, credito, inventario) y **no permite eliminar una meta**: `fijarObjetivo`
(`backend/objetivos.js:57`) solo crea versiones nuevas; lo más que deja es ponerla en 0 y sigue
apareciendo.

**Fase 1 (este diseño): solo metas de captura manual.** Fase 2 (fuera de alcance): conectar SICAR y
metas que el sistema mide solo.

## 2. Decisiones de Victor (no volver a preguntar)

| Tema | Decisión |
|---|---|
| Quién crea/edita/elimina metas y OKRs | Solo el administrador. Cada cambio queda registrado. |
| Alcance de una meta | Tienda, persona o empresa. |
| Periodos | Semanal, mensual y trimestral. |
| Cierre | Cada periodo se sella al terminar. Después nadie cambia la meta ni las capturas; solo rectificación con motivo. |
| Captura | La persona marca "Hecho" y adjunta la prueba; con eso cuenta, sin aprobación previa. |
| Prueba | El admin la elige por meta: sin prueba, liga (TikTok, Facebook, Instagram, YouTube u otra red) o foto. |
| Avance del OKR | Promedio simple de sus resultados clave. |
| Eliminar | Se puede eliminar una meta (las fijas actuales y las nuevas). |
| Base | Construir encima de inventarios rotativos. |

## 3. Reglas que protegen contra pérdidas

- **Eliminar = retirar con motivo, nunca borrar del registro.** Si se borrara, alguien podría desaparecer
  una meta incumplida y maquillar el resultado. La meta retirada desaparece del avance, el tablero y el
  cierre; el historial la muestra tachada, con quién la retiró, cuándo y por qué. Solo en periodo
  ABIERTO. Las capturas ya hechas no se borran.
- **Una liga no cuenta dos veces**, en ninguna meta ni en ninguna persona. Se compara normalizada: solo
  `http(s)`, dominio en minúsculas y sin `www.`, sin parámetros de rastreo (`utm_*`, `fbclid`, `igshid`,
  `si`, `t`, `s`, `_r`, `is_from_webapp`, `sender_device`), sin `#` y sin `/` final. Nota: el servidor NO puede
  comprobar que el video exista; la revisión es humana con un clic en la liga.
- **Foto:** se reutiliza la subida a Drive con huella anti-reuso de actividades
  (`backend/objetivosActividades.js:44,66,102,131`). Nada se guarda en el disco de Render.
- **Nadie captura a nombre de otro.** Meta de persona: solo esa persona. Meta de tienda: el personal
  que ese día está en la plantilla de esa tienda (`validarFechaYPlantilla`,
  `backend/objetivosFechas.js:18`). Meta de empresa: solo los participantes que el admin eligió.
- **Anular una captura:** encargado/gerente/admin con permiso nuevo `anular_capturas_metas`, motivo
  obligatorio, queda a su nombre. Quien capturó puede anular lo suyo solo mientras el periodo está
  abierto. Periodo sellado: nadie anula.
- **Editar una meta de periodo abierto crea una versión nueva** (patrón de `backend/objetivos.js:96`);
  el historial muestra antes/después, autor (id y nombre) y motivo (obligatorio en toda edición). Una
  meta de periodo sellado no se edita.
- **Sello:** congela definición, cifra meta, capturas y resultado. Las rectificaciones posteriores solo
  corrigen el resultado capturado (NO la cifra meta, a diferencia del cierre actual
  `backend/objetivosCierre.js:246`), con motivo, conservando el valor original sellado.
- **Privacidad:** la vendedora ve lo suyo completo y lo de su tienda solo en porcentaje
  (misma regla que `backend/objetivosAvance.js:125,167`), también en el historial.
- **Fechas en hora de Chiapas** (`fechaLocal` de `backend/fechas.js`); no se captura en fecha futura.
- **Todo se valida en el servidor.** La pantalla solo refleja.

## 4. Datos (colecciones nuevas en `DB.pos`, `backend/server.js:192`)

Se persisten solas con el JSON de SQLite (`backend/persistencia.js`); bases anteriores sin estas
colecciones arrancan con arreglos vacíos.

- **`okrs`**: id, titulo, descripcion, periodo (`semanal|mensual|trimestral`), inicio (fecha del primer
  día del periodo), alcance (`tienda|persona|empresa`), sucursal_id, vendedor_id, participantes
  (ids de vendedores, solo empresa), version, vigente, retirada {por_id, por_nombre, en, motivo} | null,
  creado_por_id, creado_por, creado_en, reemplaza_a, motivo.
- **`metas_personalizadas`**: id, okr_id (opcional; una meta puede vivir sola), nombre, descripcion,
  unidad (texto libre: "videos", "reseñas", "visitas"), prueba (`ninguna|liga|foto`), valor_meta
  (entero > 0), periodo, inicio, alcance, sucursal_id, vendedor_id, participantes, version, vigente,
  retirada, creado_por_id, creado_por, creado_en, reemplaza_a, motivo.
  Una meta con OKR hereda periodo y alcance del OKR (se valida que coincidan).
- **`meta_capturas`**: id, meta_id (de la versión vigente al capturar; el avance agrupa por la cadena
  de versiones), fecha, vendedor_id, sucursal_id, cantidad (1 si la meta pide liga o foto; entero
  1–1000 si es "sin prueba"), liga, liga_normalizada, foto {drive_id, huella}, nota, creado_por_id,
  creado_en, anulada {por_id, por_nombre, en, motivo} | null.
- **`meta_sellos`**: id, periodo, inicio, alcance_sellado (sucursal_id o empresa), sellado_por_id,
  sellado_por, sellado_en, foto (copia profunda de OKRs, metas vigentes, capturas válidas y resultados),
  rectificaciones [{id, meta_id, valor_anterior (leído del sello), valor_nuevo, motivo, por, en}].

**Periodos:** semana = lunes a domingo; mes = calendario; trimestre = ene–mar, abr–jun, jul–sep,
oct–dic. `inicio` siempre es el primer día del periodo; el servidor lo valida.

**Avance:** resultado clave = suma de cantidades de capturas no anuladas / valor_meta, topado a 100%.
OKR = promedio simple de sus resultados clave vigentes (retirados no cuentan). Semáforo contra el ritmo
esperado del periodo (días transcurridos / días del periodo): verde ≥ ritmo, amarillo ≥ 70% del ritmo,
rojo debajo.

## 5. Permisos (`backend/roles.js`)

- `administrar_metas_personalizadas` — crear, editar, retirar metas y OKRs, sellar y rectificar.
  Solo Administrador.
- `anular_capturas_metas` — anular capturas ajenas de su alcance. Administrador y Gerente.
- Capturar y ver "Mis metas": `usar_gerente_ventas` (el mismo que ya usa el personal en Objetivos).
- Retirar metas FIJAS actuales: `editar_objetivos_venta` (el que ya las crea), mes abierto.

## 6. Eliminar las metas fijas actuales

Para venta, marca, producto, crédito, actividad e inventario: botón "Eliminar meta" en las pantallas
del gerente/admin donde hoy se fijan. El servidor marca la versión vigente como retirada (sin crear
versión nueva vigente), con motivo obligatorio y solo en mes abierto. Después:
- `objetivoVigente` no la devuelve; el avance, la sugerencia y la previa del cierre la ignoran.
- Si la persona ya tenía capturas de ese elemento, el cierre las muestra como "sin meta" (no
  desaparecen: el dinero o las piezas capturadas siguen a la vista).
- Se puede volver a fijar una meta nueva después de retirarla (queda como versión siguiente).
- El historial (`GET /historial/:vendedorId`) muestra la retirada.

## 7. Pantallas (nueva pestaña "Metas" en `src/GerenciaVentas.jsx`)

1. **Tablero:** tarjetas por OKR con avance promedio y semáforo; dentro, cada resultado clave con barra,
   cifra y ritmo; metas sueltas aparte. Filtros: tienda, persona, periodo. Navegar a periodos anteriores
   (sellados con candado visible). Reutiliza `src/objetivos/GraficasAvance.jsx`.
2. **Administrar** (solo admin): crear/editar/retirar OKRs y metas; formulario con nombre, unidad,
   prueba, alcance, tienda/persona/participantes, periodo, inicio y cifra; motivo obligatorio al editar o
   retirar; historial de cambios por meta.
3. **Mis metas** (personal): checklist de sus metas del periodo; botón "Hecho" que pide liga o foto según
   la meta (o cantidad si es sin prueba); lista de lo capturado con su liga clicable; anular lo propio
   mientras el periodo esté abierto.
4. **Revisión** (con `anular_capturas_metas`): capturas recientes de su alcance con liga clicable y
   quién capturó; anular con motivo.
5. **Sellar periodo** (admin): vista previa del periodo terminado, confirmación "Sellar", rectificar con
   motivo.

Todo en computadora (decisión previa de Victor); modales con scroll y `type="submit"` explícito.

## 8. Entregas

| # | Entrega | Implementa | Revisa |
|---|---|---|---|
| 0.5 | Eliminar (retirar) metas fijas: servidor, botón y "sin meta" en cierre | Codex (TDD) | Claude (Code Reviewer) |
| 1 | Servidor de metas personalizadas: modelo, permisos, versionado, capturas con liga/foto, anti-duplicado, anular, sello, privacidad | Codex (TDD) | Claude (Code Reviewer) |
| 2 | Pantallas Administrar + Mis metas | Codex | Claude |
| 3 | Tablero + Revisión + Sellar | Codex | Claude |
| 4 | Revisión de la rama completa + navegador de punta a punta | Claude | — |

Merge y subida: solo con autorización explícita de Victor.

## 9. Pruebas que deben existir

- Solo admin crea/edita/retira metas y OKRs (403 a gerente y cajero).
- Liga repetida rechazada, también con `utm_*`, `www.`, mayúsculas o `/` final distintos; liga no http(s)
  rechazada.
- Captura a nombre de otro rechazada; captura de tienda por alguien fuera de la plantilla ese día
  rechazada; fecha futura rechazada.
- Periodo sellado rechaza editar, retirar, capturar y anular.
- Rectificación no puede cambiar la cifra meta y conserva el valor sellado.
- Vendedora no recibe cantidades ajenas ni totales de tienda, solo porcentaje.
- OKR = promedio topado a 100%; meta retirada no cuenta.
- Semana lunes–domingo y trimestre calendario; `inicio` inválido rechazado.
- Meta fija retirada: no aparece en avance ni cierre; sus capturas salen "sin meta"; mes sellado
  rechaza retirar; se puede fijar de nuevo.
- Suite completa del backend y `src` en verde; build de Vite.

## 10. Fase 2 (fuera de alcance)

Conectar SICAR (solo lectura) y metas automáticas: ventas, ticket promedio, accesorios, apartados,
clientes nuevos, gastos. Advertencia ya anotada: el margen usa el costo actual del catálogo, no el de la
venta (`backend/reportes.js:129`).
