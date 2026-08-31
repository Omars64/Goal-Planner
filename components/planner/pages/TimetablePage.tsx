"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Activity, CalendarClock, Edit3, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { api } from "../api";
import { DAYS, formatTime, minutesBetween } from "../date";
import { ConfirmDelete, EmptyState, EntityDialog, ErrorState, Field, LoadingState, PageHeader, Panel, useResource } from "../shared";
import type { RoutineBlock, RoutineInput } from "../types";


const WORK_DAYS = DAYS.slice(0, 5);
const CATEGORY_COLORS: Record<string, string> = {
  work: "#8b5cf6",
  movement: "#22c55e",
  prayer: "#06b6d4",
  break: "#f97316",
  planning: "#ec4899",
  personal: "#f43f5e",
};

const emptyRoutine: RoutineInput = {
  title: "",
  days: [...WORK_DAYS],
  start_time: "08:00",
  end_time: "08:30",
  category: "work",
  color: CATEGORY_COLORS.work,
  notes: "",
  is_movement: false,
  is_active: true,
};


export function TimetablePage() {
  const currentDay = DAYS[new Date().getDay()];
  const [day, setDay] = useState<string>(WORK_DAYS.includes(currentDay as typeof WORK_DAYS[number]) ? currentDay : "sunday");
  const [showMovementOnly, setShowMovementOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RoutineBlock | null>(null);
  const [form, setForm] = useState<RoutineInput>(emptyRoutine);
  const [deleting, setDeleting] = useState<RoutineBlock | null>(null);
  const [saving, setSaving] = useState(false);
  const { data, loading, error, reload } = useResource(() => api.routineBlocks(day), [day]);

  const blocks = useMemo(
    () => (data || []).filter((block) => !showMovementOnly || block.is_movement),
    [data, showMovementOnly],
  );
  const totalMovement = (data || []).filter((block) => block.is_movement).reduce((sum, block) => sum + minutesBetween(block.start_time, block.end_time), 0);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyRoutine, days: [day] });
    setDialogOpen(true);
  };

  const openEdit = (block: RoutineBlock) => {
    setEditing(block);
    setForm({
      title: block.title,
      days: block.days,
      start_time: block.start_time,
      end_time: block.end_time,
      category: block.category,
      color: block.color,
      notes: block.notes,
      is_movement: block.is_movement,
      is_active: block.is_active,
    });
    setDialogOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (form.end_time <= form.start_time) {
      toast.error("End time must be later than start time.");
      return;
    }
    if (!form.days.length) {
      toast.error("Select at least one day.");
      return;
    }
    setSaving(true);
    try {
      if (editing) await api.updateRoutineBlock(editing.id, form);
      else await api.createRoutineBlock(form);
      toast.success(editing ? "Timetable block updated" : "Timetable block added");
      setDialogOpen(false);
      await reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save timetable block");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteRoutineBlock(deleting.id);
      toast.success("Timetable block deleted");
      setDeleting(null);
      await reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete block");
    }
  };

  return (
    <div className="page-shell timetable-page">
      <PageHeader
        eyebrow="Recurring weekly structure"
        title="Time table"
        description="Build the repeatable shape of your workday, including prayer, breaks, focused work, and short movement resets."
        actions={<Button className="neon-button" onClick={openCreate}><Plus /> Add block</Button>}
      />

      <Panel className="timetable-toolbar">
        <div className="day-switcher" role="tablist" aria-label="Timetable day">
          {WORK_DAYS.map((item) => (
            <button key={item} role="tab" aria-selected={day === item} className={day === item ? "active" : ""} onClick={() => setDay(item)}>
              <span>{item.slice(0, 3)}</span><small>{item}</small>
            </button>
          ))}
        </div>
        <div className="toolbar-stat"><Activity /><div><strong>{totalMovement} min</strong><span>movement planned</span></div></div>
        <label className="switch-label"><Switch checked={showMovementOnly} onCheckedChange={setShowMovementOnly} /><span>Movement only</span></label>
      </Panel>

      {loading && !data ? <LoadingState label="Loading your recurring timetable…" /> : null}
      {error && !data ? <ErrorState message={error} onRetry={() => void reload()} /> : null}
      {data ? (
        <Panel className="timetable-board">
          <div className="timetable-day-title">
            <div><p className="eyebrow">Selected day</p><h2>{day}</h2></div>
            <span>{blocks.length} blocks</span>
          </div>
          {blocks.length ? (
            <div className="timetable-list">
              {blocks.map((block, index) => (
                <article className={`time-block ${block.is_movement ? "movement-block" : ""} ${block.is_active ? "" : "inactive-block"}`} key={block.id}>
                  <div className="time-block-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="time-block-time"><strong>{formatTime(block.start_time)}</strong><span>{formatTime(block.end_time)}</span><small>{minutesBetween(block.start_time, block.end_time)} min</small></div>
                  <span className="time-block-line" style={{ backgroundColor: block.color }} />
                  <div className="time-block-copy">
                    <div><span className="category-label" style={{ color: block.color }}>{block.category}</span>{block.is_movement ? <span className="movement-label"><Activity /> movement</span> : null}</div>
                    <h3>{block.title}</h3>
                    <p>{block.notes || "No notes added."}</p>
                  </div>
                  <div className="row-actions">
                    <Button variant="outline" size="icon-sm" aria-label={`Edit ${block.title}`} onClick={() => openEdit(block)}><Edit3 /></Button>
                    <Button variant="outline" size="icon-sm" aria-label={`Delete ${block.title}`} onClick={() => setDeleting(block)}><Trash2 /></Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={<CalendarClock />} title="No blocks for this view" description={showMovementOnly ? "This day has no movement blocks yet." : "Create the first recurring block for this day."} action={<Button className="neon-button" onClick={openCreate}><Plus /> Add block</Button>} />
          )}
        </Panel>
      ) : null}

      <EntityDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editing ? "Edit timetable block" : "Add timetable block"} description="This block repeats on every selected weekday.">
        <form className="entity-form" onSubmit={save}>
          <Field label="Title"><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Focused development" /></Field>
          <div className="form-grid two-columns">
            <Field label="Start time"><Input required type="time" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></Field>
            <Field label="End time"><Input required type="time" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></Field>
          </div>
          <Field label="Repeat on">
            <div className="weekday-checks">
              {DAYS.map((item) => (
                <label key={item}><Checkbox checked={form.days.includes(item)} onCheckedChange={(checked) => setForm({ ...form, days: checked ? [...form.days, item] : form.days.filter((value) => value !== item) })} /><span>{item.slice(0, 3)}</span></label>
              ))}
            </div>
          </Field>
          <div className="form-grid two-columns">
            <Field label="Category">
              <Select value={form.category} onValueChange={(value) => setForm({ ...form, category: value, color: CATEGORY_COLORS[value] || form.color, is_movement: value === "movement" ? true : form.is_movement })}>
                <SelectTrigger className="full-select"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(CATEGORY_COLORS).map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Accent color"><Input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Purpose, instructions or preparation notes…" /></Field>
          <div className="form-switches">
            <label><Switch checked={form.is_movement} onCheckedChange={(checked) => setForm({ ...form, is_movement: checked })} /><span><strong>Movement block</strong><small>Count this toward the day’s planned movement.</small></span></label>
            <label><Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} /><span><strong>Active</strong><small>Show this block in the daily plan.</small></span></label>
          </div>
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button className="neon-button" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add block"}</Button></div>
        </form>
      </EntityDialog>

      <ConfirmDelete open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} itemName={deleting?.title || "block"} onConfirm={remove} />
    </div>
  );
}
