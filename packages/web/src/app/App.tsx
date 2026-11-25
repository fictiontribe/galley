import type { ComponentType, ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { ToastViewport } from "@/ui";
import { ActivityTray } from "./ActivityTray";
import { Boot } from "./Boot";
import { BrandEffects } from "./BrandEffects";
import { CommandPalette } from "./CommandPalette";
import { CornerThemeSwitch } from "./ThemeSwitch";
import { CompleteAccountPrompt } from "@/features/accounts/CompleteAccount";
import { AdditionRoots, AdditionsProvider } from "@/additions/places";
import type { Addition } from "@/additions/types";
import { AppRoutes } from "./routes";

export interface AppProps {
  /**
   * The router the app runs in. The app's own server answers every address
   * with the app, so it uses the address bar as is; a build served from
   * plain files with no such fallback (the in-browser demo) passes a hash
   * router instead, so a reload or a shared link still opens the right screen.
   */
  router?: ComponentType<{ children?: ReactNode }>;
  /**
   * What a program that builds its own edition of the editor draws in the
   * app (src/additions). Experimental. Read once, when the app starts; the
   * app as it ships passes none, and every place then renders nothing.
   */
  additions?: readonly Addition[];
}

export function App({ router: Router = BrowserRouter, additions }: AppProps = {}) {
  return (
    <AdditionsProvider additions={additions}>
      <Router>
        <BrandEffects />
        <Boot>
          <AppRoutes />
          <CommandPalette />
          <CornerThemeSwitch />
          <CompleteAccountPrompt />
          <AdditionRoots />
        </Boot>
        <ToastViewport>
          <ActivityTray />
        </ToastViewport>
      </Router>
    </AdditionsProvider>
  );
}
