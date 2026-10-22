import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ArayuzSaglayici } from "./ortak";
import "./stil.css";

addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest("input, textarea, .cm-editor")) e.preventDefault();
});

createRoot(document.getElementById("kok")!).render(
  <StrictMode>
    <ArayuzSaglayici>
      <App />
    </ArayuzSaglayici>
  </StrictMode>,
);
