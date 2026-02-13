import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const outDir = path.join(rootDir, "dist", "release-web");
const npmCmd = "npm";
const shell = process.platform === "win32";

function run(args, cwd = rootDir) {
  const res = spawnSync(npmCmd, args, { stdio: "inherit", cwd, env: process.env, shell });
  if ((res.status ?? 1) !== 0) process.exit(res.status ?? 1);
}

async function ensureEmptyDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code !== "EBUSY" && code !== "EPERM") throw err;
  }
  await fs.mkdir(dir, { recursive: true });
}

async function copyDir(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true });
}

function createRunBat() {
  const lines = [
    "@echo off",
    "setlocal",
    "cd /d %~dp0",
    "set HOST=127.0.0.1",
    "if \"%PORT%\"==\"\" set PORT=8787",
    "set DATA_DIR=%~dp0data\\admin",
    "set WEB_DIST_DIR=%~dp0apps\\admin-web\\dist",
    "if not exist node_modules (",
    "  npm install --omit=dev --no-audit --no-fund",
    ")",
    "node apps\\admin-server\\dist\\index.js",
  ];
  return lines.join("\r\n") + "\r\n";
}

/**
 * 生成用于 release-web 目录的 Dockerfile。
 */
function createDockerfile() {
  const lines = [
    "FROM node:20-alpine",
    "WORKDIR /app",
    "",
    "ENV NODE_ENV=production",
    "ENV HOST=0.0.0.0",
    "ENV PORT=8787",
    "ENV DATA_DIR=/data/admin",
    "ENV WEB_DIST_DIR=/app/apps/admin-web/dist",
    "",
    "COPY package.json package-lock.json ./",
    "RUN npm ci --omit=dev --no-audit --no-fund",
    "",
    "COPY . .",
    "EXPOSE 8787",
    'CMD ["node", "apps/admin-server/dist/index.js"]',
  ];
  return lines.join("\n") + "\n";
}

/**
 * 生成用于 release-web 目录的 .dockerignore，避免把 node_modules/data 打进镜像构建上下文。
 */
function createDockerIgnore() {
  const lines = ["node_modules", "data", "logs*", ".git", ".DS_Store"];
  return lines.join("\n") + "\n";
}

/**
 * 生成用于 release-web 目录的 docker-compose.yml。
 */
function createDockerComposeYml() {
  const lines = [
    "services:",
    "  farm-release-web:",
    "    build: .",
    "    image: farm-release-web:latest",
    "    restart: unless-stopped",
    "    ports:",
    '      - "8787:8787"',
    "    environment:",
    '      HOST: "0.0.0.0"',
    '      PORT: "8787"',
    '      DATA_DIR: "/data/admin"',
    '      WEB_DIST_DIR: "/app/apps/admin-web/dist"',
    '      QRLIB_BASE_URL: "http://127.0.0.1:5656"',
    "    volumes:",
    "      - ./data:/data/admin",
  ];
  return lines.join("\n") + "\n";
}

function createRunSh() {
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'cd "$(dirname "$0")"',
    'export HOST="${HOST:-0.0.0.0}"',
    'export PORT="${PORT:-8787}"',
    'export DATA_DIR="${DATA_DIR:-$PWD/data/admin}"',
    'export WEB_DIST_DIR="${WEB_DIST_DIR:-$PWD/apps/admin-web/dist}"',
    "",
    "# 清理端口占用，避免重复启动时端口被历史进程占用",
    "cleanup_port() {",
    "  local port=\"$1\"",
    "  if command -v lsof >/dev/null 2>&1; then",
    "    local pids",
    "    pids=\"$(lsof -tiTCP:\"$port\" -sTCP:LISTEN 2>/dev/null || true)\"",
    "    if [ -n \"${pids:-}\" ]; then",
    "      echo \"[run] PORT=$port is in use, killing: $pids\"",
    "      kill -9 $pids 2>/dev/null || true",
    "    fi",
    "    return 0",
    "  fi",
    "",
    "  if command -v fuser >/dev/null 2>&1; then",
    "    if fuser -n tcp \"$port\" >/dev/null 2>&1; then",
    "      echo \"[run] PORT=$port is in use, killing via fuser\"",
    "      fuser -k \"${port}\"/tcp >/dev/null 2>&1 || true",
    "    fi",
    "    return 0",
    "  fi",
    "",
    "  if command -v ss >/dev/null 2>&1; then",
    "    local pids",
    "    pids=\"$(ss -lptn \"sport = :$port\" 2>/dev/null | awk -F'pid=' 'NR>1{print $2}' | awk -F',' '{print $1}' | sort -u | tr '\\n' ' ' || true)\"",
    "    if [ -n \"${pids// /}\" ]; then",
    "      echo \"[run] PORT=$port is in use, killing: $pids\"",
    "      kill -9 $pids 2>/dev/null || true",
    "    fi",
    "    return 0",
    "  fi",
    "",
    "  echo \"[run] WARN: cannot check/kill PORT=$port (missing lsof/fuser/ss)\"",
    "}",
    "",
    "cleanup_port \"$PORT\"",
    'if [ ! -d "node_modules" ]; then',
    "  npm install --omit=dev --no-audit --no-fund",
    "fi",
    "node apps/admin-server/dist/index.js",
  ];
  return lines.join("\n") + "\n";
}

async function main() {
  await ensureEmptyDir(outDir);

  run(["--workspace", "apps/admin-web", "run", "build"]);
  run(["--workspace", "apps/admin-server", "run", "build"]);

  await copyDir(path.join(rootDir, "apps", "admin-web", "dist"), path.join(outDir, "apps", "admin-web", "dist"));
  await copyDir(path.join(rootDir, "apps", "admin-server", "dist"), path.join(outDir, "apps", "admin-server", "dist"));
  await fs.mkdir(path.join(outDir, "apps", "admin-server"), { recursive: true });
  await fs.copyFile(
    path.join(rootDir, "apps", "admin-server", "package.json"),
    path.join(outDir, "apps", "admin-server", "package.json")
  );

  await copyDir(path.join(rootDir, "src"), path.join(outDir, "src"));
  await copyDir(path.join(rootDir, "proto"), path.join(outDir, "proto"));
  await copyDir(path.join(rootDir, "gameConfig"), path.join(outDir, "gameConfig"));
  try {
    await copyDir(path.join(rootDir, "tools"), path.join(outDir, "tools"));
  } catch {}

  const rootPkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const adminServerPkg = JSON.parse(
    await fs.readFile(path.join(rootDir, "apps", "admin-server", "package.json"), "utf8")
  );
  const mergedDeps = {
    ...(rootPkg.dependencies ?? {}),
    ...(adminServerPkg.dependencies ?? {}),
  };

  const pkg = {
    name: "farm-release-web",
    private: true,
    version: "0.0.0",
    type: "commonjs",
    scripts: {
      start: "node apps/admin-server/dist/index.js",
    },
    dependencies: mergedDeps,
  };
  await fs.writeFile(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(outDir, "run.bat"), createRunBat(), "utf8");
  await fs.writeFile(path.join(outDir, "run.sh"), createRunSh(), "utf8");
  await fs.writeFile(path.join(outDir, "Dockerfile"), createDockerfile(), "utf8");
  await fs.writeFile(path.join(outDir, ".dockerignore"), createDockerIgnore(), "utf8");
  await fs.writeFile(path.join(outDir, "docker-compose.yml"), createDockerComposeYml(), "utf8");
  await fs.chmod(path.join(outDir, "run.sh"), 0o755);

  run(["install", "--omit=dev", "--no-audit", "--no-fund"], outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
