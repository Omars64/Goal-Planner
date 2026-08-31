"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Award, CalendarDays, Edit3, Flag, Minus, Plus, Target, Trash2, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { api } from "../api";
import { formatDate, todayISO } from "../date";
import { ConfirmDelete, EmptyState, EntityDialog, ErrorState, Field, LoadingState, PageHeader, Panel, ProgressRing, StatusPill, useResource } from "../shared";
import type { Goal, GoalInput, GoalStatus } from "../types";


const emptyGoal: GoalInput = {
  title: "",
  description: "",
  target_value: 5,
  current_value: 0,
  unit: "times",
  deadline: todayISO(),
  status: "active",
  color: "#22c55e",
};


export function GoalsPage() {
  const [filter, setFilter] = useState<"all" | GoalStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [form, setForm] = useState<GoalInput>(emptyGoal);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [saving, setSaving] = useState(false);
  const resource = useResource(() => api.goals(), []);

  const visible = useMemo(() => (resource.data || []).filter((goal) => filter === "all" || goal.status === filter), [resource.data, filter]);
  const metrics = useMemo(() => {
    const goals = resource.data || [];
    const active = goals.filter((goal) => goal.status === "active");
    return {
      total: goals.length,
      active: active.length,
      completed: goals.filter((goal) => goal.status === "completed").length,
      average: active.length ? Math.round(active.reduce((sum, goal) => sum + Math.min(100, goal.current_value / goal.target_value * 100), 0) / active.length) : 0,
    };
  }, [resource.data]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyGoal });
    setDialogOpen(true);
  };

  const openEdit = (goal: Goal) => {
    setEditing(goal);
    setForm({
      title: goal.title,
      description: goal.description,
      target_value: goal.target_value,
      current_value: goal.current_value,
      unit: goal.unit,
      deadline: goal.deadline,
      status: goal.status,
      color: goal.color,
    });
    setDialogOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) await api.updateGoal(editing.id, form);
      else await api.createGoal(form);
      toast.success(editing ? "Goal updated" : "Goal launched");
      setDialogOpen(false);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save goal");
    } finally {
      setSaving(false);
    }
  };

  const adjust = async (goal: Goal, amount: number) => {
    const next = Math.max(0, Math.min(goal.target_value, goal.current_value + amount));
    try {
      await api.updateGoal(goal.id, { current_value: next });
      if (next >= goal.target_value) toast.success("Goal completed — excellent consistency!");
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not update goal progress");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteGoal(deleting.id);
      toast.success("Goal deleted");
      setDeleting(null);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete goal");
    }
  };

  return (
    <div className="page-shell goals-page">
      <PageHeader eyebrow="Progress with a finish line" title="Goals" description="Create measurable daily or weekly outcomes, update progress in one tap, and keep deadlines in view." actions={<Button className="neon-button" onClick={openCreate}><Plus /> New goal</Button>} />

      <div className="goal-summary-grid">
        <article><Target /><div><span>Total goals</span><strong>{metrics.total}</strong></div></article>
        <article><Flag /><div><span>Active</span><strong>{metrics.active}</strong></div></article>
        <article><Award /><div><span>Completed</span><strong>{metrics.completed}</strong></div></article>
        <article><TrendingUp /><div><span>Average progress</span><strong>{metrics.average}%</strong></div></article>
      </div>

      <Panel className="goal-filter-bar">
        <div className="filter-tabs" role="tablist">
          {(["all", "active", "completed", "paused", "archived"] as const).map((value) => <button role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{value}</button>)}
        </div>
      </Panel>

      {resource.loading && !resource.data ? <LoadingState label="Loading goals…" /> : null}
      {resource.error && !resource.data ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : null}
      {resource.data ? (
        visible.length ? (
          <div className="goal-card-grid">
            {visible.map((goal) => {
              const progress = Math.min(100, Math.round(goal.current_value / goal.target_value * 100));
              const overdue = goal.deadline && goal.deadline < todayISO() && goal.status === "active";
              return (
                <article className="goal-card" key={goal.id} style={{ "--goal-color": goal.color } as React.CSSProperties}>
                  <div className="goal-card-top"><span className="goal-card-icon"><Target /></span><StatusPill status={goal.status} /><div className="row-actions"><Button variant="outline" size="icon-sm" aria-label={`Edit ${goal.title}`} onClick={() => openEdit(goal)}><Edit3 /></Button><Button variant="outline" size="icon-sm" aria-label={`Delete ${goal.title}`} onClick={() => setDeleting(goal)}><Trash2 /></Button></div></div>
                  <div className="goal-card-main"><div><h2>{goal.title}</h2><p>{goal.description || "No goal notes added."}</p></div><ProgressRing value={progress} label="done" size={86} /></div>
                  <div className="goal-numbers"><strong>{goal.current_value}</strong><span>of {goal.target_value} {goal.unit}</span></div>
                  <div className="thick-progress"><span style={{ width: `${progress}%` }} /></div>
                  <div className="goal-card-footer">
                    <span className={overdue ? "overdue" : ""}><CalendarDays /> {goal.deadline ? `${overdue ? "Overdue · " : "Due · "}${formatDate(goal.deadline, { year: undefined })}` : "No deadline"}</span>
                    <div><Button variant="outline" size="icon-sm" aria-label={`Decrease ${goal.title}`} disabled={goal.current_value <= 0} onClick={() => void adjust(goal, -1)}><Minus /></Button><Button className="goal-plus" size="sm" disabled={goal.status === "completed"} onClick={() => void adjust(goal, 1)}><Plus /> Add 1</Button></div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Panel><EmptyState icon={<Target />} title="No goals in this filter" description="Change the filter or create a measurable target for the next few weeks." action={<Button className="neon-button" onClick={openCreate}><Plus /> New goal</Button>} /></Panel>
        )
      ) : null}

      <EntityDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editing ? "Edit goal" : "Create a goal"} description="Use a clear target value so progress is visible rather than subjective.">
        <form className="entity-form" onSubmit={save}>
          <Field label="Goal title"><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Complete five walking days" /></Field>
          <Field label="Why this matters"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="A short reason or definition of success…" /></Field>
          <div className="form-grid three-columns">
            <Field label="Current"><Input required type="number" min="0" step="0.5" value={form.current_value} onChange={(event) => setForm({ ...form, current_value: Number(event.target.value) })} /></Field>
            <Field label="Target"><Input required type="number" min="0.1" step="0.5" value={form.target_value} onChange={(event) => setForm({ ...form, target_value: Number(event.target.value) })} /></Field>
            <Field label="Unit"><Input required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="days" /></Field>
          </div>
          <div className="form-grid three-columns">
            <Field label="Deadline"><Input type="date" value={form.deadline || ""} onChange={(event) => setForm({ ...form, deadline: event.target.value || null })} /></Field>
            <Field label="Status"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as GoalStatus })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent>{["active", "completed", "paused", "archived"].map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Accent"><Input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></Field>
          </div>
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button className="neon-button" disabled={saving}>{saving ? "Saving…" : editing ? "Save goal" : "Launch goal"}</Button></div>
        </form>
      </EntityDialog>

      <ConfirmDelete open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} itemName={deleting?.title || "goal"} onConfirm={remove} />
    </div>
  );
}
