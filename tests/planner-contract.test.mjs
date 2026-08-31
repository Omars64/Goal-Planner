import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("exposes every requested top-panel planner page", async () => {
  const source = await readFile(new URL("../components/planner/PlannerApp.tsx", import.meta.url), "utf8");
  for (const label of ["Time table", "Schedule", "To-do", "Goals", "Habits", "Reminders", "Insights", "Settings"]) {
    assert.match(source, new RegExp(`label: \\"${label}\\"`));
  }
  assert.match(source, /top-navigation/);
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
