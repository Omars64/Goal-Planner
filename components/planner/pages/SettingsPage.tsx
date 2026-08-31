"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bell, CheckCircle2, Database, Download, HardDrive, RefreshCcw, Save, Server, Upload } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { api } from "../api";
import { DAYS, todayISO } from "../date";
import { ErrorState, Field, LoadingState, PageHeader, Panel, useResource } from "../shared";
import type { PlannerSettings } from "../types";


export function SettingsPage({ onSettingsChanged }: { onSettingsChanged?: (settings: PlannerSettings) => void }) {
  const resource = useResource(() => api.settings(), []);
  const [form, setForm] = useState<PlannerSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [resetOpen, setResetOpen] = useState(false);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (resource.data) queueMicrotask(() => setForm(resource.data)); }, [resource.data]);
  useEffect(() => { api.health().then(() => setApiHealthy(true)).catch(() => setApiHealthy(false)); }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const updated = await api.updateSettings(form);
      setForm(updated);
      onSettingsChanged?.(updated);
      toast.success("Planner settings saved");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const exportPlanner = async () => {
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `goal-planner-backup-${todayISO()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Planner backup downloaded");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not export planner data");
    }
  };

  const importPlanner = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      const result = await api.importData(parsed, importMode);
      toast.success(`${result.records_imported} records imported`);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The selected backup could not be imported");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const reset = async () => {
    try {
      await api.reset();
      toast.success("Starter workday planner restored");
      setResetOpen(false);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not restore starter data");
    }
  };

  return (
    <div className="page-shell settings-page">
      <PageHeader eyebrow="Make it yours" title="Settings & data" description="Adjust the planner defaults, verify the backend, and keep a portable JSON backup of everything you create." />

      {resource.loading && !form ? <LoadingState label="Loading settings…" /> : null}
      {resource.error && !form ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : null}
      {form ? (
        <div className="settings-layout">
          <Panel className="settings-profile" title="Planner profile">
            <form className="entity-form" onSubmit={save}>
              <div className="form-grid two-columns">
                <Field label="Display name"><Input required value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></Field>
                <Field label="Time zone"><Input required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} placeholder="Asia/Kuwait" /></Field>
              </div>
              <div className="form-grid three-columns">
                <Field label="Work starts"><Input type="time" value={form.work_start} onChange={(event) => setForm({ ...form, work_start: event.target.value })} /></Field>
                <Field label="Work ends"><Input type="time" value={form.work_end} onChange={(event) => setForm({ ...form, work_end: event.target.value })} /></Field>
                <Field label="Daily step goal"><Input type="number" min="1000" max="100000" step="500" value={form.daily_step_goal} onChange={(event) => setForm({ ...form, daily_step_goal: Number(event.target.value) })} /></Field>
              </div>
              <Field label="Work days">
                <div className="weekday-checks">
                  {DAYS.map((day) => <label key={day}><Checkbox checked={form.work_days.includes(day)} onCheckedChange={(checked) => setForm({ ...form, work_days: checked ? [...form.work_days, day] : form.work_days.filter((value) => value !== day) })} /><span>{day.slice(0, 3)}</span></label>)}
                </div>
              </Field>
              <div className="form-grid two-columns">
                <Field label="Week starts on"><Select value={form.week_start} onValueChange={(value) => setForm({ ...form, week_start: value as "sunday" | "monday" })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sunday">Sunday</SelectItem><SelectItem value="monday">Monday</SelectItem></SelectContent></Select></Field>
                <div className="settings-toggles">
                  <label><Switch checked={form.compact_mode} onCheckedChange={(checked) => setForm({ ...form, compact_mode: checked })} /><span><strong>Compact layout</strong><small>Reduce spacing on dense pages.</small></span></label>
                  <label><Switch checked={form.notifications_enabled} onCheckedChange={(checked) => setForm({ ...form, notifications_enabled: checked })} /><span><strong>Reminder checks</strong><small>Allow in-app reminder polling.</small></span></label>
                </div>
              </div>
              <div className="dialog-actions"><Button className="neon-button" disabled={saving}><Save />{saving ? "Saving…" : "Save settings"}</Button></div>
            </form>
          </Panel>

          <Panel className="system-status" title="System status">
            <div className="status-stack">
              <article><span className={apiHealthy ? "status-ok" : apiHealthy === false ? "status-bad" : "status-wait"}><Server /></span><div><strong>Python API</strong><small>{apiHealthy ? "Connected and healthy" : apiHealthy === false ? "Unavailable — start the backend" : "Checking connection…"}</small></div>{apiHealthy ? <CheckCircle2 /> : null}</article>
              <article><span className="status-ok"><Database /></span><div><strong>Planner database</strong><small>Persistent server-side planner records</small></div><CheckCircle2 /></article>
              <article><span className="status-ok"><HardDrive /></span><div><strong>Portable backup</strong><small>JSON import and export supported</small></div><CheckCircle2 /></article>
              <article><span className={form.notifications_enabled ? "status-ok" : "status-wait"}><Bell /></span><div><strong>Reminder checks</strong><small>{form.notifications_enabled ? "Enabled" : "Disabled in planner settings"}</small></div></article>
            </div>
            <div className="api-address"><span>API endpoint</span><code>{api.baseUrl}</code></div>
          </Panel>

          <Panel className="data-management" title="Backup & restore">
            <div className="data-actions">
              <article><span><Download /></span><div><h3>Export everything</h3><p>Download tasks, schedules, goals, habits, reminders, and settings as one JSON file.</p></div><Button variant="outline" onClick={() => void exportPlanner()}>Download backup</Button></article>
              <article><span><Upload /></span><div><h3>Import a backup</h3><p>Merge records with the current planner, or replace all data with the selected backup.</p><Select value={importMode} onValueChange={(value) => setImportMode(value as "merge" | "replace")}><SelectTrigger className="import-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="merge">Merge with current data</SelectItem><SelectItem value="replace">Replace current data</SelectItem></SelectContent></Select></div><input ref={fileRef} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPlanner(file); }} /><Button variant="outline" onClick={() => fileRef.current?.click()}>Choose backup</Button></article>
            </div>
          </Panel>

          <Panel className="danger-zone" title="Restore starter planner">
            <div><span><RefreshCcw /></span><div><h3>Reset all planner data</h3><p>Delete current records and restore the included Sunday–Thursday engineering workday, prayer, lunch, and movement template.</p></div><Button variant="destructive" onClick={() => setResetOpen(true)}>Reset planner</Button></div>
          </Panel>
        </div>
      ) : null}

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent className="vice-dialog">
          <AlertDialogHeader><AlertDialogMedia><RefreshCcw /></AlertDialogMedia><AlertDialogTitle>Reset the entire planner?</AlertDialogTitle><AlertDialogDescription>All current tasks, goals, schedules, habits, check-ins, and reminders will be removed and replaced with the starter template. Export a backup first if needed.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void reset()}>Reset everything</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
