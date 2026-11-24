import type { ComponentType, ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { ToastViewport } from "@/ui";
import { ActivityTray } from "./ActivityTray";
import { Boot } from "./Boot";
import { BrandEffects } from "./BrandEffects";
import { CommandPalette } from "./CommandPalette";
import { CompleteAccountPrompt } from "@/features/accounts/CompleteAccount";
import { AppRoutes } from "./routes";

export interface AppProps {
  /**
   * The router the app runs in. The app's own server answers every address
   * with the app, so it uses the address bar as is; a build served from
   * plain files with no such fallback (the in-browser demo) passes a hash
   * router instead, so a reload or a shared link still opens the right screen.
   */
  router?: ComponentType<{ children?: ReactNode }>;
}

export function App({ router: Router = BrowserRouter }: AppProps = {}) {
  return (
    <Router>
      <BrandEffects />
      <Boot>
        <AppRoutes />
        <CommandPalette />
        <CompleteAccountPrompt />
      </Boot>
      <ToastViewport>
        <ActivityTray />
      </ToastViewport>
    </Router>
  );
}
