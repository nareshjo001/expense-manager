const DEVELOPMENT_ORIGINS = Object.freeze([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const normalizeOrigin = (value) => {
  const candidate = String(value || "").trim();

  if (!candidate || candidate === "*") {
    throw new Error("CORS_ALLOWED_ORIGINS contains an invalid origin");
  }

  let parsed;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("CORS_ALLOWED_ORIGINS contains an invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("CORS_ALLOWED_ORIGINS must contain only HTTP(S) origins");
  }

  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("CORS_ALLOWED_ORIGINS entries cannot contain paths, queries, or fragments");
  }

  return parsed.origin;
};

const parseAllowedOrigins = (rawValue) => {
  if (!rawValue || !String(rawValue).trim()) {
    return [];
  }

  return [...new Set(String(rawValue).split(",").map(normalizeOrigin))];
};

const resolveAllowedOrigins = (env = process.env) => {
  const configuredOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("CORS_ALLOWED_ORIGINS is required in production");
  }

  return [...DEVELOPMENT_ORIGINS];
};

const createCorsOptions = (env = process.env) => {
  const allowedOrigins = new Set(resolveAllowedOrigins(env));

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      const error = new Error("Origin is not allowed by the CORS policy");
      error.code = "CORS_ORIGIN_DENIED";
      error.statusCode = 403;
      callback(error);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID", "X-CSRF-Token"],
    exposedHeaders: ["Retry-After", "X-Request-ID"],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  };
};

const createHelmetOptions = (env = process.env) => ({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  referrerPolicy: { policy: "no-referrer" },
  strictTransportSecurity: env.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
});

module.exports = {
  DEVELOPMENT_ORIGINS,
  createCorsOptions,
  createHelmetOptions,
  normalizeOrigin,
  parseAllowedOrigins,
  resolveAllowedOrigins,
};
