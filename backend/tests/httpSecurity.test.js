const request = require("supertest");

const originalNodeEnv = process.env.NODE_ENV;
const originalAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS;

const restoreEnvironment = () => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalAllowedOrigins === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = originalAllowedOrigins;
  }
};

const loadApp = ({ nodeEnv = "test", allowedOrigins } = {}) => {
  process.env.NODE_ENV = nodeEnv;

  if (allowedOrigins === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = allowedOrigins;
  }

  jest.resetModules();
  jest.doMock("../config/firebaseAdmin", () => ({
    isFirebaseAvailable: jest.fn(() => false),
  }));

  return require("../app");
};

afterEach(() => {
  restoreEnvironment();
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("HTTP security configuration", () => {
  test("normalizes and deduplicates configured origins", () => {
    const { parseAllowedOrigins } = require("../config/httpSecurity");

    expect(parseAllowedOrigins("https://app.example.com, https://app.example.com/")).toEqual([
      "https://app.example.com",
    ]);
  });

  test.each([
    "*",
    "file:///tmp/index.html",
    "https://user:password@app.example.com",
    "https://app.example.com/path",
    "https://app.example.com?debug=true",
  ])("rejects unsafe origin configuration: %s", (origin) => {
    const { parseAllowedOrigins } = require("../config/httpSecurity");

    expect(() => parseAllowedOrigins(origin)).toThrow();
  });

  test("requires an explicit allowlist in production", () => {
    const { resolveAllowedOrigins } = require("../config/httpSecurity");

    expect(() => resolveAllowedOrigins({ NODE_ENV: "production" })).toThrow(
      "CORS_ALLOWED_ORIGINS is required in production"
    );
  });

  test("uses localhost origins outside production when none are configured", () => {
    const { DEVELOPMENT_ORIGINS, resolveAllowedOrigins } = require("../config/httpSecurity");

    expect(resolveAllowedOrigins({ NODE_ENV: "test" })).toEqual([...DEVELOPMENT_ORIGINS]);
  });
});

describe("HTTP security middleware", () => {
  test("allows an exact configured browser origin", async () => {
    const app = loadApp({ allowedOrigins: "https://app.example.com" });

    const response = await request(app).get("/").set("Origin", "https://app.example.com");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers.vary).toContain("Origin");
  });

  test("rejects an unconfigured browser origin", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const app = loadApp({ allowedOrigins: "https://app.example.com" });

    const response = await request(app).get("/").set("Origin", "https://evil.example.com");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      message: "Origin is not allowed by the CORS policy",
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("allows non-browser requests without an Origin header", async () => {
    const app = loadApp({ allowedOrigins: "https://app.example.com" });

    const response = await request(app).get("/");

    expect(response.status).toBe(200);
  });

  test("answers allowed preflight requests with the configured policy", async () => {
    const app = loadApp({ allowedOrigins: "https://app.example.com" });

    const response = await request(app)
      .options("/expense/add-expense")
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        "authorization,content-type,idempotency-key,x-request-id"
      );

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("Idempotency-Key");
    expect(response.headers["access-control-max-age"]).toBe("86400");
  });

  test("adds browser security headers and hides the Express signature", async () => {
    const app = loadApp({ allowedOrigins: "https://app.example.com" });

    const response = await request(app).get("/");

    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });

  test("enables strict transport security in production", async () => {
    const app = loadApp({
      nodeEnv: "production",
      allowedOrigins: "https://app.example.com",
    });

    const response = await request(app).get("/");

    expect(response.headers["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains; preload"
    );
  });
});
