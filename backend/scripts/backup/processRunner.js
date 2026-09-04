"use strict";

// Small shared child_process wrapper used by every backup/restore/verify
// script here (openssl, mongodump, mongorestore, tar). One place to get
// stderr capture (bounded, so a runaway process can't OOM this script)
// and exit-code handling right, rather than repeating it per tool.
const { spawn } = require("child_process");

const MAX_STDERR_LENGTH = 4000;

// Spawns `command args`, optionally writing `stdin` (a string/Buffer) to
// the child's stdin then closing it -- used for openssl's `-pass stdin`
// so a secret never appears as a CLI argument (visible in `ps aux`) or
// an env var dump. Resolves on exit code 0; rejects with an Error whose
// message includes (bounded) stderr otherwise. Never includes `stdin` in
// any error message or log line -- callers own not leaking secrets into
// argv in the first place, this wrapper does not echo what it was given.
function spawnProcess(command, args, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_STDERR_LENGTH) stderr = stderr.slice(-MAX_STDERR_LENGTH);
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

module.exports = { spawnProcess };
