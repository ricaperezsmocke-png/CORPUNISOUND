# Planeador con IA para metas extra — diseño

Fecha: 2026-10-12 · Aprobado en conversación por Victor (partes 1, 2 y 3) · Pendiente: revisión de este documento

## 1. Qué es y para qué

Cuando el administrador da de alta metas extra en **Objetivos → Administración → Administrar metas extra**,
puede escribir en palabras lo que quiere lograr ("vender más guitarras acústicas en Ocosingo este mes") y el
sistema le propone **un OKR y de 3 a 6 metas extra (KPIs)** para llegar ahí, con cifra, unidad, tipo de prueba
y una línea de "por qué".

**La regla que manda sobre todo lo demás (Victor, 2026-10-12):** *nada pasa hasta que un usuario con permiso
haya validado todo lo que hizo la IA.* La IA solo escribe un borrador. Ningún OKR, meta, captura o dato del
sistema se crea ni se cambia por la IA.

Éxito = el administrador arma el plan del periodo en minutos en vez de inventarlo desde cero, y cada cifra que
termina evaluando a una vendedora fue revisada y aceptada por una persona con nombre.

## 2. Quién lo usa

- Solo quien tiene el permiso existente **`administrar_metas_personalizadas`** ("Crear y Sellar Metas
  Personalizadas"). Hoy: Victor. No se crea permiso nuevo.
- Las vendedoras **no ven** borradores ni planes descartados. Solo ven las metas ya creadas, igual que hoy.

## 3. Flujo en pantalla (3 pasos, en una ventana)

Botón **"✨ Proponer plan con IA"** junto al alta normal en Administrar metas extra.

**Paso 1 — Qué quieres lograr**
- Objetivo en texto libre (máx. 500 caracteres). Aviso bajo el campo: "No escribas nombres de personas".
- Tienda (una tienda o "Toda la empresa") y periodo (semanal / mensual / trimestral + inicio), con las mismas
  reglas de periodo que el alta normal.
- Botón "Proponer". Mientras espera: "Armando el plan…" (máx. 30 s).

**Paso 2 — Revisar cada punto**
- Arriba el OKR propuesto (título y descripción); abajo de 3 a 6 metas. Cada meta muestra: nombre, cifra,
  unidad, prueba (ninguna / liga / foto), la línea "por qué" y una etiqueta "Idea nueva" si no sale del
  catálogo.
- Todo es editable antes de decidir: textos, cifra, unidad, prueba, y el alcance de cada meta (tienda o una
  persona concreta; ver 6.3).
- Cada punto (el OKR y cada meta) tiene **Aceptar** y **Rechazar**. **Ninguno viene marcado**, tampoco las
  ideas nuevas.
- Si se rechaza el OKR, las metas aceptadas se crean sueltas (sin OKR).
- **"Crear las validadas"** queda bloqueado hasta que **todos** los puntos tengan decisión, y al menos uno esté
  aceptado.
- "Descartar plan" cierra sin crear nada; el borrador queda en el registro como descartado.

**Paso 3 — Confirmar**
- Resumen: "Vas a crear 1 OKR y 4 metas para Ocosingo, mensual de noviembre 2026" (lista de lo aceptado con
  sus cifras finales) y botón **Confirmar**. Solo aquí se escribe algo en el sistema.

## 4. Qué datos se mandan a la IA

Solo cifras agregadas de la tienda elegida (o de la empresa), calculadas por el código:

- Venta total de la tienda por mes, últimos 6 meses.
- Meta de venta y avance del mes en curso (totales de tienda, no por persona).
- Número de vendedoras activas en la tienda (un número, sin nombres).
- Actividades registradas por tipo y por mes (grupos, Marketplace, iglesia, volanteo), últimos 6 meses.
- Metas extra de periodos anteriores: nombre, unidad, cifra y resultado (sin quién las hizo).
- Lista de marcas/familias del catálogo de productos (nombres de marca, sin costos).
- El catálogo de acciones permitidas: las 4 clases de actividad existentes (`CLASES_ACTIVIDAD`) y los nombres
  de metas extra usadas antes.

**Nunca se manda:** nombres de personal, clientes, teléfonos, costos, márgenes, ventas individuales ni ids de
usuarios. Antes de enviar el texto del objetivo, el servidor reemplaza por "[persona]" cualquier nombre que
coincida con un vendedor o usuario registrado (decisión de Victor 2026-08-16: no mandar nombres a la IA).

**Tienda sin historial** (p. ej. Innotec recién creada): se manda solo el texto y el catálogo; la pantalla
avisa "Esta tienda no tiene historial; las cifras son una propuesta sin datos, revísalas con cuidado".

## 5. Validación de lo que responde la IA (en el servidor, antes de mostrarlo)

La respuesta se pide en JSON con forma fija y se rechaza completa si no cumple:

- Exactamente 1 OKR (título ≤ 120, descripción ≤ 500) y de 3 a 6 metas.
- Cada meta: nombre ≤ 120, unidad ≤ 40, prueba ∈ {ninguna, liga, foto}, cifra entera > 0.
- Como máximo 2 metas marcadas "Idea nueva"; las demás deben corresponder a una acción del catálogo.
- Cifra ≤ 3 veces el máximo histórico de esa misma acción en la tienda; si no hay histórico, se acepta pero
  se marca "sin dato histórico" en pantalla.
- La línea "por qué" (≤ 200): si menciona un número que no está en los datos enviados, se sustituye por un
  texto del sistema ("Propuesta basada en el historial de la tienda").

Si la respuesta no pasa, se trata como falla (sección 7). No se "arregla" a medias.

## 6. Creación: solo con validación completa, exigida en el servidor

### 6.1 Ruta nueva de propuesta
`POST /api/metas/plan-ia` (permiso `administrar_metas_personalizadas`): arma los datos, llama a la IA, valida,
guarda el borrador en `DB.pos.planes_ia` con estado `borrador` y lo devuelve con su `id`. **No crea metas.**

### 6.2 Ruta nueva de validación
`POST /api/metas/plan-ia/:id/validar` (mismo permiso). Recibe una decisión **por cada punto** del borrador:
`{ okr: { decision, cambios }, metas: [{ indice, decision, cambios, alcance }] }`. El servidor rechaza (400) si:
- el plan no existe o ya no está en `borrador` (cualquier usuario con el permiso puede validarlo, no solo
  quien lo pidió);
- falta la decisión de algún punto, sobra alguno, o alguna decisión no es `aceptar`/`rechazar`;
- no hay ningún punto aceptado.

Luego crea lo aceptado **con las mismas funciones del alta normal** (`crearOkr`, `crearMeta` de
`metasPersonalizadas.js`), así que aplican todas sus reglas (periodo válido, periodo no sellado, alcance
válido, cifra, prueba). **Todo o nada:** primero se validan todos los puntos aceptados; si uno solo falla,
no se crea ninguno y se devuelve el error. Al terminar, el plan pasa a `validado` y se guarda en disco igual
que cualquier alta.

`POST /api/metas/plan-ia/:id/descartar` pasa el plan a `descartado` sin crear nada.

### 6.3 Alcance de cada meta
Por omisión cada meta va a la tienda elegida (o a la empresa). El administrador puede cambiar una meta a una
persona concreta en el paso 2. Como hoy una meta dentro de un OKR hereda el alcance del OKR, **una meta
cambiada a persona se crea suelta** (sin OKR) y la pantalla lo dice junto al selector: "Esta meta quedará
fuera del OKR porque es de una sola persona". La persona se elige después de la respuesta de la IA, así que su
nombre nunca viaja a la IA.

## 7. Si la IA falla

Tiempo máximo 30 s (AbortController, como `gerenteVentasIA.js`). Si tarda, da error, se niega o la respuesta no
pasa la sección 5:
- Mensaje: "No se pudo armar el plan; puedes intentarlo otra vez o dar de alta las metas a mano".
- No se crea nada. El texto, la tienda y el periodo se quedan en la ventana.
- El intento se registra en `planes_ia` con estado `fallido` y el motivo técnico (sin la respuesta cruda si
  trae datos inválidos de más de 2 000 caracteres).

Si falta `ANTHROPIC_API_KEY`, el botón se muestra deshabilitado con "El planeador con IA no está configurado".

## 8. Registro (qué queda y quién lo ve)

`DB.pos.planes_ia`, un registro por intento:
`{ id, estado: borrador|validado|descartado|fallido, creado_por, creado_por_nombre, creado_en,
entrada: { objetivo_texto, sucursal_id, periodo, inicio }, propuesta (tal como la dio la IA, ya validada),
decisiones: [{ punto, decision, cambios: { campo: [antes, después] } }], validado_por, validado_por_nombre,
validado_en, creados: { okr_clave, metas_claves }, error }`.

Cada OKR y meta creados guardan `origen: { tipo: "plan_ia", plan_id, validado_por_nombre, validado_en }`. En el
historial de la meta (pantalla de administración) se ve "Origen: plan con IA · validado por Victor el 12 oct".
Las metas creadas a mano no llevan `origen` (o `null`) y se ven igual que hoy.

Lista "Planes con IA" en Administrar metas extra: fecha, quién, tienda, periodo, estado, y al abrir uno, lo
propuesto contra lo aprobado. Solo con el permiso de administrar.

## 9. Modelo, costo y límites

- Modelo `claude-opus-5-5` por el SDK ya instalado (`@anthropic-ai/sdk`, `backend/server.js:21`), sin
  `temperature`, con `output_config: { effort: "low" }`, igual que `gerenteVentasIA.js`. Sin dependencias
  nuevas.
- Costo esperado: menos de 5 USD al mes con el uso previsto.
- Límite de 20 propuestas por usuario por día (cuenta en `planes_ia`) para que un error o un doble clic no
  dispare el gasto. Al pasarlo: "Llegaste al límite de 20 planes por hoy".

## 10. Cómo se abusa y qué lo cierra

| Riesgo | Cierre |
|---|---|
| Alguien sin permiso crea metas con el planeador | Las tres rutas exigen `administrar_metas_personalizadas` en el servidor |
| Se crean metas sin revisar todo | El servidor exige una decisión por cada punto; la pantalla no es la única barrera |
| La IA pone una cifra absurda que castiga a una vendedora | Tope de 3× el histórico, cifra editable, y nada se crea sin aceptación explícita |
| Se valida un borrador viejo dos veces (doble clic) | Solo un plan en `borrador` se puede validar; el segundo intento recibe 400 |
| Se filtra un nombre a la IA | Datos solo agregados y reemplazo de nombres en el texto libre |
| Se crea una meta en un periodo ya sellado | `crearMeta`/`crearOkr` ya lo rechazan, y por "todo o nada" no se crea nada |

## 11. Pruebas

- Unitarias del armado de datos: no aparece ningún nombre, teléfono ni costo; tienda sin historial.
- Unitarias de la validación de respuesta: cada regla de la sección 5 con un caso que pasa y uno que no.
- Rutas: sin permiso → 403; validar con un punto sin decisión → 400 y nada creado; con un punto en periodo
  sellado → 400 y nada creado; validación correcta crea exactamente lo aceptado con `origen`; segunda
  validación del mismo plan → 400; descartar no crea nada.
- IA simulada (cliente falso inyectado) para: respuesta buena, tiempo agotado, JSON roto, cifra fuera de tope.
- Navegador: flujo completo con una respuesta simulada; "Crear las validadas" bloqueado hasta decidir todo;
  resumen final; historial con "Origen: plan con IA".

## 12. Fuera de alcance

- La IA no edita ni retira metas existentes, no sella ni toca capturas.
- No reparte metas entre personas por su cuenta.
- No hay planeador para las metas de venta ni para el cierre del mes.
