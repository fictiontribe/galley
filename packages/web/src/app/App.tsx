import { BrowserRouter } from "react-router-dom";
import { ToastViewport } from "@/ui";
import { ActivityTray } from "./ActivityTray";
import { Boot } from "./Boot";
import { BrandEffects } from "./BrandEffects";
import { CommandPalette } from "./CommandPalette";
import { AppRoutes } from "./routes";

export function App() {
  return (
    <BrowserRouter>
      <BrandEffects />
      <Boot>
        <AppRoutes />
        <CommandPalette />
      </Boot>
      <ToastViewport>
        <ActivityTray />
      </ToastViewport>
    </BrowserRouter>
  );
}
