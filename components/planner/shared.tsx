"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Clock3, LoaderCircle, Pause, Play, RefreshCcw, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Panel({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return (
    <section className={`vice-panel ${className}`}>
      {title || action ? (
        <div className="panel-heading">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function LoadingState({ label = "Loading your plan…" }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <LoaderCircle className="spin" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-card state-error" role="alert">
      <AlertTriangle />
      <div>
        <strong>Couldn’t load this page</strong>
        <p>{message}</p>
      </div>
      <Button variant="outline" onClick={onRetry}><RefreshCcw /> Retry</Button>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function EntityDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`vice-dialog ${className}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDelete({
  open,
  onOpenChange,
  itemName,
  onConfirm,
  description = "This removes it from your planner permanently. This action cannot be undone.",
  confirmLabel = "Delete",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  onConfirm: () => void | Promise<void>;
  description?: string;
  confirmLabel?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="vice-dialog">
        <AlertDialogHeader>
          <AlertDialogMedia><Trash2 /></AlertDialogMedia>
          <AlertDialogTitle>Delete {itemName}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onConfirm()}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`form-field ${className}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function ProgressRing({ value, label, size = 92 }: { value: number; label: string; size?: number }) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress-ring" style={{ "--progress": `${safeValue * 3.6}deg`, width: size, height: size } as React.CSSProperties} aria-label={`${label}: ${safeValue}%`}>
      <div><strong>{safeValue}%</strong><span>{label}</span></div>
    </div>
  );
}

export function PriorityPill({ priority }: { priority: string }) {
  return <span className={`priority-pill priority-${priority}`}>{priority}</span>;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{status.replaceAll("_", " ")}</span>;
}

export function useResource<T>(loader: () => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const reload = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loader();
      if (requestId === requestRef.current) setData(result);
    } catch (caught) {
      if (requestId === requestRef.current) setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(() => void reload()); }, dependencies);
  return { data, setData, loading, error, reload };
}

export function FocusTimer() {
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const duration = mode === "focus" ? 25 * 60 : 5 * 60;

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setSeconds((current) => {
        if (current > 1) return current - 1;
        setRunning(false);
        const nextMode = mode === "focus" ? "break" : "focus";
        setMode(nextMode);
        const nextDuration = nextMode === "focus" ? 25 * 60 : 5 * 60;
        toast.success(nextMode === "break" ? "Focus block complete — take five." : "Break complete — ready for the next task.");
        return nextDuration;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [running, mode]);

  const progress = 1 - seconds / duration;
  const formatted = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const reset = () => { setRunning(false); setSeconds(duration); };

  return (
    <div className="focus-timer">
      <div className="timer-dial" style={{ "--timer-progress": `${progress * 360}deg` } as React.CSSProperties}>
        <div><Clock3 /><strong>{formatted}</strong><span>{mode === "focus" ? "Deep focus" : "Recovery"}</span></div>
      </div>
      <div className="timer-controls">
        <Button className="neon-button" onClick={() => setRunning((value) => !value)}>{running ? <Pause /> : <Play />}{running ? "Pause" : "Start"}</Button>
        <Button variant="outline" size="icon" aria-label="Reset timer" onClick={reset}><RotateCcw /></Button>
      </div>
      <button className="text-action" onClick={() => { const next = mode === "focus" ? "break" : "focus"; setMode(next); setSeconds(next === "focus" ? 25 * 60 : 5 * 60); setRunning(false); }}>
        Switch to {mode === "focus" ? "five-minute break" : "focus mode"}
      </button>
    </div>
  );
}

export function metricPercent(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}

export function useStableDays(length = 7) {
  return useMemo(() => Array.from({ length }, (_, index) => index), [length]);
}
