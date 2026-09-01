// M0-T smoke test: proves the extracted `app.js` mounts the real /report
const request = require("supertest");
const app = require("../app");

describe("GET /report (unauthenticated)", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app).get("/report");

    // Response body asserted from the real verifyToken implementation
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "Authorization token missing",
    });
  });
});
