// Runs via Jest's `setupFiles` -- executes once per test file, before the
// test file itself (and therefore before it can `require("../app")`) is
// evaluated. Its only job in M0-T is to guarantee NODE_ENV is "test" before
// any application module is imported.
//
// Scope note (M0-T): this file intentionally does NOT set up or validate
// any MongoDB/Redis connection target. M0-T's only test never causes the
// application to reach a database or cache layer (verifyToken rejects the
// unauthenticated request first), so no such isolation logic belongs here
// yet. That work is explicitly deferred to a future, separately-approved
// module, per the approved M0-T scope.
process.env.NODE_ENV = "test";
