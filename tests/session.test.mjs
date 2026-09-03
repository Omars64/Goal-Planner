import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  root: fileURLToPath(new URL("..", import.meta.url)),
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());
const { watchSessionExpiry, SESSION_EXPIRED_EVENT } = await vite.ssrLoadModule("/components/planner/session.ts");
const { api } = await vite.ssrLoadModule("/components/planner/api.ts");
const START = Date.parse("2026-09-03T10:00:00Z");
const TIMEOUT = 30 * 60 * 1000;

function browserClock(t) {
  let now = START;
  let sequence = 0;
  const timers = new Map();
  const fakeWindow = Object.assign(new EventTarget(), {
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  const fakeDocument = new EventTarget();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
  t.mock.method(Date, "now", () => now);
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  });
  return {
    window: fakeWindow,
    document: fakeDocument,
    advance: (duration) => { now += duration; },
    delay: () => timers.values().next().value?.delay,
    fire: () => {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
  };
}

test("session expires at 30 minutes even after activity and only fires once", (t) => {
  const clock = browserClock(t);
  let expired = 0;
  const stop = watchSessionExpiry(new Date(START + TIMEOUT).toISOString(), () => { expired++; });
  assert.equal(clock.delay(), TIMEOUT);
  clock.advance(TIMEOUT - 1000);
  clock.window.dispatchEvent(new Event("focus"));
  assert.equal(expired, 0);
  assert.equal(clock.delay(), 1000);
  clock.advance(1000);
  clock.fire();
  clock.window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  clock.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(expired, 1);
  assert.equal(clock.delay(), undefined);
  stop();
});

test("remounting uses remaining server time, and disposed timers cannot expire a new session", (t) => {
  const clock = browserClock(t);
  let expired = 0;
  const deadline = new Date(START + TIMEOUT).toISOString();
  const stop = watchSessionExpiry(deadline, () => { expired++; });
  clock.advance(10 * 60 * 1000);
  stop();
  clock.window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  assert.equal(expired, 0);
  assert.equal(clock.delay(), undefined);
  const stopNext = watchSessionExpiry(deadline, () => { expired++; });
  assert.equal(clock.delay(), 20 * 60 * 1000);
  stopNext();
});

for (const event of ["focus", "pageshow", "visibilitychange"]) {
  test(`sleeping tab expires immediately on ${event}`, (t) => {
    const clock = browserClock(t);
    let expired = 0;
    watchSessionExpiry(new Date(START + TIMEOUT).toISOString(), () => { expired++; });
    clock.advance(TIMEOUT + 1);
    const target = event === "visibilitychange" ? clock.document : clock.window;
    target.dispatchEvent(new Event(event));
    assert.equal(expired, 1);
    assert.equal(clock.delay(), undefined);
  });
}

test("missing or already-expired session deadlines fail closed", (t) => {
  const clock = browserClock(t);
  for (const deadline of [undefined, "invalid", new Date(START).toISOString()]) {
    let expired = false;
    watchSessionExpiry(deadline, () => { expired = true; });
    assert.equal(clock.delay(), 0);
    clock.fire();
    assert.equal(expired, true);
  }
});

test("protected API 401 ends the session, but wrong login and network errors do not", async (t) => {
  browserClock(t);
  let expired = 0;
  watchSessionExpiry(new Date(START + TIMEOUT).toISOString(), () => { expired++; });
  let networkError = false;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "include");
    if (networkError) throw new TypeError("Network unavailable");
    return new Response(JSON.stringify({ detail: "Sign in again" }), { status: 401 });
  });
  await assert.rejects(api.login("test@example.com", "incorrect"), { status: 401 });
  assert.equal(expired, 0);
  networkError = true;
  await assert.rejects(api.tasks(), /Network unavailable/);
  assert.equal(expired, 0);
  networkError = false;
  await assert.rejects(api.tasks(), { status: 401 });
  assert.equal(expired, 1);
});
