import type { Metadata } from "next";
import type { Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Goal Planner",
  description: "A focused daily and weekly command center for schedules, goals, habits, tasks, movement, and reminders.",
  icons: {
    icon: [{ url: "/goal-planner-icon.png", type: "image/png", sizes: "1280x1280" }],
    shortcut: "/goal-planner-icon.png",
    apple: "/goal-planner-icon.png",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#080713",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
