"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Calendar, CheckCircle2, ClipboardList, Clock3, Edit3, Filter, Plus, Search, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { api } from "../api";
import { formatDate, todayISO } from "../date";
import { ConfirmDelete, EmptyState, EntityDialog, ErrorState, Field, LoadingState, PageHeader, Panel, PriorityPill, StatusPill, useDebouncedValue, useResource } from "../shared";
import type { Priority, Recurrence, Task, TaskInput, TaskStatus } from "../types";


const emptyTask: TaskInput = {
  title: "",
  notes: "",
  status: "todo",
  priority: "medium",
  category: "personal",
  due_date: todayISO(),
  scheduled_date: todayISO(),
  estimate_minutes: 30,
  tags: [],
  recurring_rule: "none",
};

const filters: Array<{ label: string; value: "all" | TaskStatus }> = [
  { label: "All", value: "all" },
  { label: "To do", value: "todo" },
  { label: "In progress", value: "in_progress" },
  { label: "Completed", value: "done" },
];


export function TodosPage() {
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskInput>(emptyTask);
  const [tagText, setTagText] = useState("");
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const { data, loading, error, reload } = useResource(
    () => api.tasks({
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
      ...(priorityFilter !== "all" ? { priority: priorityFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [statusFilter, priorityFilter, debouncedSearch],
  );

  const counts = useMemo(() => {
    const list = data || [];
    return {
      total: list.length,
      done: list.filter((task) => task.status === "done").length,
      urgent: list.filter((task) => task.priority === "urgent" && task.status !== "done").length,
      minutes: list.filter((task) => task.status !== "done").reduce((sum, task) => sum + task.estimate_minutes, 0),
    };
  }, [data]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyTask, tags: [] });
    setTagText("");
    setDialogOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setForm({
      title: task.title,
      notes: task.notes,
      status: task.status,
      priority: task.priority,
      category: task.category,
      due_date: task.due_date,
      scheduled_date: task.scheduled_date,
      estimate_minutes: task.estimate_minutes,
      tags: task.tags,
      recurring_rule: task.recurring_rule,
    });
    setTagText(task.tags.join(", "));
    setDialogOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const payload = { ...form, tags: tagText.split(",").map((tag) => tag.trim()).filter(Boolean) };
    setSaving(true);
    try {
      if (editing) await api.updateTask(editing.id, payload);
      else await api.createTask(payload);
      toast.success(editing ? "Task updated" : "Task added");
      setDialogOpen(false);
      await reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save task");
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async (task: Task, done: boolean) => {
    try {
      await api.updateTask(task.id, { status: done ? "done" : "todo" });
      toast.success(done ? "Task complete" : "Task reopened");
      await reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not update task");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteTask(deleting.id);
      toast.success("Task deleted");
      setDeleting(null);
      await reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete task");
    }
  };

  return (
    <div className="page-shell todos-page">
      <PageHeader
        eyebrow="Capture, sort, complete"
        title="To-do tasks"
        description="Turn vague intentions into small, scheduled actions with priorities, estimates, tags, and recurrence."
        actions={<Button className="neon-button" onClick={openCreate}><Plus /> Add task</Button>}
      />

      <div className="todo-stat-grid">
        <article><ClipboardList /><div><span>Visible tasks</span><strong>{counts.total}</strong></div></article>
        <article><CheckCircle2 /><div><span>Completed</span><strong>{counts.done}</strong></div></article>
        <article><Filter /><div><span>Urgent remaining</span><strong>{counts.urgent}</strong></div></article>
        <article><Clock3 /><div><span>Open workload</span><strong>{Math.floor(counts.minutes / 60)}h {counts.minutes % 60}m</strong></div></article>
      </div>

      <Panel className="todo-controls">
        <div className="search-box"><Search /><Input aria-label="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, notes, or tags…" /></div>
        <div className="filter-tabs" role="tablist">
          {filters.map((filter) => <button role="tab" aria-selected={statusFilter === filter.value} key={filter.value} className={statusFilter === filter.value ? "active" : ""} onClick={() => setStatusFilter(filter.value)}>{filter.label}</button>)}
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="priority-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All priorities</SelectItem>{["urgent", "high", "medium", "low"].map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
      </Panel>

      {loading && !data ? <LoadingState label="Loading tasks…" /> : null}
      {error && !data ? <ErrorState message={error} onRetry={() => void reload()} /> : null}
      {data ? (
        <Panel className="todo-list-panel">
          {data.length ? (
            <div className="todo-list">
              {data.map((task) => {
                const overdue = task.due_date && task.due_date < todayISO() && task.status !== "done";
                return (
                  <article className={`todo-row ${task.status === "done" ? "is-done" : ""}`} key={task.id}>
                    <Checkbox aria-label={`Complete ${task.title}`} checked={task.status === "done"} onCheckedChange={(checked) => void toggleDone(task, checked === true)} />
                    <div className="todo-main">
                      <div className="todo-title-line"><h3>{task.title}</h3><PriorityPill priority={task.priority} /><StatusPill status={task.status} /></div>
                      {task.notes ? <p>{task.notes}</p> : null}
                      <div className="todo-meta">
                        {task.scheduled_date ? <span><Calendar /> Scheduled {formatDate(task.scheduled_date, { year: undefined })}</span> : null}
                        {task.due_date ? <span className={overdue ? "overdue" : ""}><Clock3 /> {overdue ? "Overdue" : "Due"} {formatDate(task.due_date, { year: undefined })}</span> : null}
                        <span>{task.estimate_minutes} min</span>
                        <span>{task.category}</span>
                        {task.recurring_rule !== "none" ? <span>↻ {task.recurring_rule}</span> : null}
                      </div>
                      {task.tags.length ? <div className="tag-list">{task.tags.map((tag) => <span key={tag}><Tag />{tag}</span>)}</div> : null}
                    </div>
                    <div className="row-actions">
                      <Button variant="outline" size="icon-sm" aria-label={`Edit ${task.title}`} onClick={() => openEdit(task)}><Edit3 /></Button>
                      <Button variant="outline" size="icon-sm" aria-label={`Delete ${task.title}`} onClick={() => setDeleting(task)}><Trash2 /></Button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={<CheckCircle2 />} title="No tasks found" description="Change the filters or capture the next concrete action." action={<Button className="neon-button" onClick={openCreate}><Plus /> Add task</Button>} />
          )}
        </Panel>
      ) : null}

      <EntityDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editing ? "Edit task" : "Add a task"} description="Keep it specific enough that you can tell exactly when it is finished.">
        <form className="entity-form" onSubmit={save}>
          <Field label="Task title"><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Review pull request" /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Definition of done, links, or context…" /></Field>
          <div className="form-grid three-columns">
            <Field label="Status">
              <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as TaskStatus })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent>{["todo", "in_progress", "done", "archived"].map((value) => <SelectItem value={value} key={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value as Priority })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent>{["urgent", "high", "medium", "low"].map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Category"><Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="work" /></Field>
          </div>
          <div className="form-grid three-columns">
            <Field label="Scheduled"><Input type="date" value={form.scheduled_date || ""} onChange={(event) => setForm({ ...form, scheduled_date: event.target.value || null })} /></Field>
            <Field label="Due"><Input type="date" value={form.due_date || ""} onChange={(event) => setForm({ ...form, due_date: event.target.value || null })} /></Field>
            <Field label="Estimate"><Input type="number" min="0" max="1440" value={form.estimate_minutes} onChange={(event) => setForm({ ...form, estimate_minutes: Number(event.target.value) })} /></Field>
          </div>
          <div className="form-grid two-columns">
            <Field label="Repeats">
              <Select value={form.recurring_rule} onValueChange={(value) => setForm({ ...form, recurring_rule: value as Recurrence })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent>{["none", "daily", "weekdays", "weekly", "monthly"].map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Tags" hint="Separate tags with commas"><Input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="coding, health, urgent" /></Field>
          </div>
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button className="neon-button" disabled={saving}>{saving ? "Saving…" : editing ? "Save task" : "Add task"}</Button></div>
        </form>
      </EntityDialog>

      <ConfirmDelete open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} itemName={deleting?.title || "task"} onConfirm={remove} />
    </div>
  );
}
