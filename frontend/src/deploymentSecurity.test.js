import fs from "node:fs";
import path from "node:path";

const vercelConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8")
);

const headers = Object.fromEntries(
  vercelConfig.headers[0].headers.map(({ key, value }) => [key, value])
);

describe("Vercel browser security headers", () => {
  test("enforces CSP with only approved production connections", () => {
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain(
      "https://firebaseinstallations.googleapis.com"
    );
    expect(headers["Content-Security-Policy"]).not.toContain("*");
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  test("sets baseline privacy and browser isolation headers", () => {
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
  });
});
