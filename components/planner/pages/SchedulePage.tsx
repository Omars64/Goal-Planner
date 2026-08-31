"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3, Edit3, MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { api } from "../api";
import { addDays, DAYS, formatTime, startOfWeekSunday, toISODate, todayISO, weekDates } from "../date";
import { ConfirmDelete, EmptyState, EntityDialog, ErrorState, Field, LoadingState, PageHeader, Panel, useResource } from "../shared";
import type { EventInput, PlannerEvent, Recurrence } from "../types";


const CATEGORY_COLORS: Record<string, string> = {
  work: "#8b5cf6",
  personal: "#ec4899",
  health: "#22c55e",
  prayer: "#06b6d4",
  appointment: "#f97316",
  learning: "#eab308",
};

const newEvent = (eventDate: string): EventInput => ({
  title: "",
  description: "",
  event_date: eventDate,
  start_time: "18:00",
  end_time: "18:30",
  category: "personal",
  color: CATEGORY_COLORS.personal,
  location: "",
  recurring_rule: "none",
  completed: false,
});


export function SchedulePage() {
  const [anchor, setAnchor] = useState(startOfWeekSunday(new Date()));
  const dates = useMemo(() => weekDates(anchor), [anchor]);
  const start = toISODate(dates[0]);
  const end = toISODate(dates[6]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PlannerEvent | null>(null);
  const [form, setForm] = useState<EventInput>(newEvent(todayISO()));
  const [deleting, setDeleting] = useState<PlannerEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const eventsResource = useResource(() => api.events(start, end), [start, end]);
  const routinesResource = useResource(() => api.routineBlocks(), []);

  const openCreate = (eventDate = todayISO(), time = "18:00") => {
    setEditing(null);
    const base = newEvent(eventDate);
    base.start_time = time;
    const [hour, minute] = time.split(":").map(Number);
    const endMinutes = hour * 60 + minute + 30;
    base.end_time = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
    setForm(base);
    setDialogOpen(true);
  };

  const openEdit = (event: PlannerEvent) => {
    setEditing(event);
    setForm({
      title: event.title,
      description: event.description,
      event_date: event.event_date,
      start_time: event.start_time,
      end_time: event.end_time,
      category: event.category,
      color: event.color,
      location: event.location,
      recurring_rule: event.recurring_rule,
      completed: event.completed,
    });
    setDialogOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (form.end_time <= form.start_time) {
      toast.error("End time must be later than start time.");
      return;
    }
    setSaving(true);
    try {
      if (editing) await api.updateEvent(editing.id, form);
      else await api.createEvent(form);
      toast.success(editing ? "Schedule event updated" : "Event added to the week");
      setDialogOpen(false);
      await eventsResource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save event");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteEvent(deleting.id);
      toast.success("Event deleted");
      setDeleting(null);
      await eventsResource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete event");
    }
  };

  const allEvents = eventsResource.data || [];
  const routines = routinesResource.data || [];
  const weekTitle = `${dates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${dates[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="page-shell schedule-page">
      <PageHeader
        eyebrow="One-off and recurring plans"
        title="Schedule"
        description="See the whole week at once and place appointments, study, family time, walks, or anything outside the recurring timetable."
        actions={<Button className="neon-button" onClick={() => openCreate()}><Plus /> New event</Button>}
      />

      <Panel className="week-toolbar">
        <div className="week-navigation">
          <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setAnchor(addDays(anchor, -7))}><ChevronLeft /></Button>
          <div><p className="eyebrow">Week of</p><h2>{weekTitle}</h2></div>
          <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setAnchor(addDays(anchor, 7))}><ChevronRight /></Button>
        </div>
        <Button variant="outline" onClick={() => setAnchor(startOfWeekSunday(new Date()))}>This week</Button>
      </Panel>

      {(eventsResource.loading || routinesResource.loading) && !eventsResource.data ? <LoadingState label="Building the weekly schedule…" /> : null}
      {eventsResource.error && !eventsResource.data ? <ErrorState message={eventsResource.error} onRetry={() => void eventsResource.reload()} /> : null}
      {eventsResource.data ? (
        <div className="week-board" role="grid" aria-label={`Schedule for ${weekTitle}`}>
          {dates.map((dateValue, index) => {
            const iso = toISODate(dateValue);
            const dayName = DAYS[index];
            const dayEvents = allEvents.filter((event) => event.event_date === iso);
            const dayRoutine = routines.filter((block) => block.is_active && block.days.includes(dayName));
            const isToday = iso === todayISO();
            return (
              <section className={`week-column ${isToday ? "is-today" : ""}`} key={iso}>
                <header>
                  <span>{dateValue.toLocaleDateString("en-US", { weekday: "short" })}</span>
                  <strong>{dateValue.getDate()}</strong>
                  <small>{dayRoutine.length ? `${dayRoutine.length} routine blocks` : "Open day"}</small>
                </header>
                <div className="week-events">
                  {dayEvents.map((event) => (
                    <article key={event.id} className={event.completed ? "is-complete" : ""} style={{ "--event-color": event.color } as React.CSSProperties}>
                      <div className="event-card-time"><Clock3 /> {formatTime(event.start_time)}</div>
                      <strong>{event.title}</strong>
                      <span>{event.category}</span>
                      {event.location ? <small><MapPin />{event.location}</small> : null}
                      <div className="event-card-actions">
                        <button aria-label={`Edit ${event.title}`} onClick={() => openEdit(event)}><Edit3 /></button>
                        <button aria-label={`Delete ${event.title}`} onClick={() => setDeleting(event)}><Trash2 /></button>
                      </div>
                    </article>
                  ))}
                  {!dayEvents.length ? <p className="day-empty">No one-off events</p> : null}
                </div>
                <button className="add-day-event" onClick={() => openCreate(iso)}><Plus /> Add</button>
              </section>
            );
          })}
        </div>
      ) : null}

      {eventsResource.data && !allEvents.length ? (
        <Panel><EmptyState icon={<CalendarPlus />} title="A clean week" description="Your repeating time table still applies. Add only the one-off events that need a specific date." action={<Button className="neon-button" onClick={() => openCreate(start)}><Plus /> Add first event</Button>} /></Panel>
      ) : null}

      <EntityDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editing ? "Edit schedule event" : "Add schedule event"} description="One-off events appear on the selected week. Recurrence records your intended repeat pattern.">
        <form className="entity-form" onSubmit={save}>
          <Field label="Event title"><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Evening walk" /></Field>
          <div className="form-grid two-columns">
            <Field label="Date"><Input required type="date" value={form.event_date} onChange={(event) => setForm({ ...form, event_date: event.target.value })} /></Field>
            <Field label="Category">
              <Select value={form.category} onValueChange={(value) => setForm({ ...form, category: value, color: CATEGORY_COLORS[value] || form.color })}>
                <SelectTrigger className="full-select"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(CATEGORY_COLORS).map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <div className="form-grid two-columns">
            <Field label="Starts"><Input required type="time" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} /></Field>
            <Field label="Ends"><Input required type="time" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} /></Field>
          </div>
          <div className="form-grid two-columns">
            <Field label="Repeats">
              <Select value={form.recurring_rule} onValueChange={(value) => setForm({ ...form, recurring_rule: value as Recurrence })}>
                <SelectTrigger className="full-select"><SelectValue /></SelectTrigger>
                <SelectContent>{["none", "daily", "weekdays", "weekly", "monthly"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Accent color"><Input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></Field>
          </div>
          <Field label="Location"><Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Office, home, online…" /></Field>
          <Field label="Details"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Anything needed to prepare…" /></Field>
          <label className="single-switch"><Switch checked={form.completed} onCheckedChange={(checked) => setForm({ ...form, completed: checked })} /><span><strong>Completed</strong><small>Mark this event as finished.</small></span></label>
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button className="neon-button" disabled={saving}>{saving ? "Saving…" : editing ? "Save event" : "Add event"}</Button></div>
        </form>
      </EntityDialog>

      <ConfirmDelete open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} itemName={deleting?.title || "event"} onConfirm={remove} />
    </div>
  );
}
