# Fugas de dinero H1–H4 (auditoría 2026-09-25)

Origen: auditoría independiente de la zona de dinero (rama `auditoria/dinero-2026-09`,
`docs/auditorias/2026-09-dinero.md`). Claude verificó H1–H4 en el código. Decisiones de Victor (2026-09-25):
H3 = **opción b** (quitar el precio libre de F3); H4 = **motivo obligatorio + autorización de una segunda persona**.
Rama `fix/dinero-h1-h4`, base `dd860e3`.

## H1 — Monedero inventado al dar de alta un cliente (CRÍTICA)

`backend/clientes.js` `crearCliente` copia `monedero`, `limite_credito` y `sujeto_credito` del cuerpo (línea ~66-69).
Una cajera manda `POST /api/clientes` con `monedero: 12000` y paga una guitarra con ese saldo; el corte espera $0.
La edición ya se cerró antes (ver el comentario de `CAMPOS_EDITABLES`); el alta no.

**Cierre:** en `crearCliente` un cliente nuevo nace SIEMPRE con `monedero: 0`, `saldo: 0`, `saldo_vencido: 0`,
`limite_credito: 0`, `sujeto_credito: false`, sin importar lo que traiga el cuerpo (no lanzar error: ignorar, como
hace la edición). El monedero solo nace de donde ya nace hoy (cancelación de apartado). Prueba: alta con esos campos
inflados queda en cero; una venta posterior no puede aplicar monedero.

## H2 — Venta normal disfrazada de "Apartado" (CRÍTICA)

`backend/ventas.js` `crearVenta` guarda `tipo_documento: datos.tipo_documento || "Ticket"` (línea ~306) sin lista.
`backend/cortes.js:55` excluye del corte todo lo que diga "Apartado". Resultado: mercancía fuera y ningún corte la espera.

**Cierre:** lista de permitidos en `crearVenta`: exactamente los de `TIPOS_DOCUMENTO` de `src/PuntoDeVenta.jsx:32`
(`"Ticket", "Factura", "Nota de Venta", "Factura CFDI", "Remisión"`), comparando el texto EXACTO (sin normalizar
acentos; regla 2 de CLAUDE.md: falla cerrando). Vacío/ausente = "Ticket". Cualquier otro valor —"Apartado", "apartado",
"Cotización", texto mal codificado— se RECHAZA con error claro. Los apartados siguen naciendo solo por `crearApartado`
(`backend/apartados.js`), que no pasa por esta lista. MercadoLibre (`mercadolibre.js:522`, "Ticket") sigue igual.
Si `cambiar_tipo_documento` es el permiso para elegir documento distinto de Ticket, verifícalo también en el servidor
(sin ese permiso solo "Ticket" o vacío); si el permiso no existe en `backend/permisosCatalogo.js`, detente y reporta.

## H3 — El precio cambiado con F3 no es el que cobra el servidor (ALTA) — decisión: QUITAR

La cajera cambia el precio con F3 (`src/PuntoDeVenta.jsx` ~476, botón ~728, atajo ~617, modal ~1053) y el servidor
cobra el de catálogo sin avisar: pantalla $9,000, corte $12,000 → faltante falso a la cajera.

**Cierre (dos partes):**
1. **Pantalla:** quitar el cambio libre de precio del Punto de Venta: el botón "Precio (F3)", el atajo F3, el modal
   "Cambiar precio" y la función que modifica `precioUnitario`. El precio de un producto de catálogo en el ticket es
   siempre el del catálogo. (El artículo rápido conserva su campo de precio: no tiene catálogo.) Para cobrar menos
   existe el descuento, con su permiso y su rastro. No borres el permiso `cambiar_numero_precio` del catálogo de
   permisos (lo tienen roles guardados y el arranque valida el catálogo); solo deja de usarse en esta pantalla.
2. **Servidor (`crearVenta`):** en una línea CON `producto_id`, si el cuerpo trae `precio_unitario` y no coincide en
   centavos con el precio de catálogo que el servidor va a cobrar, RECHAZAR la venta con un mensaje como
   `El precio de "<producto>" cambió o no coincide con el catálogo ($X). Recarga la pantalla antes de cobrar.`
   Así pantalla y corte nunca vuelven a contar historias distintas en silencio (incluye el caso de un precio de
   catálogo que cambió mientras la pantalla estaba abierta). Si no trae `precio_unitario`, se cobra el de catálogo
   como hoy. Aplica igual a `crearApartado` si ahí también se ignora el precio del cliente (verifícalo y aplica la
   misma regla; si la estructura es distinta, reporta).

## H4 — Cobrar, cancelar sin motivo y quedarse el billete (ALTA) — decisión: motivo + segunda persona

`backend/ventas.js` `cancelarVenta` guarda `motivo || ""` (línea ~427): se cancela sin motivo y el corte deja de
esperar el dinero. El gerente tiene cobrar, cancelar y cortar a la vez.

**Cierre:**
1. **Permiso nuevo** `autorizar_cancelaciones` en `backend/permisosCatalogo.js` (módulo `pos`, etiqueta "Autorizar
   cancelaciones de venta", `implementado: true`). El rol Administrador lo recibe solo al arrancar (reconciliarRoles);
   a los demás roles Victor se lo da a mano.
2. **Ruta `PUT /api/ventas/:id/cancelar`** (server.js ~1773), SOLO para ventas que no son Apartado (la rama de
   `cancelarApartado` no cambia en esta entrega): el cuerpo trae `{ motivo, autorizador: { usuario, password } }`.
   El servidor exige, en este orden, fallando cerrado:
   - `motivo` con texto (trim) no vacío;
   - `autorizador.usuario` y `autorizador.password` presentes;
   - el autorizador existe en `DB.admin.usuarios`, está activo, y su contraseña coincide (`verificarPassword` de
     `backend/auth.js`, async: la ruta pasa a ser async);
   - es una persona DISTINTA de quien cancela (`Number(autorizador.id) !== Number(req.usuarioToken.id)`);
   - su rol tiene `autorizar_cancelaciones`;
   - su alcance cubre la sucursal de la venta (tiene `ver_todas_las_sucursales` o su `sucursal_id` es la de la venta).
   Si cualquiera falla: 403 con un mensaje GENÉRICO "La autorización no es válida" (no revelar si falló el usuario,
   la contraseña o el permiso), salvo el motivo vacío que dice "Escribe el motivo de la cancelación" (400).
3. **`cancelarVenta`** recibe el autorizador ya verificado (`{ id, nombre }`) y guarda en la venta, además de lo que ya
   guarda (quién canceló y cuándo): `cancelacion_autorizada_por: { id, nombre }`. `cancelarVenta` también exige motivo
   no vacío por sí misma (defensa en profundidad). Actualiza las pruebas existentes que llaman `cancelarVenta` sin motivo
   o sin autorizador (`cancelacionTrasCorte`, `corteSellado`, `escrituraSucursal`, `monederoPago`, `rastroInventario`,
   `ventaSinExistencia`): que manden motivo y autorizador; no debilites lo que cada una prueba.
4. **Pantalla `src/ConsultasVentas.jsx`**, ventana "Cancelar" (~455): motivo obligatorio (botón deshabilitado sin
   motivo) y dos campos nuevos: "Usuario que autoriza" y "Contraseña" (type password, sin autocompletar:
   `autoComplete="off"` / `new-password`). Texto de ayuda: "Otra persona con permiso debe autorizar la cancelación."
   Mostrar el error del servidor dentro de la ventana. En el detalle de una venta cancelada, mostrar también
   "Autorizó: <nombre>" cuando exista.
5. No guardes la contraseña del autorizador en ningún lado (ni en la venta, ni en bitácoras, ni en consola).

## Fuera de alcance (anotado, NO hacer)

H5–H13 de la auditoría; el monedero de cliente de otra sucursal; la cancelación de APARTADOS; el F3 estilo SICAR
(elegir precio 1–4).

## Invariantes

- Nada de esto cambia cómo se calcula un corte, excepto que ya no entran ventas falsas de "Apartado".
- Una venta legítima (Ticket con precio de catálogo) se cobra exactamente igual que hoy.
- Ids del cuerpo pueden ser texto: normaliza con Number (regla 4).
- Líneas ≤ 200 caracteres; acentos UTF-8 correctos; sin dependencias nuevas.

## Pruebas (TDD, rojo antes de verde)

- H1: alta con monedero/limite_credito/sujeto_credito/saldo inflados → todo en cero; venta posterior sin monedero.
- H2: "Apartado", "apartado", "Cotización", "Tícket" y un texto con carácter de reemplazo se rechazan; los 5 permitidos
  pasan; vacío = Ticket; el corte de la caja sigue esperando una venta Ticket normal.
- H3: línea de catálogo con `precio_unitario` distinto al de catálogo → rechazada y sin mover existencia ni corte;
  igual → pasa; sin `precio_unitario` → cobra catálogo. Pantalla: el POS ya no ofrece cambiar precio.
- H4: sin motivo → 400; sin autorizador / contraseña mala / autorizador = quien cancela / sin permiso / otra sucursal
  → 403 genérico y la venta sigue cerrada y en el corte; con todo correcto → cancelada, `cancelacion_autorizada_por`
  guardado, sin contraseña en la venta. Incluye al menos una prueba de ruta HTTP (ver el patrón de pruebas de rutas
  existentes, p. ej. `backend/objetivosRutas.test.js` o `backend/cajas*.test.js`).
- Suite completa del backend en verde (la corre Claude), `node --test src/`, eslint sin errores, `npx vite build`.
