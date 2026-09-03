import fs from "fs";
import path from "path";

describe("notification capability copy", () => {
  it("does not promise unsupported real-time budget alerts", () => {
    const source = fs.readFileSync(path.join(__dirname, "App.js"), "utf8");

    expect(source).toContain("Get reminders when recurring expenses are created.");
    expect(source).not.toMatch(/real-time budget alerts/i);
  });

  it("defaults users toward private lock-screen previews", () => {
    const source = fs.readFileSync(path.join(__dirname, "App.js"), "utf8");

    expect(source).toContain("Show expense names in notification previews");
    expect(source).toContain("Leave this off to keep lock-screen notifications private.");
  });

  it("does not log web or native notification payloads", () => {
    const serviceWorker = fs.readFileSync(
      path.join(__dirname, "..", "public", "firebase-messaging-sw.js"),
      "utf8"
    );
    const nativeHook = fs.readFileSync(
      path.join(__dirname, "components", "hooks", "useMobilePush.js"),
      "utf8"
    );

    expect(serviceWorker).not.toMatch(/console\.(log|error|warn)\([^\n]*payload/i);
    expect(nativeHook).not.toMatch(/console\.(log|error|warn)\([^\n]*notification/i);
  });
});
