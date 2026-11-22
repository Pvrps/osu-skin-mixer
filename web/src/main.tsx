import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConfirmHost } from "./components/Confirm";
import "./styles.css";

// Held open for as long as the page is, which tells the mixer when its window has been closed.
new EventSource("/api/session");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <ConfirmHost />
  </StrictMode>,
);
