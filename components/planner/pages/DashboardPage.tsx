"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Footprints,
  ListChecks,
  Sparkles,
  Target,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

import { api } from "../api";
import { formatDay, formatTime, fromISODate, todayISO } from "../date";
import {
  ErrorState,
  FocusTimer,
  LoadingState,
  PageHeader,
  Panel,
  PriorityPill,
  ProgressRing,
  metricPercent,
  useClock,
  useResource,
} from "../shared";
import type { PageKey } from "../types";


export function DashboardPage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const now = useClock();
  const { data, loading, error, reload } = useResource(() => api.dashboard(selectedDate), [selectedDate]);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentBlockId = useMemo(() => {
    if (!data || selectedDate !== todayISO()) return null;
    const current = data.routine.find((block) => {
      const [startHour, startMinute] = block.start_time.split(":").map(Number);
      const [endHour, endMinute] = block.end_time.split(":").map(Number);
      return currentMinutes >= startHour * 60 + startMinute && currentMinutes < endHour * 60 + endMinute;
    });
    return current?.id ?? null;
  }, [data, selectedDate, currentMinutes]);

  const toggleTask = async (id: string, completed: boolean) => {
    try {
      await api.updateTask(id, { status: completed ? "done" : "todo" });
      toast.success(completed ? "Mission completed" : "Task returned to the list");
      await reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not update task");
    }
  };

  const toggleHabit = async (habitId: string, completed: boolean) => {
    try {
      await api.checkInHabit(habitId, selectedDate, completed);
      toast.success(completed ? "Habit checked in" : "Habit check-in removed");
      await reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not update habit");
    }
  };

  if (loading && !data) return <LoadingState label="Loading today’s command center…" />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return null;

  const taskRate = metricPercent(data.metrics.tasks_completed, data.metrics.tasks_total);
  const habitRate = metricPercent(data.metrics.habits_completed, data.metrics.habits_total);
  const dayScore = Math.round(taskRate * 0.55 + habitRate * 0.45);
  const selectedDay = fromISODate(selectedDate);
  const completedHabitIds = new Set(data.habit_entries.filter((entry) => entry.completed).map((entry) => entry.habit_id));
  const incompleteTasks = data.tasks.filter((task) => task.status !== "done" && task.status !== "archived").slice(0, 5);
  const visibleRoutine = data.routine.filter((block) => block.is_active);

  return (
    <div className="page-shell dashboard-page">
      <PageHeader
        eyebrow="Daily command center"
        title={`Good ${now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"}, ${data.settings.display_name}.`}
        description={`${formatDay(selectedDay)} · Keep the plan visible, the movement light, and the next action obvious.`}
        actions={
          <div className="date-control">
            <CalendarDays />
            <Input aria-label="Dashboard date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </div>
        }
      />

      <div className="metric-grid">
        <article className="metric-card metric-pink">
          <div><span>Day score</span><strong>{dayScore}%</strong><small>Tasks + habits</small></div>
          <ProgressRing value={dayScore} label="score" size={76} />
        </article>
        <article className="metric-card metric-violet">
          <ListChecks />
          <div><span>Daily missions</span><strong>{data.metrics.tasks_completed}/{data.metrics.tasks_total}</strong><small>{taskRate}% cleared</small></div>
        </article>
        <article className="metric-card metric-green">
          <Footprints />
          <div><span>Planned movement</span><strong>{data.metrics.movement_minutes}<em> min</em></strong><small>Across the timetable</small></div>
        </article>
        <article className="metric-card metric-cyan">
          <Sparkles />
          <div><span>Habits</span><strong>{data.metrics.habits_completed}/{data.metrics.habits_total}</strong><small>{habitRate}% checked in</small></div>
        </article>
      </div>

      <div className="dashboard-grid">
        <Panel
          className="dashboard-missions"
          title="Priority missions"
          action={<button className="text-action" onClick={() => onNavigate("todos")}>Open to-do <ArrowRight /></button>}
        >
          {incompleteTasks.length ? (
            <div className="mission-list">
              {incompleteTasks.map((task) => (
                <article className="mission-row" key={task.id}>
                  <Checkbox
                    aria-label={`Complete ${task.title}`}
                    checked={task.status === "done"}
                    onCheckedChange={(checked) => void toggleTask(task.id, checked === true)}
                  />
                  <div className="mission-copy">
                    <strong>{task.title}</strong>
                    <span>{task.category} · {task.estimate_minutes} min</span>
                  </div>
                  <PriorityPill priority={task.priority} />
                </article>
              ))}
            </div>
          ) : (
            <div className="compact-empty"><CheckCircle2 /><div><strong>All clear</strong><span>No unfinished missions for this date.</span></div></div>
          )}
          <Button className="neon-button full-width" onClick={() => onNavigate("todos")}><CircleDashed /> Add or plan a mission</Button>
        </Panel>

        <Panel className="dashboard-timeline" title="Today’s route" action={<button className="text-action" onClick={() => onNavigate("timetable")}>Full timetable <ArrowRight /></button>}>
          <div className="mini-timeline">
            {visibleRoutine.slice(0, 9).map((block) => (
              <article className={`mini-timeline-row ${block.id === currentBlockId ? "is-current" : ""}`} key={block.id}>
                <time>{formatTime(block.start_time)}</time>
                <span className="timeline-dot" style={{ backgroundColor: block.color }} />
                <div>
                  <strong>{block.title}</strong>
                  <span>{block.category}{block.is_movement ? " · movement" : ""}</span>
                </div>
                {block.id === currentBlockId ? <small>NOW</small> : null}
              </article>
            ))}
          </div>
          {visibleRoutine.length > 9 ? <p className="more-count">+ {visibleRoutine.length - 9} later blocks in Time table</p> : null}
        </Panel>

        <Panel className="dashboard-habits" title="Habit checkpoint" action={<button className="text-action" onClick={() => onNavigate("habits")}>Week view <ArrowRight /></button>}>
          <div className="habit-quick-list">
            {data.habits.map((habit) => {
              const checked = completedHabitIds.has(habit.id);
              return (
                <button key={habit.id} className={`habit-quick ${checked ? "is-complete" : ""}`} onClick={() => void toggleHabit(habit.id, !checked)}>
                  <span className="habit-check" style={{ borderColor: habit.color, backgroundColor: checked ? habit.color : undefined }}>{checked ? <CheckCircle2 /> : <Activity />}</span>
                  <div><strong>{habit.name}</strong><small>{checked ? "Completed" : "Tap to check in"}</small></div>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel className="dashboard-focus" title="Focus station">
          <FocusTimer />
        </Panel>

        <Panel className="dashboard-goals" title="Active goals" action={<button className="text-action" onClick={() => onNavigate("goals")}>Manage goals <ArrowRight /></button>}>
          <div className="goal-quick-list">
            {data.goals.slice(0, 3).map((goal) => {
              const progress = Math.min(100, Math.round((goal.current_value / goal.target_value) * 100));
              return (
                <article key={goal.id}>
                  <div className="goal-quick-heading"><span className="goal-icon" style={{ color: goal.color }}><Target /></span><div><strong>{goal.title}</strong><small>{goal.current_value}/{goal.target_value} {goal.unit}</small></div><b>{progress}%</b></div>
                  <div className="thin-progress"><span style={{ width: `${progress}%`, backgroundColor: goal.color }} /></div>
                </article>
              );
            })}
          </div>
        </Panel>

        <Panel className="dashboard-events" title="One-off schedule" action={<button className="text-action" onClick={() => onNavigate("schedule")}>Open schedule <ArrowRight /></button>}>
          {data.events.length ? (
            <div className="event-quick-list">
              {data.events.slice(0, 4).map((event) => (
                <article key={event.id}>
                  <span style={{ backgroundColor: event.color }} />
                  <time>{formatTime(event.start_time)}</time>
                  <div><strong>{event.title}</strong><small>{event.location || event.category}</small></div>
                </article>
              ))}
            </div>
          ) : (
            <div className="compact-empty"><CalendarDays /><div><strong>No extra events</strong><span>Your recurring timetable is still active.</span></div></div>
          )}
        </Panel>
      </div>
    </div>
  );
}

