# Entrega 1 — CRM: seguimiento de clientes con SICAR

Fecha: 2026-10-15. Decisiones de Victor tomadas en conversación con Claude. Base: master `e9372b2`.

## 1. Para qué

En el CRM ya están los 5,098 clientes de Ocosingo con sus compras de SICAR (carga del 2026-10-15). Victor quiere
**trabajarlos**: ver primero a quien compró más reciente, filtrar por fechas, marcar en qué va cada cliente y
escribirle por WhatsApp. Hoy la lista se ordena por nombre y los clientes de SICAR son de solo consulta.

Éxito: una vendedora abre CRM → Clientes SICAR, ve arriba a quien compró esta semana, filtra "Interesado",
abre la ficha, toca WhatsApp y cambia el estado; queda constancia de quién lo cambió.

## 2. Lo que ya existe y no se cambia

- Clientes de CORPUNISOUND (`DB.crm.clientes`) ya tienen estado: `contactado`, `interesado`, `visito_tienda`,
  `perdido` (manuales, `ESTADOS_MANUALES` de `backend/crm.js`) y `compro` (solo por venta cerrada). Ruta
  `PUT /api/crm/clientes/:id/estado`, permiso `cambiar_estado_cliente`. **No se toca.**
- Lista combinada `GET /api/crm/v2/clientes` (`backend/crmFuentes.js`, `listar`) y pantalla `src/CRMListaClientes.jsx`.
- Datos SICAR en tablas SQLite `sicar_*`, nunca en el JSON de estado.

## 3. Decisiones tomadas (no reabrir)

1. **Mismos estados para todos**: Contactado, Interesado, En tienda, Perdido (manuales); Compró no se asigna a mano.
2. **Opción A**: el estado de un cliente que solo existe en SICAR se guarda en una tabla SQLite propia. El cliente
   NO se convierte en cliente de CORPUNISOUND.
3. Mismo permiso `cambiar_estado_cliente`. Alcance: un usuario sin `ver_todas_las_sucursales` solo cambia el
   estado de clientes de su tienda (regla 5 de CLAUDE.md: alcance del token, nunca de `?sucursal_id=`).
4. Entra también: botón de WhatsApp en la ficha SICAR.
5. La fecha que importa es la **última compra vigente**.

## 4. Diseño

### 4.1 Orden y filtro por fecha (servidor)

`GET /api/crm/v2/clientes` acepta además:
- `orden`: `reciente` (por defecto: última compra más reciente primero; sin compras al final, por nombre),
  `nombre`, `monto` (mayor monto primero). Valor desconocido → 400.
- `desde`, `hasta`: fechas `AAAA-MM-DD` sobre la última compra. Con cualquiera de las dos, los clientes sin compras
  quedan fuera. Fecha inválida o `desde > hasta` → 400.
- `estado`: uno de los estados, o `sin_estado`. Desconocido → 400.
- Los `totales` reflejan el filtro aplicado.
- Desempate estable por `ref` para que la paginación no repita ni salte clientes.

### 4.2 Estado de clientes de SICAR

Tablas nuevas en `backend/sicarRepositorio.js` (migración al arrancar, idempotente):
- `sicar_estados (sucursal_id, cli_id, estado, usuario_id, fecha_hora, PRIMARY KEY (sucursal_id, cli_id))`.
- `sicar_estados_historial (id, sucursal_id, cli_id, anterior, nuevo, usuario_id, fecha_hora)`: una fila por cambio.
  Nunca se borra (salvo con el borrado de la tienda, si existe ese flujo).
- **Las dos entran al respaldo SICAR** (`TABLAS` de `backend/sicarRespaldo.js`). Un respaldo viejo sin estas tablas
  se restaura sin error y deja los estados vacíos.

Ruta nueva `PUT /api/crm/v2/clientes/:ref/estado` con `{ estado }`:
- Permiso `cambiar_estado_cliente`. La persona se resuelve con `crmFuentes` y el contexto de quien pregunta: si no la
  ve, 404 (mismo trato que hoy).
- `ref` `crm:N` → delega en `cambiarEstadoCliente` existente. `ref` `sicar:S:C` → escribe `sicar_estados` + historial
  en una transacción.
- Lista de permitidos (`ESTADOS_MANUALES`); `compro` → 400 con el mensaje actual. Falla cerrando.
- `fecha_hora` ISO UTC; `usuario_id` del token.

Estado que muestra la lista (`personas()` en `crmFuentes.js`):
- Cliente de CORPUNISOUND: su `estado` de siempre.
- Solo SICAR: el de `sicar_estados`.
- Unido (nativo + SICAR): el del nativo; si el nativo no tiene, el de SICAR más reciente entre sus identidades.

### 4.3 Pantalla (`src/CRMListaClientes.jsx` y su ficha)

- Encima de la lista: selector de orden, dos fechas (desde/hasta) y selector de estado, junto al buscador. Al cambiar
  cualquiera vuelve a la página 1.
- En cada renglón: el estado como etiqueta de color (mismos colores que `ESTADOS` de `src/CRM.jsx`) y la fecha de
  última compra.
- En la ficha: los botones de estado (sin "Compró"; insignia "Compró" si ya compró), deshabilitados sin permiso.
- **WhatsApp**: botón en la ficha si hay teléfono o celular. Normalizar a dígitos: 10 dígitos → anteponer `52`;
  12 dígitos que empiezan con `52` → tal cual; cualquier otro caso → botón deshabilitado con "Teléfono no válido".
  Abre `https://wa.me/<numero>` con un saludo vacío editable por WhatsApp. No manda nada al servidor.
- Archivos de pantalla nuevos si `CRMListaClientes.jsx` pasa de ~200 líneas. Líneas ≤ 200 caracteres.

## 5. Dinero, inventario y personal

- No mueve dinero ni inventario. Los montos de SICAR siguen sin sumar a caja, cortes ni utilidad.
- Personal: el historial deja quién cambió cada estado de SICAR. (Deuda conocida, fuera de alcance: el estado de
  clientes de CORPUNISOUND no guarda quién lo cambió.)

## 6. Pruebas

- Backend (`node --test`): orden `reciente` con y sin compras y desempate; filtros de fecha (límites incluidos, 400 en
  inválidos); filtro de estado y `sin_estado`; cambio de estado SICAR con historial; `compro` → 400; estado inventado
  → 400; gerente de otra tienda → 404; usuario sin permiso → 403; unido usa estado nativo y cae al de SICAR si no hay;
  respaldo y restauración llevan los estados; restaurar respaldo viejo sin tablas no falla.
- Navegador: lista ordenada por reciente, filtro de fechas, filtro de estado, cambiar estado y verlo tras recargar,
  WhatsApp abre el número correcto, botón deshabilitado sin permiso.

## 7. Fuera de alcance

Ficha "qué compra" y VIP (Entrega 3), recompra (Entrega 4), interruptores de pantallas (Entrega 2), bitácora del
estado de clientes de CORPUNISOUND.
