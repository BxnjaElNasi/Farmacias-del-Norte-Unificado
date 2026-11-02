import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farmacias del Norte | Tu salud, más cerca",
  description: "Encontrá cuidado y bienestar cerca tuyo en Farmacias del Norte.",
  icons: { icon: "/farmacias-del-norte-logo.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
