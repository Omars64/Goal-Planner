"use client";

import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Columns3,
  Edit3,
  Filter,
  GripVertical,
  Plus,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { api } from "../api";
import { formatDate, todayISO } from "../date";
import {
  ConfirmDelete,
  EntityDialog,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Panel,
  PriorityPill,
  useDebouncedValue,
  useResource,
} from "../shared";
import type { Priority, Recurrence, Task, TaskInput, TaskPhase } from "../types";

const fallbackPhases: TaskPhase[] = [
  { id: "todo", name: "To do", position: 0, is_done: false, is_system: true },
  { id: "in_progress", name: "In progress", position: 1, is_done: false, is_system: true },
  { id: "done", name: "Completed", position: 2, is_done: true, is_system: true },
];
const emptyTasks: Task[] = [];

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

function taskPhaseId(task: Task, phases: TaskPhase[]) {
  if (phases.some((phase) => phase.id === task.status)) return task.status;
  return task.status === "archived" ? "done" : "todo";
}

export function TodosPage() {
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskInput>(emptyTask);
  const [tagText, setTagText] = useState("");
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<TaskPhase | null>(null);
  const [phaseName, setPhaseName] = useState("");
  const [phaseSaving, setPhaseSaving] = useState(false);
  const [deletingPhase, setDeletingPhase] = useState<TaskPhase | null>(null);
  const resource = useResource(
    async () => {
      const [tasks, phases] = await Promise.all([
        api.tasks({
          ...(priorityFilter !== "all" ? { priority: priorityFilter } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
        }),
        api.taskPhases(),
      ]);
      return { tasks, phases };
    },
    [priorityFilter, debouncedSearch],
  );

  const phases = resource.data?.phases ?? fallbackPhases;
  const tasks = resource.data?.tasks ?? emptyTasks;
  const counts = useMemo(() => {
    const donePhase = phases.find((phase) => phase.is_done)?.id ?? "done";
    return {
      total: tasks.length,
      done: tasks.filter((task) => taskPhaseId(task, phases) === donePhase).length,
      urgent: tasks.filter((task) => task.priority === "urgent" && taskPhaseId(task, phases) !== donePhase).length,
      minutes: tasks.filter((task) => taskPhaseId(task, phases) !== donePhase).reduce((sum, task) => sum + task.estimate_minutes, 0),
    };
  }, [phases, tasks]);

  const openCreate = (phaseId = "todo") => {
    setEditing(null);
    setForm({ ...emptyTask, status: phaseId, tags: [] });
    setTagText("");
    setDialogOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setForm({
      title: task.title,
      notes: task.notes,
      status: taskPhaseId(task, phases),
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
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save task");
    } finally {
      setSaving(false);
    }
  };

  const moveTask = async (task: Task, phaseId: string) => {
    if (taskPhaseId(task, phases) === phaseId || moving === task.id) return;
    setMoving(task.id);
    const phase = phases.find((item) => item.id === phaseId);
    try {
      await api.updateTask(task.id, { status: phaseId });
      toast.success("Task moved", { description: `${task.title} is now in ${phase?.name ?? "the selected phase"}.` });
      await resource.reload();
    } catch (caught) {
      toast.error("Could not move task", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setMoving(null);
      setDragging(null);
    }
  };

  const dropTask = (event: DragEvent<HTMLElement>, phaseId: string) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || dragging;
    const task = tasks.find((item) => item.id === taskId);
    if (task) void moveTask(task, phaseId);
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteTask(deleting.id);
      toast.success("Task deleted");
      setDeleting(null);
      await resource.reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete task");
    }
  };

  const openAddPhase = () => {
    setEditingPhase(null);
    setPhaseName("");
    setPhaseDialogOpen(true);
  };

  const openEditPhase = (phase: TaskPhase) => {
    setEditingPhase(phase);
    setPhaseName(phase.name);
    setPhaseDialogOpen(true);
  };

  const savePhase = async (event: FormEvent) => {
    event.preventDefault();
    setPhaseSaving(true);
    try {
      if (editingPhase) await api.updateTaskPhase(editingPhase.id, phaseName);
      else await api.createTaskPhase(phaseName);
      toast.success(editingPhase ? "Phase renamed" : "Phase added", {
        description: editingPhase ? `The phase is now called ${phaseName}.` : `${phaseName} was added before Completed.`,
      });
      setPhaseDialogOpen(false);
      await resource.reload();
    } catch (caught) {
      toast.error(editingPhase ? "Could not rename phase" : "Could not add phase", {
        description: caught instanceof Error ? caught.message : "Please try again.",
      });
    } finally {
      setPhaseSaving(false);
    }
  };

  const removePhase = async () => {
    if (!deletingPhase) return;
    try {
      const result = await api.deleteTaskPhase(deletingPhase.id);
      toast.success("Phase removed", { description: result.message });
      setDeletingPhase(null);
      await resource.reload();
    } catch (caught) {
      toast.error("Could not remove phase", { description: caught instanceof Error ? caught.message : "Please try again." });
    }
  };

  return (
    <div className="page-shell todos-page">
      <PageHeader
        eyebrow="Capture, move, complete"
        title="To-do tasks"
        description="Move work through a clear Kanban flow, add phases that fit your process, and keep every next action visible."
        actions={<Button className="neon-button" onClick={() => openCreate()}><Plus />Add task</Button>}
      />

      <div className="todo-stat-grid">
        <article><ClipboardList /><div><span>Visible tasks</span><strong>{counts.total}</strong></div></article>
        <article><CheckCircle2 /><div><span>Completed</span><strong>{counts.done}</strong></div></article>
        <article><Filter /><div><span>Urgent remaining</span><strong>{counts.urgent}</strong></div></article>
        <article><Clock3 /><div><span>Open workload</span><strong>{Math.floor(counts.minutes / 60)}h {counts.minutes % 60}m</strong></div></article>
      </div>

      <Panel className="todo-controls">
        <div className="search-box"><Search /><Input aria-label="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, notes, or tags..." /></div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}><SelectTrigger className="priority-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All priorities</SelectItem>{["urgent", "high", "medium", "low"].map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select>
        <Button variant="outline" onClick={openAddPhase}><Columns3 />Add phase</Button>
      </Panel>

      {resource.loading && !resource.data ? <LoadingState label="Loading Kanban board..." /> : null}
      {resource.error && !resource.data ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : null}
      {resource.data ? (
        <div className={`kanban-scroll ${dragging ? "is-dragging" : ""}`} aria-label="Task Kanban board">
          <div className="kanban-board">
            {phases.map((phase, phaseIndex) => {
              const phaseTasks = tasks.filter((task) => taskPhaseId(task, phases) === phase.id);
              return (
                <section className={`kanban-column ${phase.is_done ? "is-complete" : ""}`} key={phase.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropTask(event, phase.id)}>
                  <header className="kanban-column-header">
                    <div><span className="kanban-phase-dot" /><h2>{phase.name}</h2><b>{phaseTasks.length}</b></div>
                    {!phase.is_system ? <div className="kanban-phase-actions"><button aria-label={`Rename ${phase.name}`} title="Rename phase" onClick={() => openEditPhase(phase)}><Edit3 /></button><button aria-label={`Delete ${phase.name}`} title="Delete phase" onClick={() => setDeletingPhase(phase)}><Trash2 /></button></div> : null}
                  </header>

                  <div className="kanban-task-list">
                    {phaseTasks.map((task) => {
                      const overdue = task.due_date && task.due_date < todayISO() && !phase.is_done;
                      return (
                        <article className={`kanban-task ${phase.is_done ? "is-done" : ""} ${moving === task.id ? "is-moving" : ""}`} draggable key={task.id} onDragStart={(event) => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; setDragging(task.id); }} onDragEnd={() => setDragging(null)}>
                          <div className="kanban-task-top"><GripVertical aria-hidden="true" /><Checkbox aria-label={`Complete ${task.title}`} checked={phase.is_done} onCheckedChange={(checked) => void moveTask(task, checked === true ? "done" : "todo")} /><h3>{task.title}</h3><PriorityPill priority={task.priority} /></div>
                          {task.notes ? <p>{task.notes}</p> : null}
                          <div className="todo-meta">
                            {task.scheduled_date ? <span><Calendar />Scheduled {formatDate(task.scheduled_date, { year: undefined })}</span> : null}
                            {task.due_date ? <span className={overdue ? "overdue" : ""}><Clock3 />{overdue ? "Overdue" : "Due"} {formatDate(task.due_date, { year: undefined })}</span> : null}
                            <span>{task.estimate_minutes} min</span><span>{task.category}</span>
                          </div>
                          {task.tags.length ? <div className="tag-list">{task.tags.map((tag) => <span key={tag}><Tag />{tag}</span>)}</div> : null}
                          <footer className="kanban-task-actions">
                            <div><Button variant="outline" size="icon-sm" disabled={phaseIndex === 0 || moving === task.id} aria-label={`Move ${task.title} left`} title="Move to previous phase" onClick={() => void moveTask(task, phases[phaseIndex - 1].id)}><ArrowLeft /></Button><Button variant="outline" size="icon-sm" disabled={phaseIndex === phases.length - 1 || moving === task.id} aria-label={`Move ${task.title} right`} title="Move to next phase" onClick={() => void moveTask(task, phases[phaseIndex + 1].id)}><ArrowRight /></Button></div>
                            <div><Button variant="outline" size="icon-sm" aria-label={`Edit ${task.title}`} onClick={() => openEdit(task)}><Edit3 /></Button><Button variant="outline" size="icon-sm" aria-label={`Delete ${task.title}`} onClick={() => setDeleting(task)}><Trash2 /></Button></div>
                          </footer>
                        </article>
                      );
                    })}
                    {!phaseTasks.length ? <div className="kanban-empty"><span>Drop tasks here</span></div> : null}
                  </div>
                  <button className="kanban-add-task" onClick={() => openCreate(phase.id)}><Plus />Add task</button>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}

      <EntityDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editing ? "Edit task" : "Add a task"} description="Keep it specific enough that you can tell exactly when it is finished.">
        <form className="entity-form" onSubmit={save}>
          <Field label="Task title"><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Review pull request" /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Definition of done, links, or context..." /></Field>
          <div className="form-grid three-columns"><Field label="Phase"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent>{phases.map((phase) => <SelectItem value={phase.id} key={phase.id}>{phase.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Priority"><Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value as Priority })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent>{["urgent", "high", "medium", "low"].map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select></Field><Field label="Category"><Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="work" /></Field></div>
          <div className="form-grid three-columns"><Field label="Scheduled"><Input type="date" value={form.scheduled_date || ""} onChange={(event) => setForm({ ...form, scheduled_date: event.target.value || null })} /></Field><Field label="Due"><Input type="date" value={form.due_date || ""} onChange={(event) => setForm({ ...form, due_date: event.target.value || null })} /></Field><Field label="Estimate"><Input type="number" min="0" max="1440" value={form.estimate_minutes} onChange={(event) => setForm({ ...form, estimate_minutes: Number(event.target.value) })} /></Field></div>
          <div className="form-grid two-columns"><Field label="Repeats"><Select value={form.recurring_rule} onValueChange={(value) => setForm({ ...form, recurring_rule: value as Recurrence })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent>{["none", "daily", "weekdays", "weekly", "monthly"].map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select></Field><Field label="Tags" hint="Separate tags with commas"><Input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="coding, health, urgent" /></Field></div>
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button className="neon-button" disabled={saving}>{saving ? "Saving..." : editing ? "Save task" : "Add task"}</Button></div>
        </form>
      </EntityDialog>

      <EntityDialog open={phaseDialogOpen} onOpenChange={setPhaseDialogOpen} title={editingPhase ? "Rename phase" : "Add a Kanban phase"} description={editingPhase ? "Choose a clear name for this step in your workflow." : "The new phase will appear immediately before Completed."}>
        <form className="entity-form" onSubmit={savePhase}><Field label="Phase name"><Input required minLength={1} maxLength={40} autoFocus value={phaseName} onChange={(event) => setPhaseName(event.target.value)} placeholder="For review" /></Field><div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setPhaseDialogOpen(false)}>Cancel</Button><Button className="neon-button" disabled={phaseSaving}><Columns3 />{phaseSaving ? "Saving..." : editingPhase ? "Rename phase" : "Add phase"}</Button></div></form>
      </EntityDialog>

      <ConfirmDelete open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} itemName={deleting?.title || "task"} onConfirm={remove} />
      <ConfirmDelete open={Boolean(deletingPhase)} onOpenChange={(open) => !open && setDeletingPhase(null)} itemName={`${deletingPhase?.name ?? "custom"} phase`} description="The phase will be removed and every task in it will return to To do. The tasks themselves will not be deleted." confirmLabel="Remove phase" onConfirm={removePhase} />
    </div>
  );
}
