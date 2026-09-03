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
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  ShieldCheck,
  Settings2,
  Wifi,
  X,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

import { api, ApiError } from "./api";
import { AuthScreen } from "./AuthScreen";
import { formatDateTime } from "./date";
import { ProfileAvatar } from "./ProfileAvatar";
import { watchSessionExpiry } from "./session";
import { DashboardPage } from "./pages/DashboardPage";
import { GoalsPage } from "./pages/GoalsPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { HabitsPage } from "./pages/HabitsPage";
import { InsightsPage } from "./pages/InsightsPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { RemindersPage } from "./pages/RemindersPage";
import { SchedulePage } from "./pages/SchedulePage";
import { SettingsPage } from "./pages/SettingsPage";
import { TimetablePage } from "./pages/TimetablePage";
import { TodosPage } from "./pages/TodosPage";
import type { AuthenticatedUser, PageKey, PlannerSettings, Reminder } from "./types";


const APP_ICON = "/goal-planner-icon.png";

const BASE_NAVIGATION: Array<{ key: PageKey; label: string; icon: typeof CircleGauge }> = [
  { key: "dashboard", label: "Overview", icon: CircleGauge },
  { key: "timetable", label: "Time table", icon: CalendarClock },
  { key: "schedule", label: "Schedule", icon: CalendarDays },
  { key: "todos", label: "To-do", icon: CheckSquare2 },
  { key: "goals", label: "Goals", icon: Goal },
  { key: "habits", label: "Habits", icon: HeartPulse },
  { key: "reminders", label: "Reminders", icon: Bell },
  { key: "insights", label: "Insights", icon: BarChart3 },
  { key: "feedback", label: "Feedback", icon: MessageSquareText },
  { key: "settings", label: "Settings", icon: Settings2 },
];

function pageFromHash(navigation: typeof BASE_NAVIGATION): PageKey {
  if (typeof window === "undefined") return "dashboard";
  const value = window.location.hash.replace("#", "") as PageKey;
  return navigation.some((item) => item.key === value) ? value : "dashboard";
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

function PlannerToaster() {
  return <Toaster theme="dark" position="top-center" duration={7000} richColors closeButton />;
}


export function PlannerApp() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<PlannerSettings | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const navigation = useMemo(() => user?.role === "admin"
    ? [...BASE_NAVIGATION.slice(0, -2), { key: "admin" as const, label: "Admin", icon: ShieldCheck }, ...BASE_NAVIGATION.slice(-2)]
    : BASE_NAVIGATION, [user?.role]);
  const activePage = navigation.find((item) => item.key === page) || navigation[0];
  const profileImage = settings?.profile_image ?? user?.profile_image;
  const appBackground = settings?.background_image
    ? {
        backgroundImage: `linear-gradient(rgba(8,7,19,.78), rgba(8,7,19,.9)), url("${settings.background_image}")`,
        backgroundPosition: "center",
        backgroundSize: "cover",
        backgroundAttachment: "fixed",
      }
    : undefined;

  const navigate = (target: PageKey) => {
    setPage(target);
    setMobileNavOpen(false);
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    const handleHash = () => setPage(pageFromHash(navigation));
    queueMicrotask(handleHash);
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [navigation]);

  useEffect(() => {
    let cancelled = false;
    api.me()
      .then((currentUser) => { if (!cancelled) setUser(currentUser); })
      .catch((caught) => {
        if (cancelled) return;
        setUser(null);
        if (caught instanceof ApiError && caught.status === 401 && /expired/i.test(caught.message)) {
          setAuthNotice("Your session has expired. Sign in again to continue.");
        }
      })
      .finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    return watchSessionExpiry(user.session_expires_at, () => {
      setUser(null);
      setSettings(null);
      setMobileNavOpen(false);
      setPage("dashboard");
      setAuthNotice("Your session has expired. Sign in again to continue.");
      toast.dismiss();
      window.location.hash = "";
    });
  }, [user]);

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
    if (!user || online !== true) return;
    let cancelled = false;
    api.settings().then((nextSettings) => { if (!cancelled) setSettings(nextSettings); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [online, user]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < navigation.length) {
        event.preventDefault();
        navigate(navigation[index].key);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigation]);

  useEffect(() => {
    if (!user || !settings?.notifications_enabled || online !== true) return;
    let cancelled = false;
    const checkReminders = async () => {
      try {
        const reminders = await api.reminders();
        if (cancelled) return;
        const now = Date.now();
        for (const reminder of reminders) {
          if (cancelled) return;
          if (!reminder.enabled || new Date(reminder.remind_at).getTime() > now) continue;
          const key = `vice-reminder:${reminder.id}:${reminder.remind_at}`;
          if (window.localStorage.getItem(key)) continue;
          window.localStorage.setItem(key, "shown");
          toast.info(reminder.title, { description: reminder.body || formatDateTime(reminder.remind_at) });
          if (reminder.channel === "browser" && "Notification" in window && Notification.permission === "granted") {
            new Notification(reminder.title, { body: reminder.body, icon: APP_ICON });
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
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [settings?.notifications_enabled, online, user]);

  const authenticated = (nextUser: AuthenticatedUser, message: string) => {
    setAuthNotice(null);
    setUser(nextUser);
    setAuthLoading(false);
    setPage("dashboard");
    window.location.hash = "dashboard";
    toast.success(message, { description: "Your private planner is ready." });
  };

  const logout = async () => {
    try {
      const result = await api.logout();
      toast.success(result.message);
    } catch (caught) {
      toast.error("Could not complete sign out", { description: caught instanceof Error ? caught.message : "Please try again" });
    } finally {
      setAuthNotice(null);
      setUser(null);
      setSettings(null);
      setMobileNavOpen(false);
      window.location.hash = "";
    }
  };

  const pageComponent = useMemo(() => {
    switch (page) {
      case "timetable": return <TimetablePage />;
      case "schedule": return <SchedulePage />;
      case "todos": return <TodosPage />;
      case "goals": return <GoalsPage />;
      case "habits": return <HabitsPage />;
      case "reminders": return <RemindersPage />;
      case "insights": return <InsightsPage />;
      case "admin": return user?.role === "admin" ? <AdminDashboardPage currentUser={user} /> : <DashboardPage onNavigate={navigate} />;
      case "feedback": return user ? <FeedbackPage currentUser={user} /> : null;
      case "settings": return user ? <SettingsPage currentUser={user} onSettingsChanged={setSettings} /> : null;
      default: return <DashboardPage onNavigate={navigate} />;
    }
  }, [page, user]);

  if (authLoading) {
    return <div className="vice-app auth-loading"><LoaderCircle className="spin" /><span>Securing your planner...</span><PlannerToaster /></div>;
  }

  if (!user) {
    return <div className="vice-app"><AuthScreen onAuthenticated={authenticated} sessionNotice={authNotice} /><PlannerToaster /></div>;
  }

  return (
    <div className={`vice-app ${settings?.compact_mode ? "compact-mode" : ""}`} style={appBackground}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="app-header">
        <div className="brand-lockup">
          <Image src={APP_ICON} alt="" width={42} height={42} unoptimized />
          <div><strong>GOAL</strong><span>PLANNER</span></div>
        </div>
        <nav className={`top-navigation ${user.role === "admin" ? "admin-navigation" : "user-navigation"}`} aria-label="Planner pages">
          {navigation.map((item, index) => {
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
        <div className="header-tools">
          <div className="account-chip" title={`${user.username} · ${user.role}`}><ProfileAvatar name={user.username} image={profileImage} /><div><strong>{user.username}</strong><small>{user.role}</small></div></div>
          <div className={`connection-status ${online ? "is-online" : online === false ? "is-offline" : ""}`} title={online ? "Python backend connected" : "Python backend unavailable"}>
            {online ? <Wifi /> : <CloudOff />}<span>{online ? "Synced" : online === false ? "Offline" : "Checking"}</span>
          </div>
          <button className="logout-button" aria-label="Sign out" title="Sign out" onClick={() => void logout()}><LogOut /></button>
          <button className="mobile-menu-button" aria-label="Open page menu" onClick={() => setMobileNavOpen(true)}><Menu /></button>
        </div>
      </header>

      {online === false ? (
        <div className="offline-banner" role="alert"><CloudOff /><div><strong>The Python backend is offline.</strong><span>Start FastAPI on port 8000, then this page will reconnect automatically.</span></div></div>
      ) : null}

      <main className="app-main">
        <PlannerErrorBoundary key={page}>{pageComponent}</PlannerErrorBoundary>
      </main>

      <footer className="app-footer">
        <div className="footer-brand">
          <Image src={APP_ICON} alt="" width={30} height={30} unoptimized />
          <div className="footer-brand-copy"><strong>Goal Planner powered by Omar Solanki</strong><span>Goal Planner version 3.0</span></div>
        </div>
        <span className="footer-context">{activePage.label} · Personal planning workspace</span>
        <span className="footer-sync">{online ? "Data synced by FastAPI" : "Waiting for the API"}</span>
      </footer>

      <div className={`mobile-nav-drawer ${mobileNavOpen ? "open" : ""}`} aria-hidden={!mobileNavOpen}>
        <button className="mobile-nav-backdrop" aria-label="Close page menu" onClick={() => setMobileNavOpen(false)} />
        <aside>
          <header><div className="brand-lockup"><Image src={APP_ICON} alt="" width={38} height={38} unoptimized /><div><strong>GOAL</strong><span>PLANNER</span></div></div><button aria-label="Close page menu" onClick={() => setMobileNavOpen(false)}><X /></button></header>
          <nav aria-label="Mobile planner pages">
            {navigation.map((item) => { const Icon = item.icon; return <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => navigate(item.key)}><Icon /><span>{item.label}</span></button>; })}
          </nav>
          <div className="mobile-account"><ProfileAvatar name={user.username} image={profileImage} /><div><strong>{user.username}</strong><small>{user.email}</small></div><Button variant="outline" onClick={() => void logout()}><LogOut />Sign out</Button></div>
        </aside>
      </div>

      <PlannerToaster />
    </div>
  );
}
