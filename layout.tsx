import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Counterflame FACEIT", description: "Competitive Counterflame matchmaking, rankings and tournaments." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
