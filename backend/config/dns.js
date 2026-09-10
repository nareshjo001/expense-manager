"use strict";

// Opt-in DNS resolver override.
//
// backend/server.js used to begin with an unconditional
//
//   dns.setServers(["8.8.8.8", "1.1.1.1"]);
//
// commented "Fix MongoDB Atlas SRV DNS resolution before anything else". The
// problem it solved is real -- some local networks and ISP resolvers do not
// return Atlas's SRV records, so `mongodb+srv://` URIs fail to resolve on a
// developer's laptop. But it was applied unconditionally, and a workaround
// for one laptop is a hazard everywhere else:
//
//   - It replaces the platform's resolver wholesale. On a managed host
//     (Render, Fly, ECS) the platform resolver is the only one guaranteed
//     reachable; outbound UDP/53 to a public resolver may be blocked or
//     silently dropped. When it is, EVERY lookup fails -- and it surfaces as
//     `querySrv ENOTFOUND _mongodb._tcp.<host>`, which reads exactly like a
//     wrong hostname rather than like a resolver problem.
//   - It defeats private DNS. A VPC-internal Atlas endpoint, a private
//     hosted zone, or any split-horizon name resolves only through the
//     platform resolver; 8.8.8.8 has never heard of it.
//   - It sends this application's name lookups to two third parties that
//     were never chosen deliberately.
//
// So: opt in, explicitly, via DNS_SERVERS. Unset -- the production case --
// leaves Node on the platform resolver, which is the correct default.
//
// This lives in its own module rather than inline in server.js so the
// behaviour can be tested without booting an HTTP listener, and so the
// reasoning above sits next to the code it explains.

// Applies the override if and only if DNS_SERVERS is set and non-empty.
//
// `dnsModule` is injected so a test can assert what would be handed to
// setServers without actually repointing the test runner's resolver -- a
// global side effect that would leak into every other test file in the
// process.
//
// Returns { applied, servers, reason }:
//   applied false + reason "not_configured"  -- no override requested
//   applied false + reason "empty_list"      -- set, but nothing parseable
//   applied false + reason <error message>   -- setServers rejected it
//   applied true                             -- override in effect
function applyDnsOverride({ env = process.env, dnsModule = require("dns"), logger = console } = {}) {
  const raw = env.DNS_SERVERS;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { applied: false, servers: [], reason: "not_configured" };
  }

  const servers = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (servers.length === 0) {
    // DNS_SERVERS="," or similar. Calling setServers([]) would throw, and
    // "the operator set the variable but it parsed to nothing" is worth
    // saying out loud rather than treating as unset.
    logger.error(JSON.stringify({ event: "dns_servers_override_empty", raw }));
    return { applied: false, servers: [], reason: "empty_list" };
  }

  try {
    dnsModule.setServers(servers);
    logger.log(JSON.stringify({ event: "dns_servers_overridden", servers }));
    return { applied: true, servers, reason: null };
  } catch (err) {
    // An invalid entry makes setServers throw and leaves the resolver list
    // unchanged. Deliberately NOT fatal: the platform default is a working
    // configuration, so a malformed override should be loud and ignored
    // rather than take the process down. This is the opposite of
    // config/env.js's posture on MONGO_CONN, and for a reason -- a missing
    // database has no working fallback, a missing resolver override does.
    const reason = (err && err.message) || "unknown";
    logger.error(JSON.stringify({ event: "dns_servers_override_invalid", servers, reason }));
    return { applied: false, servers, reason };
  }
}

module.exports = { applyDnsOverride };
