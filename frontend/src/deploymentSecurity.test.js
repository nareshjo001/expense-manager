import fs from "node:fs";
import path from "node:path";

const vercelConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8")
);

const headers = Object.fromEntries(
  vercelConfig.headers[0].headers.map(({ key, value }) => [key, value])
);

describe("Vercel browser security headers", () => {
  test("uses report-only CSP with only approved production connections", () => {
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy-Report-Only"]).toContain(
      "https://expense-manager-backend-nnxe.onrender.com"
    );
    expect(headers["Content-Security-Policy-Report-Only"]).not.toContain("*");
  });

  test("sets baseline privacy and browser isolation headers", () => {
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
  });
});
