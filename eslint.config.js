/**
 * Configuración de ESLint.
 *
 * Existe por un motivo concreto: `src/MercadoLibre.jsx` llegó a producción
 * llamando a `Number(val)` con una variable que no existía en ningún ámbito
 * del archivo. El empaquetador no puede detectarlo — para Vite, `val` podría
 * ser una global del navegador — y las 1,138 pruebas del backend no miran el
 * frontend. `no-undef` lo caza en un segundo.
 *
 * Dos entornos distintos en el mismo repositorio:
 *   - `src/`     → navegador, módulos ES, JSX
 *   - `backend/` → Node, CommonJS
 */
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "graphify-out/**", "graphify-out.anterior-*/**", ".claude/**", ".agents/**"] },

  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-undef": "error",
      // Avisa, no rompe: un import sin usar es basura, no un error.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^React$" }],
      // Llamar un hook dentro de un if o un bucle rompe React de formas que no
      // se ven hasta que la pantalla se comporta raro. Eso sí es error.
      "react-hooks/rules-of-hooks": "error",
      // Esta avisa nada más: el código ya tiene `eslint-disable` deliberados en
      // varios efectos, y convertirla en error obligaría a revisarlos todos hoy.
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  {
    files: ["backend/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none" }],
    },
  },
];
