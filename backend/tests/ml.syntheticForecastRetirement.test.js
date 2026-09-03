const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../app");

describe("ML-002 synthetic spending forecast retirement", () => {
  it("does not expose the removed forecast proxy route", async () => {
    const response = await request(app).post("/ml/predict-spending-forecast").send({ spentSoFar: 100 });

    expect(response.status).toBe(404);
  });

  it("keeps the supported forecast deterministic and free of the removed ML route", () => {
    const router = fs.readFileSync(path.join(__dirname, "../Routes/ml.router.js"), "utf8");
    const analyzer = fs.readFileSync(path.join(__dirname, "../analytics/analyzers/forecastAnalyzer.js"), "utf8");

    expect(router).not.toContain("predict-spending-forecast");
    expect(analyzer).toContain("fitRobustTrend");
  });
});
