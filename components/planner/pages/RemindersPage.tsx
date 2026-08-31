"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Bell, BellRing, Clock3, Edit3, Plus, Repeat2, TimerReset, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { api } from "../api";
import { dateTimeLocalValue, formatDateTime } from "../date";
import { ConfirmDelete, EmptyState, EntityDialog, ErrorState, Field, LoadingState, PageHeader, Panel, useResource } from "../shared";
import type { Recurrence, Reminder, ReminderInput } from "../types";


const emptyReminder = (): ReminderInput => {
  const nextHour = new Date();
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  return {
    title: "",
    body: "",
    remind_at: dateTimeLocalValue(nextHour),
    recurrence: "none",
    enabled: true,
    channel: "browser",
    related_type: null,
    related_id: null,
  };
};

function ReminderList({
  items,
  empty,
  onToggle,
  onSnooze,
  onEdit,
  onDelete,
}: {
  items: Reminder[];
  empty: string;
  onToggle: (reminder: Reminder, enabled: boolean) => void;
  onSnooze: (reminder: Reminder) => void;
  onEdit: (reminder: Reminder) => void;
  onDelete: (reminder: Reminder) => void;
}) {
  if (!items.length) return <p className="section-empty">{empty}</p>;
  return (
    <div className="reminder-list">
      {items.map((reminder) => (
        <article className={`reminder-row ${reminder.enabled ? "" : "is-paused"}`} key={reminder.id}>
          <span className="reminder-icon"><BellRing /></span>
          <div className="reminder-main">
            <div><h3>{reminder.title}</h3>{reminder.recurrence !== "none" ? <span className="recurrence-pill"><Repeat2 />{reminder.recurrence}</span> : null}</div>
            {reminder.body ? <p>{reminder.body}</p> : null}
            <span><Clock3 />{formatDateTime(reminder.remind_at)}</span>
          </div>
          <label className="inline-toggle"><Switch checked={reminder.enabled} onCheckedChange={(checked) => onToggle(reminder, checked)} /><small>{reminder.enabled ? "On" : "Off"}</small></label>
          <div className="row-actions">
            <Button variant="outline" size="icon-sm" aria-label={`Snooze ${reminder.title}`} onClick={() => onSnooze(reminder)}><TimerReset /></Button>
            <Button variant="outline" size="icon-sm" aria-label={`Edit ${reminder.title}`} onClick={() => onEdit(reminder)}><Edit3 /></Button>
            <Button variant="outline" size="icon-sm" aria-label={`Delete ${reminder.title}`} onClick={() => onDelete(reminder)}><Trash2 /></Button>
          </div>
        </article>
      ))}
    </div>
  );
}


export function RemindersPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [form, setForm] = useState<ReminderInput>(emptyReminder());
  const [deleting, setDeleting] = useState<Reminder | null>(null);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  const resource = useResource(() => api.reminders(), []);

  const grouped = useMemo(() => {
    const now = new Date();
    const list = resource.data || [];
    return {
      upcoming: list.filter((reminder) => reminder.enabled && new Date(reminder.remind_at) >= now),
      paused: list.filter((reminder) => !reminder.enabled),
      past: list.filter((reminder) => reminder.enabled && new Date(reminder.remind_at) < now),
    };
  }, [resource.data]);

  const requestPermission = async () => {
    if (!("Notification" in window)) {
      toast.error("This browser does not support desktop notifications.");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    await api.updateSettings({ notifications_enabled: result === "granted" });
    if (result === "granted") toast.success("Desktop reminders enabled");
    else toast.info("Notifications remain disabled; in-app reminder banners still work.");
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyReminder());
    setDialogOpen(true);
  };

  const openEdit = (reminder: Reminder) => {
    setEditing(reminder);
    setForm({
      title: reminder.title,
      body: reminder.body,
      remind_at: reminder.remind_at.slice(0, 16),
      recurrence: reminder.recurrence,
      enabled: reminder.enabled,
      channel: reminder.channel,
      related_type: reminder.related_type,
      related_id: reminder.related_id,
    });
    setDialogOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) await api.updateReminder(editing.id, form);
      else await api.createReminder(form);
      toast.success(editing ? "Reminder updated" : "Reminder armed");
      setDialogOpen(false);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save reminder");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (reminder: Reminder, enabled: boolean) => {
    try {
      await api.updateReminder(reminder.id, { enabled });
      toast.success(enabled ? "Reminder enabled" : "Reminder paused");
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not update reminder");
    }
  };

  const snooze = async (reminder: Reminder, minutes = 10) => {
    const next = new Date();
    next.setMinutes(next.getMinutes() + minutes);
    try {
      await api.updateReminder(reminder.id, { remind_at: dateTimeLocalValue(next), enabled: true });
      toast.success(`Snoozed for ${minutes} minutes`);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not snooze reminder");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteReminder(deleting.id);
      toast.success("Reminder deleted");
      setDeleting(null);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete reminder");
    }
  };

  return (
    <div className="page-shell reminders-page">
      <PageHeader eyebrow="Don’t rely on memory" title="Reminders" description="Schedule one-time or repeating nudges. Browser notifications work while the app is open; in-app alerts are always available." actions={<Button className="neon-button" onClick={openCreate}><Plus /> Add reminder</Button>} />

      <Panel className="notification-banner">
        <div className="notification-copy"><span><Bell /></span><div><p className="eyebrow">Desktop notifications</p><h2>{permission === "granted" ? "Enabled" : permission === "denied" ? "Blocked by browser" : permission === "unsupported" ? "Not supported" : "Permission needed"}</h2><p>Allow notifications so reminders can appear even when you are viewing another browser tab.</p></div></div>
        {permission === "default" ? <Button className="neon-button" onClick={() => void requestPermission()}>Enable notifications</Button> : permission === "denied" ? <span className="permission-note">Enable them in your browser’s site settings.</span> : null}
      </Panel>

      {resource.loading && !resource.data ? <LoadingState label="Loading reminders…" /> : null}
      {resource.error && !resource.data ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : null}
      {resource.data ? (
        resource.data.length ? (
          <div className="reminder-sections">
            <Panel title={`Upcoming · ${grouped.upcoming.length}`}><ReminderList items={grouped.upcoming} empty="No upcoming reminders." onToggle={(item, enabled) => void toggle(item, enabled)} onSnooze={(item) => void snooze(item)} onEdit={openEdit} onDelete={setDeleting} /></Panel>
            {grouped.paused.length ? <Panel title={`Paused · ${grouped.paused.length}`}><ReminderList items={grouped.paused} empty="No paused reminders." onToggle={(item, enabled) => void toggle(item, enabled)} onSnooze={(item) => void snooze(item)} onEdit={openEdit} onDelete={setDeleting} /></Panel> : null}
            {grouped.past.length ? <Panel title={`Past · ${grouped.past.length}`}><ReminderList items={grouped.past} empty="No past reminders." onToggle={(item, enabled) => void toggle(item, enabled)} onSnooze={(item) => void snooze(item)} onEdit={openEdit} onDelete={setDeleting} /></Panel> : null}
          </div>
        ) : (
          <Panel><EmptyState icon={<Bell />} title="No reminders armed" description="Create a reminder for movement, planning, or a time-sensitive task." action={<Button className="neon-button" onClick={openCreate}><Plus /> Add reminder</Button>} /></Panel>
        )
      ) : null}

      <EntityDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editing ? "Edit reminder" : "Add reminder"} description="Your browser must be open for local desktop notifications to fire.">
        <form className="entity-form" onSubmit={save}>
          <Field label="Reminder title"><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Stand and reset posture" /></Field>
          <Field label="Message"><Textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="A short instruction that is easy to act on…" /></Field>
          <Field label="Date and time"><Input required type="datetime-local" value={form.remind_at} onChange={(event) => setForm({ ...form, remind_at: event.target.value })} /></Field>
          <div className="form-grid two-columns">
            <Field label="Repeats"><Select value={form.recurrence} onValueChange={(value) => setForm({ ...form, recurrence: value as Recurrence })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent>{["none", "daily", "weekdays", "weekly", "monthly"].map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Channel"><Select value={form.channel} onValueChange={(value) => setForm({ ...form, channel: value as "browser" | "in_app" })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="browser">Browser + in-app</SelectItem><SelectItem value="in_app">In-app only</SelectItem></SelectContent></Select></Field>
          </div>
          <label className="single-switch"><Switch checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked })} /><span><strong>Enabled</strong><small>Pause it without deleting it.</small></span></label>
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button className="neon-button" disabled={saving}>{saving ? "Saving…" : editing ? "Save reminder" : "Arm reminder"}</Button></div>
        </form>
      </EntityDialog>

      <ConfirmDelete open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} itemName={deleting?.title || "reminder"} onConfirm={remove} />
    </div>
  );
}
