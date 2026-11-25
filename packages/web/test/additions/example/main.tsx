/**
 * The smallest program that builds its own edition of the editor: the app,
 * its styles, and one addition. It is what the docs page shows, built by a
 * test so the page stays true.
 */
import "@galley/web/styles";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@galley/web/app";
import { statusAddition } from "./status";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App additions={[statusAddition]} />
  </StrictMode>,
);
