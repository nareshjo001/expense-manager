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
    let stdout = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_STDERR_LENGTH) stderr = stderr.slice(-MAX_STDERR_LENGTH);
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_STDERR_LENGTH) stdout = stdout.slice(-MAX_STDERR_LENGTH);
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      // Resolving with the captured output, rather than with nothing, is a
      // fix for a real diagnosis failure. mongorestore reports what it did
      // ("N document(s) restored successfully") on stderr and exits 0 even
      // when N is zero -- so discarding output on success threw away the one
      // line that said the restore had silently done nothing. Callers that
      // ignore the return value are unaffected.
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

module.exports = { spawnProcess };
