import React, { useState, useRef, useEffect } from "react";
import { Send, ChevronDown, ChevronUp } from "lucide-react";
import { apiFetch } from "./api";

const SUGERENCIAS = [
  "¿Cuáles fueron mis ventas totales en junio 2026?",
  "Dame las ventas agrupadas por vendedor",
  "¿Qué productos tienen stock bajo?",
  "Recomiéndame una campaña para hoy según mis clientes"
];

function Ticket({ input, resultado }) {
  const [abierto, setAbierto] = useState(false);
  const titulo = `${input.modulo}.${input.tabla}${input.agrupar_por ? ` (agrupado por ${input.agrupar_por})` : ""}`;
  return (
    <div className="mt-2 border border-dashed border-slate-300 rounded-lg bg-white text-xs font-mono text-slate-500">
      <button onClick={() => setAbierto((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-emerald-700 font-semibold">
        <span>🧾 consulta: {titulo}</span>
        {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {abierto && <pre className="px-3 pb-3 whitespace-pre-wrap break-words">{JSON.stringify(resultado, null, 2)}</pre>}
    </div>
  );
}

export default function AsistenteIA() {
  const [historial, setHistorial] = useState([
    { role: "assistant", content: "Hola, soy tu asistente de negocio. Pregúntame sobre ventas, inventario, clientes o proveedores.", consultas: [] }
  ]);
  const [entrada, setEntrada] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const finRef = useRef(null);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth" }); }, [historial, enviando]);

  const enviar = async (texto) => {
    if (!texto.trim() || enviando) return;
    setError(null);
    const nuevoHistorial = [...historial, { role: "user", content: texto }];
    setHistorial(nuevoHistorial);
    setEntrada("");
    setEnviando(true);

    try {
      const res = await apiFetch("/chat", {
        method: "POST",
        body: JSON.stringify({
          mensajes: nuevoHistorial.map((m) => ({ role: m.role, content: m.content }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setHistorial((prev) => [...prev, { role: "assistant", content: data.respuesta, consultas: data.consultas || [] }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-w-2xl mx-auto w-full">
        {historial.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
              m.role === "user" ? "bg-emerald-700 text-white rounded-br-sm" : "bg-white border border-slate-200 rounded-bl-sm"
            }`}>
              {m.content}
            </div>
            {m.consultas?.map((c, j) => <Ticket key={j} input={c.input} resultado={c.resultado} />)}
          </div>
        ))}
        {enviando && (
          <div className="flex items-start">
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
            ❌ {error}. Verifica que el backend esté corriendo (npm start dentro de /backend) y que ANTHROPIC_API_KEY esté configurada.
          </div>
        )}
        <div ref={finRef} />
      </div>

      {historial.length <= 1 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2 max-w-2xl mx-auto w-full">
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              onClick={() => enviar(s)}
              className="text-xs bg-white border border-slate-200 rounded-full px-3 py-1.5 hover:border-emerald-600 hover:text-emerald-700 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviar(entrada)}
            placeholder="Pregunta algo sobre tu negocio..."
            className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-600"
          />
          <button
            onClick={() => enviar(entrada)}
            disabled={enviando}
            className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white rounded-xl px-4 flex items-center justify-center"
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
