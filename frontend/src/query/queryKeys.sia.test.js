import { queryKeys } from "./queryKeys";

// Key stability matters: an unstable key silently breaks cache reuse and
// makes invalidation after a successful ask/delete a no-op.
describe("frontend/src/query/queryKeys -- sia namespace", () => {
  it("exposes a stable sia root", () => {
    expect(queryKeys.sia.all).toEqual(["sia"]);
  });

  it("nests session keys under the sia root", () => {
    expect(queryKeys.sia.sessions.all()).toEqual(["sia", "sessions"]);
    expect(queryKeys.sia.sessions.list()).toEqual(["sia", "sessions", "list"]);
  });

  it("scopes message keys per session id", () => {
    expect(queryKeys.sia.sessions.messages("abc")).toEqual(["sia", "sessions", "messages", "abc"]);
    expect(queryKeys.sia.sessions.messages("xyz")).not.toEqual(queryKeys.sia.sessions.messages("abc"));
  });

  it("returns equal (not identical) arrays across calls, so keys are structurally stable", () => {
    expect(queryKeys.sia.sessions.list()).toEqual(queryKeys.sia.sessions.list());
    expect(queryKeys.sia.sessions.messages("abc")).toEqual(queryKeys.sia.sessions.messages("abc"));
  });

  it("the list key is a prefix of nothing that would accidentally invalidate messages", () => {
    // Invalidating the list must not blow away per-session message caches.
    const list = queryKeys.sia.sessions.list();
    const messages = queryKeys.sia.sessions.messages("abc");
    expect(messages.slice(0, list.length)).not.toEqual(list);
  });

  it("does not disturb the pre-existing namespaces", () => {
    expect(queryKeys.reports.all).toEqual(["reports"]);
    expect(queryKeys.expenses.all).toEqual(["expenses"]);
    expect(queryKeys.charts.all).toEqual(["charts"]);
  });
});
