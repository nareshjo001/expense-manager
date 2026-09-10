// config/dns.js -- the opt-in resolver override.
//
// The bug this replaces was an unconditional dns.setServers(["8.8.8.8",
// "1.1.1.1"]) at the top of server.js. The single most important test here
// is therefore the NEGATIVE one: with DNS_SERVERS unset, setServers must not
// be called at all. That is the production configuration, and a regression
// to the old behaviour would look identical in every other test.
"use strict";

const { applyDnsOverride } = require("../config/dns");

// A silent logger: these paths log deliberately, and a test suite that
// prints their JSON is a test suite people stop reading.
const quiet = () => ({ log: jest.fn(), error: jest.fn() });

describe("with DNS_SERVERS unset -- the production case", () => {
  test("does not touch the resolver at all", () => {
    const dnsModule = { setServers: jest.fn() };
    const result = applyDnsOverride({ env: {}, dnsModule, logger: quiet() });

    expect(dnsModule.setServers).not.toHaveBeenCalled();
    expect(result).toEqual({ applied: false, servers: [], reason: "not_configured" });
  });

  test("an empty string is not an override", () => {
    // Render and most platforms will happily set a variable to "". Treating
    // that as a request to call setServers([]) would throw on every boot.
    const dnsModule = { setServers: jest.fn() };
    const result = applyDnsOverride({ env: { DNS_SERVERS: "   " }, dnsModule, logger: quiet() });

    expect(dnsModule.setServers).not.toHaveBeenCalled();
    expect(result.reason).toBe("not_configured");
  });

  test("says nothing on the happy silent path", () => {
    // A line on every boot about a feature nobody is using is how startup
    // logs become unreadable.
    const logger = quiet();
    applyDnsOverride({ env: {}, dnsModule: { setServers: jest.fn() }, logger });

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("with DNS_SERVERS set", () => {
  test("applies the listed resolvers, in order", () => {
    const dnsModule = { setServers: jest.fn() };
    const result = applyDnsOverride({
      env: { DNS_SERVERS: "8.8.8.8,1.1.1.1" },
      dnsModule,
      logger: quiet(),
    });

    expect(dnsModule.setServers).toHaveBeenCalledWith(["8.8.8.8", "1.1.1.1"]);
    expect(result).toEqual({ applied: true, servers: ["8.8.8.8", "1.1.1.1"], reason: null });
  });

  test("tolerates whitespace and trailing separators", () => {
    const dnsModule = { setServers: jest.fn() };
    applyDnsOverride({
      env: { DNS_SERVERS: " 8.8.8.8 , 1.1.1.1 , " },
      dnsModule,
      logger: quiet(),
    });

    expect(dnsModule.setServers).toHaveBeenCalledWith(["8.8.8.8", "1.1.1.1"]);
  });

  test("a single resolver works", () => {
    const dnsModule = { setServers: jest.fn() };
    applyDnsOverride({ env: { DNS_SERVERS: "10.0.0.2" }, dnsModule, logger: quiet() });

    expect(dnsModule.setServers).toHaveBeenCalledWith(["10.0.0.2"]);
  });

  test("logs what it did, so the override is visible in startup logs", () => {
    // The whole reason this cost us a debugging session is that the old
    // override was invisible: nothing in the logs said the resolver had been
    // replaced, so ENOTFOUND looked like a bad hostname.
    const logger = quiet();
    applyDnsOverride({
      env: { DNS_SERVERS: "8.8.8.8" },
      dnsModule: { setServers: jest.fn() },
      logger,
    });

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("dns_servers_overridden"));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("8.8.8.8"));
  });

  test("a value that parses to nothing is reported, not silently ignored", () => {
    const dnsModule = { setServers: jest.fn() };
    const logger = quiet();
    const result = applyDnsOverride({ env: { DNS_SERVERS: ",,," }, dnsModule, logger });

    expect(dnsModule.setServers).not.toHaveBeenCalled();
    expect(result.reason).toBe("empty_list");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("dns_servers_override_empty")
    );
  });
});

describe("when setServers rejects the value", () => {
  test("does not crash the process -- the platform default still works", () => {
    // Deliberately different from config/env.js's posture on MONGO_CONN. A
    // missing database has no working fallback; a malformed resolver
    // override does, so refusing to boot over it would turn a typo in an
    // optional variable into an outage.
    const dnsModule = {
      setServers: jest.fn(() => {
        throw new Error("Invalid IP address: not-an-ip");
      }),
    };
    const logger = quiet();

    const result = applyDnsOverride({
      env: { DNS_SERVERS: "not-an-ip" },
      dnsModule,
      logger,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/Invalid IP address/);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("dns_servers_override_invalid")
    );
  });

  test("a thrown non-Error still produces a reason rather than undefined", () => {
    const dnsModule = {
      setServers: jest.fn(() => {
        throw "nope";
      }),
    };
    const result = applyDnsOverride({
      env: { DNS_SERVERS: "1.2.3.4" },
      dnsModule,
      logger: quiet(),
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("unknown");
  });
});

describe("the real dns module accepts what we hand it", () => {
  // The tests above all inject a double, which proves the parsing but not
  // that the parsed shape is what node's dns actually wants. This one uses
  // the real module -- and restores the original servers afterwards, since
  // setServers is a process-global side effect that would otherwise leak
  // into every other test file sharing this worker.
  const realDns = require("dns");
  let original;

  beforeAll(() => {
    original = realDns.getServers();
  });
  afterAll(() => {
    realDns.setServers(original);
  });

  test("a parsed list is a valid argument to dns.setServers", () => {
    const result = applyDnsOverride({
      env: { DNS_SERVERS: "8.8.8.8, 1.1.1.1" },
      dnsModule: realDns,
      logger: quiet(),
    });

    expect(result.applied).toBe(true);
    expect(realDns.getServers()).toEqual(expect.arrayContaining(["8.8.8.8", "1.1.1.1"]));
  });
});
