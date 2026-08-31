"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Edit3, Flame, Footprints, NotebookPen, Plus, Route, Sparkles, Target, TimerReset, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { api } from "../api";
import { addDays, DAYS, startOfWeekSunday, toISODate, todayISO, weekDates } from "../date";
import { ConfirmDelete, EmptyState, EntityDialog, ErrorState, Field, LoadingState, PageHeader, Panel, ProgressRing, useResource } from "../shared";
import type { Habit, HabitInput } from "../types";


const ICONS = {
  footprints: Footprints,
  route: Route,
  "timer-reset": TimerReset,
  "notebook-pen": NotebookPen,
  sparkles: Sparkles,
  target: Target,
};

const emptyHabit: HabitInput = {
  name: "",
  description: "",
  icon: "sparkles",
  color: "#f97316",
  target_days: DAYS.slice(0, 5) as unknown as string[],
};


export function HabitsPage() {
  const [anchor, setAnchor] = useState(startOfWeekSunday(new Date()));
  const dates = useMemo(() => weekDates(anchor), [anchor]);
  const start = toISODate(dates[0]);
  const end = toISODate(dates[6]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [form, setForm] = useState<HabitInput>(emptyHabit);
  const [deleting, setDeleting] = useState<Habit | null>(null);
  const [saving, setSaving] = useState(false);
  const resource = useResource(() => api.habits(start, end), [start, end]);

  const summary = useMemo(() => {
    const habits = resource.data || [];
    const targets = habits.reduce((sum, habit) => sum + dates.filter((dateValue) => habit.target_days.includes(DAYS[dateValue.getDay()])).length, 0);
    const complete = habits.reduce((sum, habit) => sum + habit.entries.filter((entry) => entry.completed).length, 0);
    const best = habits.reduce((current, habit) => habit.streak > (current?.streak || -1) ? habit : current, null as Habit | null);
    return { targets, complete, percent: targets ? Math.round(complete / targets * 100) : 0, best };
  }, [resource.data, dates]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyHabit, target_days: [...emptyHabit.target_days] });
    setDialogOpen(true);
  };

  const openEdit = (habit: Habit) => {
    setEditing(habit);
    setForm({ name: habit.name, description: habit.description, icon: habit.icon, color: habit.color, target_days: habit.target_days });
    setDialogOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.target_days.length) {
      toast.error("Select at least one target day.");
      return;
    }
    setSaving(true);
    try {
      if (editing) await api.updateHabit(editing.id, form);
      else await api.createHabit(form);
      toast.success(editing ? "Habit updated" : "Habit added");
      setDialogOpen(false);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save habit");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (habit: Habit, dateValue: Date) => {
    const key = toISODate(dateValue);
    const existing = habit.entries.find((entry) => entry.entry_date === key)?.completed || false;
    try {
      await api.checkInHabit(habit.id, key, !existing);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not update habit");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteHabit(deleting.id);
      toast.success("Habit deleted");
      setDeleting(null);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete habit");
    }
  };

  const weekTitle = `${dates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${dates[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <div className="page-shell habits-page">
      <PageHeader eyebrow="Consistency over intensity" title="Habit tracker" description="Check in daily, protect the streak, and use the weekly grid to see whether the routine is actually realistic." actions={<Button className="neon-button" onClick={openCreate}><Plus /> Add habit</Button>} />

      <div className="habit-summary">
        <Panel className="habit-score"><ProgressRing value={summary.percent} label="week" size={116} /><div><p className="eyebrow">Weekly consistency</p><h2>{summary.complete} of {summary.targets}</h2><span>target check-ins completed</span></div></Panel>
        <Panel className="habit-best"><Flame /><div><p className="eyebrow">Strongest streak</p><h2>{summary.best ? `${summary.best.streak} days` : "No streak yet"}</h2><span>{summary.best?.name || "Complete one check-in to begin"}</span></div></Panel>
      </div>

      <Panel className="habit-week-toolbar">
        <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setAnchor(addDays(anchor, -7))}><ChevronLeft /></Button>
        <div><p className="eyebrow">Tracking week</p><h2>{weekTitle}</h2></div>
        <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setAnchor(addDays(anchor, 7))}><ChevronRight /></Button>
        <Button variant="outline" onClick={() => setAnchor(startOfWeekSunday(new Date()))}>This week</Button>
      </Panel>

      {resource.loading && !resource.data ? <LoadingState label="Loading habit grid…" /> : null}
      {resource.error && !resource.data ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : null}
      {resource.data ? (
        resource.data.length ? (
          <Panel className="habit-grid-panel">
            <div className="habit-grid-scroll">
              <div className="habit-grid" role="grid" aria-label={`Habit tracker for ${weekTitle}`}>
                <div className="habit-grid-corner">Habit</div>
                {dates.map((dateValue) => <div className={`habit-day-head ${toISODate(dateValue) === todayISO() ? "is-today" : ""}`} key={toISODate(dateValue)}><span>{dateValue.toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{dateValue.getDate()}</strong></div>)}
                <div className="habit-grid-corner final-column">Streak</div>
                {resource.data.map((habit) => {
                  const Icon = ICONS[habit.icon as keyof typeof ICONS] || Sparkles;
                  return (
                    <div className="habit-grid-row" key={habit.id}>
                      <div className="habit-name-cell">
                        <span style={{ color: habit.color }}><Icon /></span>
                        <div><strong>{habit.name}</strong><small>{habit.description}</small></div>
                        <div className="row-actions"><Button variant="outline" size="icon-xs" aria-label={`Edit ${habit.name}`} onClick={() => openEdit(habit)}><Edit3 /></Button><Button variant="outline" size="icon-xs" aria-label={`Delete ${habit.name}`} onClick={() => setDeleting(habit)}><Trash2 /></Button></div>
                      </div>
                      {dates.map((dateValue) => {
                        const iso = toISODate(dateValue);
                        const dayName = DAYS[dateValue.getDay()];
                        const target = habit.target_days.includes(dayName);
                        const checked = habit.entries.some((entry) => entry.entry_date === iso && entry.completed);
                        const future = iso > todayISO();
                        return (
                          <button
                            key={iso}
                            className={`habit-day-cell ${target ? "is-target" : "is-rest"} ${checked ? "is-checked" : ""}`}
                            style={{ "--habit-color": habit.color } as React.CSSProperties}
                            aria-label={`${checked ? "Undo" : "Complete"} ${habit.name} on ${iso}`}
                            disabled={future}
                            onClick={() => void toggle(habit, dateValue)}
                          >
                            {checked ? <Check /> : target ? <span /> : <small>rest</small>}
                          </button>
                        );
                      })}
                      <div className="habit-streak-cell"><Flame /><strong>{habit.streak}</strong></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
        ) : (
          <Panel><EmptyState icon={<Sparkles />} title="No habits yet" description="Add one behavior small enough to repeat consistently." action={<Button className="neon-button" onClick={openCreate}><Plus /> Add habit</Button>} /></Panel>
        )
      ) : null}

      <EntityDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editing ? "Edit habit" : "Add a habit"} description="Choose only the days on which this behavior is expected.">
        <form className="entity-form" onSubmit={save}>
          <Field label="Habit name"><Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="30-minute walk" /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What counts as a successful check-in?" /></Field>
          <div className="form-grid two-columns">
            <Field label="Icon"><Select value={form.icon} onValueChange={(value) => setForm({ ...form, icon: value })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(ICONS).map((icon) => <SelectItem value={icon} key={icon}>{icon}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Accent"><Input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></Field>
          </div>
          <Field label="Target days">
            <div className="weekday-checks">
              {DAYS.map((item) => <label key={item}><Checkbox checked={form.target_days.includes(item)} onCheckedChange={(checked) => setForm({ ...form, target_days: checked ? [...form.target_days, item] : form.target_days.filter((value) => value !== item) })} /><span>{item.slice(0, 3)}</span></label>)}
            </div>
          </Field>
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button className="neon-button" disabled={saving}>{saving ? "Saving…" : editing ? "Save habit" : "Add habit"}</Button></div>
        </form>
      </EntityDialog>

      <ConfirmDelete open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} itemName={deleting?.name || "habit"} onConfirm={remove} />
    </div>
  );
}

