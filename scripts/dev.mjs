import { spawn } from "node:child_process";

const npmCmd = "npm";

function start(args) {
  const child = spawn(npmCmd, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  return child;
}

const server = start(["--workspace", "apps/admin-server", "run", "dev"]);
const web = start(["--workspace", "apps/admin-web", "run", "dev"]);

function shutdown() {
  server.kill("SIGINT");
  web.kill("SIGINT");
}

let shuttingDown = false;

function exitWith(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdown();
  process.exit(code);
}

server.on("exit", (code, signal) => {
  if (signal) exitWith(1);
  exitWith(code ?? 1);
});

web.on("exit", (code, signal) => {
  if (signal) exitWith(1);
  exitWith(code ?? 1);
});

process.on("SIGINT", () => {
  exitWith(0);
});
