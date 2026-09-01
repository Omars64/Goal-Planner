import type {
  AdminUsersResponse,
  AuthUser,
  DashboardData,
  EventInput,
  Goal,
  GoalInput,
  Habit,
  HabitInput,
  InsightsData,
  PlannerEvent,
  PlannerSettings,
  Reminder,
  ReminderInput,
  RoutineBlock,
  RoutineInput,
  Task,
  TaskInput,
} from "./types";

const inferredApiUrl = (() => {
  if (typeof window === "undefined") return "/api";
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return `http://${window.location.hostname}:8000/api`;
  }
  if (window.location.hostname === "omars64-goal-planner.omarsolanki35.chatgpt.site") {
    return "http://localhost:8000/api";
  }
  return "/api";
})();
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || inferredApiUrl).replace(/\/$/, "");

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || body);
    } catch {
      // Keep the status-based fallback when the response is not JSON.
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  baseUrl: API_BASE,
  health: () => request<{ status: string }>("/health"),
  me: () => request<AuthUser>("/auth/me"),
  login: (email: string, password: string) =>
    request<{ status: string; message: string; user: AuthUser }>("/auth/login", json("POST", { email, password })),
  signup: (username: string, email: string, password: string) =>
    request<{ status: string; email: string; expires_in: number; message: string }>(
      "/auth/signup",
      json("POST", { username, email, password }),
    ),
  verifyEmail: (email: string, code: string) =>
    request<{ status: string; message: string; user: AuthUser }>("/auth/verify", json("POST", { email, code })),
  resendCode: (email: string) =>
    request<{ status: string; message: string }>("/auth/resend-code", json("POST", { email })),
  logout: () => request<{ status: string; message: string }>("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string; message: string }>(
      "/auth/change-password",
      json("POST", { current_password: currentPassword, new_password: newPassword }),
    ),
  adminUsers: () => request<AdminUsersResponse>("/admin/users"),
  adminCreateUser: (body: { username: string; email: string; password: string; role: "admin" | "user" }) =>
    request<{ message: string; user: AuthUser }>("/admin/users", json("POST", body)),
  adminUpdateUser: (id: string, body: Partial<Pick<AuthUser, "username" | "email" | "role" | "is_active">>) =>
    request<{ message: string; user: AuthUser }>(`/admin/users/${id}`, json("PATCH", body)),
  adminResetPassword: (id: string, newPassword: string) =>
    request<{ message: string; user: AuthUser }>(
      `/admin/users/${id}/password`,
      json("PUT", { new_password: newPassword }),
    ),
  adminDeleteUser: (id: string) =>
    request<{ message: string; deleted_user_id: string }>(`/admin/users/${id}`, { method: "DELETE" }),
  dashboard: (date: string) => request<DashboardData>(`/dashboard?date=${encodeURIComponent(date)}`),
  insights: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return request<InsightsData>(`/insights${params.size ? `?${params}` : ""}`);
  },
  settings: () => request<PlannerSettings>("/settings"),
  updateSettings: (body: Partial<PlannerSettings>) => request<PlannerSettings>("/settings", json("PATCH", body)),

  tasks: (params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params);
    return request<Task[]>(`/tasks${query.size ? `?${query}` : ""}`);
  },
  createTask: (body: Partial<TaskInput>) => request<Task>("/tasks", json("POST", body)),
  updateTask: (id: string, body: Partial<TaskInput>) => request<Task>(`/tasks/${id}`, json("PATCH", body)),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  routineBlocks: (day?: string) => request<RoutineBlock[]>(`/routine-blocks${day ? `?day=${day}` : ""}`),
  createRoutineBlock: (body: RoutineInput) => request<RoutineBlock>("/routine-blocks", json("POST", body)),
  updateRoutineBlock: (id: string, body: Partial<RoutineInput>) => request<RoutineBlock>(`/routine-blocks/${id}`, json("PATCH", body)),
  deleteRoutineBlock: (id: string) => request<void>(`/routine-blocks/${id}`, { method: "DELETE" }),

  events: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return request<PlannerEvent[]>(`/events${params.size ? `?${params}` : ""}`);
  },
  createEvent: (body: EventInput) => request<PlannerEvent>("/events", json("POST", body)),
  updateEvent: (id: string, body: Partial<EventInput>) => request<PlannerEvent>(`/events/${id}`, json("PATCH", body)),
  deleteEvent: (id: string) => request<void>(`/events/${id}`, { method: "DELETE" }),

  goals: () => request<Goal[]>("/goals"),
  createGoal: (body: GoalInput) => request<Goal>("/goals", json("POST", body)),
  updateGoal: (id: string, body: Partial<GoalInput>) => request<Goal>(`/goals/${id}`, json("PATCH", body)),
  deleteGoal: (id: string) => request<void>(`/goals/${id}`, { method: "DELETE" }),

  habits: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return request<Habit[]>(`/habits${params.size ? `?${params}` : ""}`);
  },
  createHabit: (body: HabitInput) => request<Habit>("/habits", json("POST", body)),
  updateHabit: (id: string, body: Partial<HabitInput>) => request<Habit>(`/habits/${id}`, json("PATCH", body)),
  deleteHabit: (id: string) => request<void>(`/habits/${id}`, { method: "DELETE" }),
  checkInHabit: (id: string, entryDate: string, completed: boolean) =>
    request(`/habits/${id}/check-ins`, json("PUT", { entry_date: entryDate, completed, value: completed ? 1 : 0 })),

  reminders: () => request<Reminder[]>("/reminders"),
  createReminder: (body: ReminderInput) => request<Reminder>("/reminders", json("POST", body)),
  updateReminder: (id: string, body: Partial<ReminderInput>) => request<Reminder>(`/reminders/${id}`, json("PATCH", body)),
  deleteReminder: (id: string) => request<void>(`/reminders/${id}`, { method: "DELETE" }),

  exportData: () => request<Record<string, unknown>>("/export"),
  importData: (data: Record<string, unknown>, mode: "merge" | "replace") =>
    request<{ status: string; records_imported: number }>("/import", json("POST", { data, mode })),
  reset: () => request<{ status: string; message: string }>("/system/reset", { method: "POST" }),
};
