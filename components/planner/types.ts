export type PageKey =
  | "dashboard"
  | "timetable"
  | "schedule"
  | "todos"
  | "goals"
  | "habits"
  | "reminders"
  | "insights"
  | "admin"
  | "feedback"
  | "settings";

export type UserRole = "admin" | "user";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
  last_login_at: string | null;
  profile_image: string | null;
}

export interface AdminUsersResponse {
  users: AuthUser[];
  total: number;
  admins: number;
  regular_users: number;
  active_users: number;
  inactive_users: number;
}

export interface AuthenticatedUser extends AuthUser {
  session_expires_at: string;
}

export type Priority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = string;
export type GoalStatus = "active" | "completed" | "paused" | "archived";
export type Recurrence = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  category: string;
  due_date: string | null;
  scheduled_date: string | null;
  estimate_minutes: number;
  tags: string[];
  recurring_rule: Recurrence;
  created_at: string;
  completed_at: string | null;
}

export interface TaskPhase {
  id: string;
  name: string;
  position: number;
  is_done: boolean;
  is_system: boolean;
}

export interface RoutineBlock {
  id: string;
  title: string;
  days: string[];
  start_time: string;
  end_time: string;
  category: string;
  color: string;
  notes: string;
  is_movement: boolean;
  is_active: boolean;
  created_at: string;
}

export interface PlannerEvent {
  id: string;
  title: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  category: string;
  color: string;
  location: string;
  recurring_rule: Recurrence;
  completed: boolean;
  created_at: string;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  target_value: number;
  current_value: number;
  unit: string;
  deadline: string | null;
  status: GoalStatus;
  color: string;
  created_at: string;
}

export interface HabitEntry {
  id: string;
  habit_id: string;
  entry_date: string;
  completed: boolean;
  value: number;
  note: string;
  created_at: string;
}

export interface Habit {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  target_days: string[];
  created_at: string;
  entries: HabitEntry[];
  completed_count: number;
  streak: number;
}

export interface Reminder {
  id: string;
  title: string;
  body: string;
  remind_at: string;
  recurrence: Recurrence;
  enabled: boolean;
  channel: "browser" | "in_app";
  related_type: string | null;
  related_id: string | null;
  created_at: string;
}

export interface PlannerSettings {
  display_name: string;
  timezone: string;
  week_start: "sunday" | "monday";
  daily_step_goal: number;
  work_start: string;
  work_end: string;
  work_days: string[];
  compact_mode: boolean;
  notifications_enabled: boolean;
  profile_image: string | null;
  background_image: string | null;
}

export interface PlannerFeedback {
  id: string;
  user_id: string;
  name: string;
  email: string;
  message: string;
  image: string | null;
  created_at: string;
  account_username: string;
  account_email: string;
}

export interface DashboardData {
  date: string;
  day_name: string;
  settings: PlannerSettings;
  tasks: Task[];
  events: PlannerEvent[];
  routine: RoutineBlock[];
  habits: Omit<Habit, "entries" | "completed_count" | "streak">[];
  habit_entries: HabitEntry[];
  goals: Goal[];
  reminders: Reminder[];
  metrics: {
    tasks_total: number;
    tasks_completed: number;
    habits_total: number;
    habits_completed: number;
    movement_minutes: number;
    scheduled_blocks: number;
  };
}

export interface InsightsData {
  start: string;
  end: string;
  daily: Array<{
    date: string;
    label: string;
    tasks_completed: number;
    habits_completed: number;
  }>;
  task_completion_rate: number;
  habit_completion_rate: number;
  active_goals: number;
  completed_goals: number;
}

export type TaskInput = Omit<Task, "id" | "created_at" | "completed_at">;
export type RoutineInput = Omit<RoutineBlock, "id" | "created_at">;
export type EventInput = Omit<PlannerEvent, "id" | "created_at">;
export type GoalInput = Omit<Goal, "id" | "created_at">;
export type HabitInput = Omit<Habit, "id" | "created_at" | "entries" | "completed_count" | "streak">;
export type ReminderInput = Omit<Reminder, "id" | "created_at">;
export type FeedbackInput = Pick<PlannerFeedback, "name" | "email" | "message" | "image">;
