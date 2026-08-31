"use client";

import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckSquare2,
  CircleGauge,
  CloudOff,
  Goal,
  HeartPulse,
  Menu,
  Settings2,
  Wifi,
  X,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

import { api } from "./api";
import { formatDateTime } from "./date";
import { DashboardPage } from "./pages/DashboardPage";
import { GoalsPage } from "./pages/GoalsPage";
import { HabitsPage } from "./pages/HabitsPage";
import { InsightsPage } from "./pages/InsightsPage";
import { RemindersPage } from "./pages/RemindersPage";
import { SchedulePage } from "./pages/SchedulePage";
import { SettingsPage } from "./pages/SettingsPage";
import { TimetablePage } from "./pages/TimetablePage";
import { TodosPage } from "./pages/TodosPage";
import type { PageKey, PlannerSettings, Reminder } from "./types";


const NAVIGATION: Array<{ key: PageKey; label: string; shortLabel: string; icon: typeof CircleGauge }> = [
  { key: "dashboard", label: "Overview", shortLabel: "Home", icon: CircleGauge },
  { key: "timetable", label: "Time table", shortLabel: "Time", icon: CalendarClock },
  { key: "schedule", label: "Schedule", shortLabel: "Week", icon: CalendarDays },
  { key: "todos", label: "To-do", shortLabel: "Tasks", icon: CheckSquare2 },
  { key: "goals", label: "Goals", shortLabel: "Goals", icon: Goal },
  { key: "habits", label: "Habits", shortLabel: "Habits", icon: HeartPulse },
  { key: "reminders", label: "Reminders", shortLabel: "Alerts", icon: Bell },
  { key: "insights", label: "Insights", shortLabel: "Stats", icon: BarChart3 },
  { key: "settings", label: "Settings", shortLabel: "Setup", icon: Settings2 },
];

function pageFromHash(): PageKey {
  if (typeof window === "undefined") return "dashboard";
  const value = window.location.hash.replace("#", "") as PageKey;
  return NAVIGATION.some((item) => item.key === value) ? value : "dashboard";
}

function nextReminderDate(reminder: Reminder): string | null {
  if (reminder.recurrence === "none") return null;
  const next = new Date(reminder.remind_at);
  if (reminder.recurrence === "daily") next.setDate(next.getDate() + 1);
  if (reminder.recurrence === "weekly") next.setDate(next.getDate() + 7);
  if (reminder.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
  if (reminder.recurrence === "weekdays") {
    do next.setDate(next.getDate() + 1); while (next.getDay() === 5 || next.getDay() === 6);
  }
  const offset = next.getTimezoneOffset();
  return new Date(next.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

class PlannerErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Planner page error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal-state">
          <span><CloudOff /></span>
          <h1>This page hit a roadblock.</h1>
          <p>{this.state.error.message}</p>
          <Button className="neon-button" onClick={() => { this.setState({ error: null }); window.location.hash = "dashboard"; window.location.reload(); }}>Return to overview</Button>
        </div>
      );
    }
    return this.props.children;
  }
}


export function PlannerApp() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<PlannerSettings | null>(null);
  const activePage = NAVIGATION.find((item) => item.key === page) || NAVIGATION[0];

  const navigate = (target: PageKey) => {
    setPage(target);
    setMobileNavOpen(false);
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    const handleHash = () => setPage(pageFromHash());
    queueMicrotask(handleHash);
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        await api.health();
        setOnline(true);
      } catch {
        setOnline(false);
      }
    };
    void check();
    const interval = window.setInterval(check, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => undefined);
  }, [online]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < NAVIGATION.length) {
        event.preventDefault();
        navigate(NAVIGATION[index].key);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!settings?.notifications_enabled || online !== true) return;
    const checkReminders = async () => {
      try {
        const reminders = await api.reminders();
        const now = Date.now();
        for (const reminder of reminders) {
          if (!reminder.enabled || new Date(reminder.remind_at).getTime() > now) continue;
          const key = `vice-reminder:${reminder.id}:${reminder.remind_at}`;
          if (window.localStorage.getItem(key)) continue;
          window.localStorage.setItem(key, "shown");
          toast.info(reminder.title, { description: reminder.body || formatDateTime(reminder.remind_at), duration: 12_000 });
          if (reminder.channel === "browser" && "Notification" in window && Notification.permission === "granted") {
            new Notification(reminder.title, { body: reminder.body, icon: "/favicon.ico" });
          }
          const next = nextReminderDate(reminder);
          if (next) await api.updateReminder(reminder.id, { remind_at: next });
          else await api.updateReminder(reminder.id, { enabled: false });
        }
      } catch {
        // Connectivity is reported globally; reminder polling can retry quietly.
      }
    };
    void checkReminders();
    const interval = window.setInterval(checkReminders, 30_000);
    return () => window.clearInterval(interval);
  }, [settings?.notifications_enabled, online]);

  const pageComponent = useMemo(() => {
    switch (page) {
      case "timetable": return <TimetablePage />;
      case "schedule": return <SchedulePage />;
      case "todos": return <TodosPage />;
      case "goals": return <GoalsPage />;
      case "habits": return <HabitsPage />;
      case "reminders": return <RemindersPage />;
      case "insights": return <InsightsPage />;
      case "settings": return <SettingsPage onSettingsChanged={setSettings} />;
      default: return <DashboardPage onNavigate={navigate} />;
    }
  }, [page]);

  return (
    <div className={`vice-app ${settings?.compact_mode ? "compact-mode" : ""}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="app-header">
        <div className="brand-lockup">
          <Image src="/favicon.ico" alt="" width={32} height={32} unoptimized />
          <div><strong>VICE</strong><span>PLANNER</span></div>
          <b>06</b>
        </div>
        <button className="mobile-menu-button" aria-label="Open page menu" onClick={() => setMobileNavOpen(true)}><Menu /></button>
        <nav className="top-navigation" aria-label="Planner pages">
          {NAVIGATION.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={page === item.key ? "active" : ""}
                aria-current={page === item.key ? "page" : undefined}
                title={`${item.label} · Alt+${index + 1}`}
                onClick={() => navigate(item.key)}
              >
                <Icon /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className={`connection-status ${online ? "is-online" : online === false ? "is-offline" : ""}`} title={online ? "Python backend connected" : "Python backend unavailable"}>
          {online ? <Wifi /> : <CloudOff />}<span>{online ? "Synced" : online === false ? "Offline" : "Checking"}</span>
        </div>
      </header>

      {online === false ? (
        <div className="offline-banner" role="alert"><CloudOff /><div><strong>The Python backend is offline.</strong><span>Start FastAPI on port 8000, then this page will reconnect automatically.</span></div></div>
      ) : null}

      <main className="app-main">
        <PlannerErrorBoundary key={page}>{pageComponent}</PlannerErrorBoundary>
      </main>

      <footer className="app-footer">
        <div><Image src="/favicon.ico" alt="" width={20} height={20} unoptimized /><span>Vice Planner</span></div>
        <span>{activePage.label} · Local-first personal planning</span>
        <span>{online ? "Data saved by FastAPI + SQLite" : "Waiting for the API"}</span>
      </footer>

      <div className={`mobile-nav-drawer ${mobileNavOpen ? "open" : ""}`} aria-hidden={!mobileNavOpen}>
        <button className="mobile-nav-backdrop" aria-label="Close page menu" onClick={() => setMobileNavOpen(false)} />
        <aside>
          <header><div className="brand-lockup"><Image src="/favicon.ico" alt="" width={28} height={28} unoptimized /><div><strong>VICE</strong><span>PLANNER</span></div></div><button aria-label="Close page menu" onClick={() => setMobileNavOpen(false)}><X /></button></header>
          <nav aria-label="Mobile planner pages">
            {NAVIGATION.map((item) => { const Icon = item.icon; return <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => navigate(item.key)}><Icon /><span>{item.label}</span></button>; })}
          </nav>
        </aside>
      </div>

      <Toaster theme="dark" position="top-right" richColors closeButton />
    </div>
  );
}
