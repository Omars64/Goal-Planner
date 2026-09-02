import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("exposes every requested top-panel planner page", async () => {
  const source = await readFile(new URL("../components/planner/PlannerApp.tsx", import.meta.url), "utf8");
  for (const label of ["Time table", "Schedule", "To-do", "Goals", "Habits", "Reminders", "Insights", "Admin", "Feedback", "Settings"]) {
    assert.match(source, new RegExp(`label: \\"${label}\\"`));
  }
  assert.match(source, /top-navigation/);
});

test("provides private user feedback history and an administrator inbox", async () => {
  const app = await readFile(new URL("../components/planner/PlannerApp.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../components/planner/pages/FeedbackPage.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../backend/app/main.py", import.meta.url), "utf8");
  assert.match(app, /label: "Feedback"/);
  assert.match(page, /Previously sent feedback/);
  assert.match(page, /adminFeedback/);
  assert.match(page, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(api, /@app\.get\("\/api\/admin\/feedback"\)/);
  assert.match(api, /WHERE feedback\.user_id = \?/);
});

test("shows the requested product attribution and version in the footer", async () => {
  const source = await readFile(new URL("../components/planner/PlannerApp.tsx", import.meta.url), "utf8");
  assert.match(source, /Goal Planner powered by Omar Solanki/);
  assert.match(source, /Goal Planner version 3\.0/);
});

test("ships verified authentication and role-gated administration", async () => {
  const app = await readFile(new URL("../components/planner/PlannerApp.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../components/planner/AuthScreen.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../components/planner/pages/AdminDashboardPage.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../backend/app/auth.py", import.meta.url), "utf8");
  assert.match(app, /user\?\.role === "admin"/);
  assert.match(auth, /verifyEmail/);
  assert.match(auth, /InputOTP/);
  assert.match(admin, /adminResetPassword/);
  assert.match(admin, /adminDeleteUser/);
  assert.match(admin, /Delete user/);
  assert.match(api, /require_admin/);
  assert.match(api, /@router\.delete\("\/admin\/users\/\{user_id\}"\)/);
  assert.match(api, /httponly=True/);
});

test("keeps inactive accounts manageable and supports personal images", async () => {
  const app = await readFile(new URL("../components/planner/PlannerApp.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../components/planner/AuthScreen.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../components/planner/pages/AdminDashboardPage.tsx", import.meta.url), "utf8");
  const settings = await readFile(new URL("../components/planner/pages/SettingsPage.tsx", import.meta.url), "utf8");
  assert.match(admin, /Reactivate/);
  assert.match(admin, /inactive_users/);
  assert.match(auth, /Account unavailable/);
  assert.match(settings, /profile_image/);
  assert.match(settings, /background_image/);
  assert.match(app, /settings\.background_image/);
});

test("resumes pending verification and keeps toasts readable", async () => {
  const app = await readFile(new URL("../components/planner/PlannerApp.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../components/planner/AuthScreen.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../backend/app/auth.py", import.meta.url), "utf8");
  assert.match(api, /code already sent/);
  assert.match(auth, /setVerificationEmail\(email\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(app, /position="top-center"/);
  assert.match(app, /duration=\{7000\}/);
});

test("uses practical task language throughout the planner", async () => {
  const files = [
    "../components/planner/pages/TodosPage.tsx",
    "../components/planner/pages/DashboardPage.tsx",
    "../components/planner/shared.tsx",
  ];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  assert.doesNotMatch(source, /\bmissions?\b/i);
  assert.match(source, /Add task/);
  assert.match(source, /Priority tasks/);
});

test("uses a customizable Kanban workflow for to-do tasks", async () => {
  const page = await readFile(new URL("../components/planner/pages/TodosPage.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../components/planner/api.ts", import.meta.url), "utf8");
  const backend = await readFile(new URL("../backend/app/main.py", import.meta.url), "utf8");
  assert.match(page, /Task Kanban board/);
  assert.match(page, /draggable/);
  assert.match(page, /<Columns3 \/>Add<\/Button>/);
  assert.match(page, /Rename phase/);
  assert.match(page, /Move to next phase/);
  assert.doesNotMatch(page, /toast\.success\("Task moved"/);
  assert.match(api, /createTaskPhase/);
  assert.match(api, /deleteTaskPhase/);
  assert.match(backend, /@app\.post\("\/api\/task-phases"/);
  assert.match(backend, /Its tasks were moved to To do/);
});

test("ships backend, containers, CI workflows, and supplied icon", async () => {
  const files = [
    "../backend/app/main.py",
    "../backend/tests/test_api.py",
    "../Dockerfile",
    "../backend/Dockerfile",
    "../docker-compose.yml",
    "../.github/workflows/ci.yml",
    "../.github/workflows/publish-images.yml",
    "../public/goal-planner-icon.png",
  ];
  await Promise.all(files.map((path) => access(new URL(path, import.meta.url))));
});

test("uses consistent Goal Planner branding in the shared shell", async () => {
  const source = await readFile(new URL("../components/planner/PlannerApp.tsx", import.meta.url), "utf8");
  assert.match(source, /goal-planner-icon\.png/);
  assert.match(source, /<strong>GOAL<\/strong><span>PLANNER<\/span>/);
  assert.doesNotMatch(source, /<b>06<\/b>/);
});

test("uses the configured FastAPI endpoint and durable API resources", async () => {
  const source = await readFile(new URL("../components/planner/api.ts", import.meta.url), "utf8");
  assert.match(source, /NEXT_PUBLIC_API_URL/);
  for (const resource of ["tasks", "routine-blocks", "events", "goals", "habits", "reminders", "export", "import"]) {
    assert.match(source, new RegExp(resource));
  }
});
