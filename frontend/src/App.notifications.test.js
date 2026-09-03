import fs from "fs";
import path from "path";

describe("notification capability copy", () => {
  it("does not promise unsupported real-time budget alerts", () => {
    const source = fs.readFileSync(path.join(__dirname, "App.js"), "utf8");

    expect(source).toContain("Get reminders when recurring expenses are created.");
    expect(source).not.toMatch(/real-time budget alerts/i);
  });
});
