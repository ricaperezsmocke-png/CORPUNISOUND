# Progreso del diseño responsive

- Fase 0 terminada y revisada por lectura: `src/App.jsx`, `src/BarraLateral.jsx`, `src/EncabezadoModulo.jsx`, `src/Login.jsx`, `src/index.css`. El menú móvil, la capa de cierre y el alto dinámico conservan las clases de escritorio desde `lg`.
- Fase 1 terminada por lectura: `src/AdminRoles.jsx`, `src/ConsultasVentas.jsx`, `src/CorteCaja.jsx`, `src/EstadoCuenta.jsx`, `src/Garantias.jsx`, `src/Gastos.jsx`, `src/InventarioProductos.jsx`, `src/RecepcionCompras.jsx`, `src/Traspasos.jsx` y los reportes en `src/reportes/`. Se añadieron desplazamiento horizontal local y anchos mínimos; no cambió ninguna columna ni dato.
- Fase 2 terminada por lectura: `src/AdminRoles.jsx`, `src/ArticuloCompra.jsx`, `src/CRM.jsx`, `src/ConsultasVentas.jsx`, `src/EstadoCuenta.jsx`, `src/Garantias.jsx`, `src/Gastos.jsx`, `src/InventarioProductos.jsx`, `src/MercadoLibre.jsx`, `src/MigracionDatos.jsx`, `src/RecepcionCompras.jsx`, `src/index.css`. Los campos de captura se apilan en celular y las cifras comparables permanecen juntas. `src/PuntoDeVenta.jsx` no se modificó en formularios por el límite expreso de Victor.
- Fase 3 terminada por lectura: `src/InventarioProductos.jsx`. Buscador flexible, lista completa y ficha inferior cerrable en celular; columna lateral original desde `lg`. El aviso de Todas las sucursales sigue íntegro.
- Fase 4 terminada por lectura: `src/Gastos.jsx`. Zona táctil para elegir o fotografiar comprobante; guardado, compresión, validación y avisos de origen del dinero sin cambios.
- Fase 4b terminada por lectura: `public/manifest.webmanifest`, `index.html`. Instalación básica en pantalla de inicio con modo independiente y logotipo existente; sin servicio en segundo plano ni dependencias.
- Fase 5 terminada por lectura: `src/AvisoPantallaMostrador.jsx`, `src/PuntoDeVenta.jsx`, `src/CorteCaja.jsx`, `src/EstadoCuenta.jsx`, `src/RecepcionCompras.jsx`, `src/ConsultasVentas.jsx`, `src/reportes/ReporteVentas.jsx`, `src/reportes/ReporteCortesCaja.jsx`, `src/reportes/ReporteGastos.jsx`, `src/reportes/ReporteGastosGarantias.jsx`. Aviso móvil compartido y copia de folios/totales habilitada donde estaba autorizada.
- Fase 6 cancelada por Victor: no se implementó cobro táctil ni se cambió el punto de venta fuera del aviso de Fase 5.
- Fase 7 pendiente de decisión de Victor: no se creó el resumen de bolsillo ni se asumieron cifras o permisos.
- Verificación pendiente: no se ejecutaron Node, pruebas, servidor ni navegador por la limitación documentada de este equipo. Falta comprobar visualmente 360, 390, 768 y 1280 px antes de mezclar la rama.

## Verificación

- **2026-09-12 — Victor lo probó en su teléfono real** (entrando por la red local a la IP del equipo)
  y **dio el visto bueno**. Esta es la primera verificación visual de todo el trabajo: hasta ese
  momento todo estaba hecho "por lectura", sin que nadie hubiera abierto un navegador.
- **Verificado por Claude leyendo el código:** los dos avisos de dinero siguen textuales — el de
  Gastos ("el gasto sale de la caja de una tienda") y el de Inventario ("la suma de todas las
  tiendas y no corresponde a ninguna"); cero acentos rotos en las 670 líneas nuevas; ninguna
  dependencia nueva; y `src/PuntoDeVenta.jsx` solo recibió 3 líneas (importar y colocar el aviso de
  mostrador), sin tocar la lógica de cobro.
- **Verificado por Claude en el navegador, sobre la versión ANTERIOR a los cambios de Codex:** login,
  menú de hamburguesa y Gastos en 390 px; Gastos e Inventario en 1280 px sin cambios.
- **PENDIENTE: comprobar la PC a 1280 px sobre la versión final.** Es la regla que no se negocia —
  las cajeras trabajan en PC todo el día. No se mezcla la rama sin eso.
- **PENDIENTE: revisar el alcance añadido** que Codex se apuntó por su cuenta y que nadie pidió:
  "copia de folios y totales". No mueve dinero, pero no estaba en el contrato.
