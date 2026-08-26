import React, { useState } from "react";
import {
  ShoppingCart, Landmark, Wallet, Boxes, ArrowRightLeft,
  Users, RadioTower, Store, Target,
  FileBarChart, Scale, ShieldAlert, ShieldCheck, DatabaseBackup, Settings,
  ChevronRight, ChevronsLeft, ChevronsRight, Home,
} from "lucide-react";
import { categoriasVisibles } from "./menuCategorias.js";

/**
 * BarraLateral.jsx — El menú del sistema.
 *
 * Solo dibuja. Qué módulos existen y quién ve cuáles vive en menuCategorias.js,
 * que es código puro y sí tiene pruebas. Aquí solo se le ponen los iconos y el
 * relieve.
 *
 * La barra acompaña a TODAS las pantallas, no solo al inicio: cambiar de Punto
 * de Venta a Corte de Caja es un clic, sin pasar por el inicio.
 */

/** El icono de cada módulo. Se queda aquí y no en menuCategorias.js para que
 *  ese archivo no dependa de React y se pueda probar con `node --test`. */
const ICONOS = {
  pos: ShoppingCart,
  corte: Landmark,
  gastos: Wallet,
  inventario: Boxes,
  traspasos: ArrowRightLeft,
  crm: Users,
  radar_demanda: RadioTower,
  ml: Store,
  gerencia_ventas: Target,
  reportes: FileBarChart,
  estado_cuenta: Scale,
  garantias: ShieldAlert,
  roles: ShieldCheck,
  respaldos: DatabaseBackup,
  configuracion: Settings,
};

export default function BarraLateral({ usuario, vista, onEntrarModulo }) {
  const categorias = categoriasVisibles(usuario);
  const [desplegado, setDesplegado] = useState({});

  /** Encogida = solo iconos. NO se recuerda entre sesiones a propósito: Victor
   *  la quiso siempre abierta al entrar, y que encogerla sea una decisión del
   *  momento, no un estado en el que te encuentras sin saber por qué. */
  const [encogida, setEncogida] = useState(false);

  return (
    // El scroll va en la lista de categorías, NO aquí: con overflow en el
    // <nav>, el logo y el botón Inicio se iban con el desplazamiento.
    <nav className={`neu shrink-0 h-full flex flex-col rounded-r-2xl overflow-hidden transition-[width] duration-200 ${
      encogida ? "w-16" : "w-64"
    }`}>
      <div className="shrink-0 px-3 pt-3 pb-1 flex justify-end">
        <button
          type="button"
          onClick={() => setEncogida((v) => !v)}
          className="neu-boton rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
          aria-label={encogida ? "Mostrar los nombres de los módulos" : "Encoger el menú a solo iconos"}
          aria-expanded={!encogida}
          title={encogida ? "Mostrar los nombres" : "Encoger el menú"}
        >
          {encogida ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        </button>
      </div>

      {/* El inicio no es un módulo (no pasa por permisos), pero sí es un
          destino: es donde vive el Asistente de Negocio. */}
      <div className="shrink-0 px-3 pb-3">
        <button
          type="button"
          onClick={() => onEntrarModulo("dashboard")}
          title={encogida ? "Inicio" : undefined}
          className={`w-full flex items-center gap-2.5 rounded-xl py-2 text-left text-[13px] transition-colors ${
            encogida ? "justify-center px-0" : "px-3"
          } ${
            vista === "dashboard"
              ? "neu-hundido font-semibold text-primary"
              : "neu-boton text-foreground/80 hover:text-foreground"
          }`}
        >
          <Home size={15} className="shrink-0" />
          {!encogida && <span className="truncate">Inicio</span>}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-4">
        {categorias.map((categoria) => (
          <div key={categoria.id}>
            {/* Encogida no cabe el nombre de la categoría, pero la separación
                entre grupos sí importa: se conserva como una raya. */}
            {encogida ? (
              <div className="mx-1 mb-2 border-t border-black/10" aria-hidden="true" />
            ) : (
              <div className="px-2 pb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
                {categoria.nombre}
              </div>
            )}

            <div className="space-y-1">
              {categoria.modulos.map((m) => {
                const Icono = ICONOS[m.id];
                const activo = vista === m.id;
                const abierto = !!desplegado[m.id];

                return (
                  <div key={m.id}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onEntrarModulo(m.id)}
                        // Encogida, el nombre solo vive en el title: es la única
                        // forma de saber qué es cada icono.
                        title={encogida ? m.nombre : undefined}
                        // El relieve NO es la única señal del módulo activo: lleva
                        // también color y peso de texto, para quien no distinga
                        // sombras suaves.
                        className={`flex-1 min-w-0 flex items-center gap-2.5 rounded-xl py-2 text-left text-[13px] transition-colors ${
                          encogida ? "justify-center px-0" : "px-3"
                        } ${
                          activo
                            ? "neu-hundido font-semibold text-primary"
                            : "neu-boton text-foreground/80 hover:text-foreground"
                        }`}
                      >
                        {Icono && <Icono size={15} className="shrink-0" />}
                        {!encogida && <span className="truncate">{m.nombre}</span>}
                      </button>

                      {m.hijos && !encogida && (
                        <button
                          type="button"
                          onClick={() => setDesplegado((d) => ({ ...d, [m.id]: !d[m.id] }))}
                          className="neu-boton shrink-0 rounded-lg p-1.5 text-muted-foreground"
                          aria-label={abierto ? `Ocultar lo de ${m.nombre}` : `Ver lo de ${m.nombre}`}
                          aria-expanded={abierto}
                        >
                          <ChevronRight size={13} className={`transition-transform ${abierto ? "rotate-90" : ""}`} />
                        </button>
                      )}
                    </div>

                    {/* Los hijos navegan al módulo padre: entrar directo a la
                        sub-pantalla exigiría tocar PuntoDeVenta.jsx e
                        InventarioProductos.jsx, que están fuera de alcance. */}
                    {m.hijos && abierto && !encogida && (
                      <div className="mt-1 ml-6 space-y-0.5">
                        {m.hijos.map((h) => (
                          <button
                            key={h.id}
                            type="button"
                            onClick={() => onEntrarModulo(m.id)}
                            className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                          >
                            {h.nombre}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
