"use strict";

// Opt-in DNS resolver override. 1"]); commented "Fix MongoDB Atlas SRV DNS resolution before anything else".

// Applies the override if and only if DNS_SERVERS is set and non-empty.
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
    // DNS_SERVERS="," or similar.
    logger.error(JSON.stringify({ event: "dns_servers_override_empty", raw }));
    return { applied: false, servers: [], reason: "empty_list" };
  }

  try {
    dnsModule.setServers(servers);
    logger.log(JSON.stringify({ event: "dns_servers_overridden", servers }));
    return { applied: true, servers, reason: null };
  } catch (err) {
    // An invalid entry makes setServers throw and leaves the resolver list unchanged.
    const reason = (err && err.message) || "unknown";
    logger.error(JSON.stringify({ event: "dns_servers_override_invalid", servers, reason }));
    return { applied: false, servers, reason };
  }
}

module.exports = { applyDnsOverride };
