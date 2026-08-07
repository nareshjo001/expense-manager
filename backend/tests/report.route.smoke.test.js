// M0-T smoke test: proves the extracted `app.js` mounts the real /report
// route behind the real `verifyToken` middleware, without ever touching
// MongoDB, Redis, or a live HTTP listener.
//
// Deliberately narrow, per the approved M0-T scope:
//   - No Authorization header is sent, so `verifyToken` (Middlewares/Auth.js)
//     rejects the request with 401 before the controller or report service
//     ever runs -- this is why no database/cache connection is required.
//   - The route, middleware, and app wiring are exercised for real (no
//     mocking of the route or of verifyToken).
//   - No data is seeded; none is needed for this assertion.
const request = require("supertest");
const app = require("../app");

describe("GET /report (unauthenticated)", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app).get("/report");

    // Response body asserted from the real verifyToken implementation
    // (Middlewares/Auth.js): a missing/absent Authorization header returns
    // exactly this envelope.
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "Authorization token missing",
    });
  });
});
