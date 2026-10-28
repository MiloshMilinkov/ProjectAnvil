import type { Metadata } from "next";
import "./globals.css";
import "./themes.css";
import "./syntax-light-themes.css";
import "./readability.css";
import "./ui-foundation.css";
import { ThemeProvider } from "./components/ThemeControls";
import AppInstallation from "./components/AppInstallation";
export const metadata: Metadata = {
  title: "ProjectAnvil",
  description: "Project planning, tasks, notes, and visual workspaces.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/projectanvil-180.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ProjectAnvil",
    statusBarStyle: "default",
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="warp" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#14141b" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=(localStorage.getItem('projectanvil-appearance')??localStorage.getItem('forgeboard-appearance'));document.documentElement.dataset.theme=['light','dark','warp','focus','soft'].includes(t||'')?t:'warp'}catch(e){}",
          }}
        />
      </head>
      <body data-projectanvil-shell="public">
        <ThemeProvider>
          <AppInstallation>{children}</AppInstallation>
        </ThemeProvider>
      </body>
    </html>
  );
}
