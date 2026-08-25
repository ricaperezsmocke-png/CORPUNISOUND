import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.jsx";
import "./index.css";

/**
 * `attribute="class"` es obligatorio: es lo que espera `darkMode: ["class"]`
 * de tailwind.config.js.
 *
 * `enableSystem={false}` es a propósito. El sistema lo usan varias personas en
 * el mismo equipo de tienda, y que el tema cambie solo al anochecer porque
 * Windows lo decidió es una sorpresa, no una función.
 *
 * Efecto secundario esperado: components/ui/sonner.jsx ya llamaba a useTheme()
 * sin recibir ningún provider. Con esto empieza a funcionar solo.
 */
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
