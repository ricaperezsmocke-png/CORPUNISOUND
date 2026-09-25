import { useCallback, useEffect, useState } from "react";
import { ListChecks } from "lucide-react";
import { apiFetch } from "../api";
import { Campo, Modal } from "./DialogosObjetivos";
import { leer } from "./datos";

const LISTAS = [
  { lista: "marcas", titulo: "Marcas", ejemplo: "Yamaha" },
  { lista: "productos", titulo: "Productos", ejemplo: "Teclados" },
];

// Alta y desactivación de las listas propias de objetivos. Solo lo ve quien tiene
// editar_objetivos_venta y ver_todas_las_sucursales (la ruta devuelve 404 a los demás).
// No hay borrar ni reactivar: lo ya capturado conserva su nombre.
export default function ListasObjetivos({ onCambio }) {
  const [datos, setDatos] = useState({ marcas: [], productos: [] });
  const [nuevos, setNuevos] = useState({ marcas: "", productos: "" });
  const [errores, setErrores] = useState({});
  const [desactivando, setDesactivando] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const [marcas, productos] = await Promise.all(LISTAS.map(({ lista }) => apiFetch(`/objetivos/catalogo/${lista}?inactivos=1`)
        .then((r) => leer(r, "No se pudieron cargar las listas"))));
      setDatos({ marcas, productos });
    } catch (e) {
      setErrores((actual) => ({ ...actual, general: e.message }));
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const agregar = async (lista) => {
    setErrores((actual) => ({ ...actual, [lista]: "" }));
    try {
      await apiFetch(`/objetivos/catalogo/${lista}`, { method: "POST", body: JSON.stringify({ nombre: nuevos[lista] }) })
        .then((r) => leer(r, "No se pudo dar de alta"));
      setNuevos((actual) => ({ ...actual, [lista]: "" }));
      await cargar();
      onCambio?.();
    } catch (e) {
      setErrores((actual) => ({ ...actual, [lista]: e.message }));
    }
  };

  const desactivar = async () => {
    setDesactivando((actual) => ({ ...actual, error: "" }));
    try {
      await apiFetch(`/objetivos/catalogo/${desactivando.lista}/${desactivando.id}/desactivar`, {
        method: "POST", body: JSON.stringify({ motivo: desactivando.motivo }),
      }).then((r) => leer(r, "No se pudo desactivar"));
      setDesactivando(null);
      await cargar();
      onCambio?.();
    } catch (e) {
      setDesactivando((actual) => ({ ...actual, error: e.message }));
    }
  };

  return (
    <div className="border-t border-slate-100 pt-3 space-y-3">
      <h3 className="font-medium text-slate-700 flex gap-2 items-center">
        <ListChecks size={18} className="text-blue-600" aria-hidden="true" />
        Listas de marcas y productos
      </h3>
      {errores.general && <p role="alert" className="text-sm text-red-700">{errores.general}</p>}
      <div className="grid md:grid-cols-2 gap-4">
        {LISTAS.map(({ lista, titulo, ejemplo }) => (
          <div key={lista} className="neu-panel rounded-xl p-3 space-y-2 text-sm">
            <h4 className="font-medium text-slate-700">{titulo}</h4>
            <ul className="space-y-1">
              {datos[lista].length === 0 && <li className="text-slate-500">Lista vacía.</li>}
              {datos[lista].map((e) => (
                <li key={e.id} className={`flex justify-between gap-2 ${e.activo ? "" : "text-slate-400"}`}>
                  <span>
                    {e.nombre}
                    {!e.activo && <span className="ml-2">Desactivada: {e.motivo_desactivacion}</span>}
                  </span>
                  {e.activo && (
                    <button type="button" className="text-red-700 hover:underline"
                      onClick={() => setDesactivando({ lista, id: e.id, nombre: e.nombre, motivo: "", error: "" })}>
                      Desactivar
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <form className="flex gap-2 items-center" onSubmit={(ev) => { ev.preventDefault(); agregar(lista); }}>
              <input type="text" maxLength={60} value={nuevos[lista]} placeholder={`Ej. ${ejemplo}`} aria-label={`Nuevo en ${titulo}`}
                onChange={(ev) => setNuevos((actual) => ({ ...actual, [lista]: ev.target.value }))}
                className="neu-campo rounded-lg px-3 py-1.5 flex-1" />
              <button type="submit" disabled={!nuevos[lista].trim()}
                className="bg-blue-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">
                Agregar
              </button>
            </form>
            {errores[lista] && <p role="alert" className="text-red-700">{errores[lista]}</p>}
          </div>
        ))}
      </div>
      {desactivando && (
        <Modal titulo={`Desactivar ${desactivando.nombre}`} cerrar={() => setDesactivando(null)} guardar={desactivar}
          deshabilitado={!desactivando.motivo.trim()}>
          <p className="text-sm text-slate-600">Ya no se podrá elegir para metas ni capturas nuevas. Lo ya capturado conserva su nombre.</p>
          <Campo etiqueta="Motivo obligatorio" valor={desactivando.motivo} area
            cambiar={(motivo) => setDesactivando({ ...desactivando, motivo })} />
          {desactivando.error && <p role="alert" className="text-sm text-red-700">{desactivando.error}</p>}
        </Modal>
      )}
    </div>
  );
}
