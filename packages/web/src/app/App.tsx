import { BrowserRouter } from "react-router-dom";
import { ToastViewport } from "@/ui";
import { ActivityTray } from "./ActivityTray";
import { Boot } from "./Boot";
import { BrandEffects } from "./BrandEffects";
import { CommandPalette } from "./CommandPalette";
import { CornerThemeSwitch } from "./ThemeSwitch";
import { CompleteAccountPrompt } from "@/features/accounts/CompleteAccount";
import { AppRoutes } from "./routes";

export function App() {
  return (
    <BrowserRouter>
      <BrandEffects />
      <Boot>
        <AppRoutes />
        <CommandPalette />
        <CornerThemeSwitch />
        <CompleteAccountPrompt />
      </Boot>
      <ToastViewport>
        <ActivityTray />
      </ToastViewport>
    </BrowserRouter>
  );
}
