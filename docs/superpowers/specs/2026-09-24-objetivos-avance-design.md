# Mi Objetivo de Venta — Entrega A: gráficas de progreso — Diseño

**Fecha:** 2026-09-24 · **Aprobado por Victor en conversación:** "sí a las dos, mergea y despacha la A".
**Base:** `master` `26615b4` (metas de marca/producto/crédito y sus pantallas ya en producción).

## Decisiones de Victor (no volver a preguntar)

- "Imágenes" = **gráficas de progreso**. Todo se usa en **computadora**.
- La **vendedora** ve lo suyo **en pesos** y de su tienda **solo el porcentaje, entero** (nunca pesos: en
  una tienda de dos personas, total menos lo propio = lo de la compañera).
- **Gerente y administración** ven la tienda en pesos y por persona.
- Orden de entregas: B (hecha) → **A (esta)** → C (reordenar estilo SICAR).

## Qué se construye

### Pestaña "Mi avance" (vendedora; primera de su barra)
1. **Anillo grande**: porcentaje de su meta de venta del mes, con "$capturado de $meta" debajo. Sin meta
   (0): el anillo dice "Sin meta asignada este mes" y no divide.
2. **Línea del mes, día por día**: su venta acumulada (solo capturas vigentes de venta) contra la línea del
   ritmo (recta de 0 a la meta el último día del mes). Texto debajo: "Te faltan $X; son $Y por día en los N
   días que quedan" (días de calendario, contando hoy). Si ya llegó: "¡Llegaste a tu meta!". En un mes
   pasado no se habla de "días que quedan".
3. **Barras por meta suya**: cada marca (pesos), producto (piezas), financiera (créditos) y actividad
   (declaradas, con el aviso "Declaradas, no verificadas"). Junto a cada una, una barra gris con **el
   porcentaje de la tienda** en esa meta (entero), sin pesos.

### Pestaña "Avance de la tienda" (jefatura con alcance)
- Lo mismo para la tienda completa en pesos/piezas/créditos: anillo de venta, línea diaria de la tienda
  contra el ritmo, barras por meta.
- **Tabla por persona**: por cada persona de la plantilla, su porcentaje (y cifra) en venta y en cada meta,
  con una barrita.

## Servidor: una ruta nueva

`GET /api/objetivos/:mes/:sucursalId/avance` — mismo control de acceso que `GET /api/objetivos/:mes/:sucursalId`.
- A **cualquiera con alcance propio** (persona ligada en la plantilla): `propio` (su avance en cifras) y
  `tienda_porcentajes` (enteros, sin cifras).
- A **jefatura con alcance**: además `tienda` (cifras) y `por_persona`.
- Nunca expone cifras de tienda ni de otra persona a quien no es jefatura.
- Porcentaje = `Math.floor(capturado * 100 / meta)`, entero; `null` si la meta es 0.
- La tienda cuenta actividades con `resumenActividades` de tienda (una conjunta cuenta una vez).

## Reglas que no cambian
Ninguna regla ni ruta existente cambia. Las gráficas solo leen. Recharts ya está instalado (lo usa
`src/PrediccionesDemanda.jsx`); ninguna dependencia nueva.

## Verificación
Funciones puras con pruebas; ruta con pruebas HTTP (una vendedora no recibe cifras de tienda ni de otra
persona); prueba en navegador por Claude (vendedora y gerente, mes actual y mes pasado, meta 0).
