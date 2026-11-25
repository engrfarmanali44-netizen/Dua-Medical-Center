#!/usr/bin/env node
/**
 * Start Dua Medical HMS:  npm run dev
 *
 * Cloud-based: ALL data is stored in Supabase (SUPABASE_DB_URL in .env). Nothing is stored on
 * this PC; it only runs the API (http://localhost:8000) and the web app (http://localhost:3000,
 * or the next free port), and makes them reachable from phones/computers on the same Wi-Fi.
 *
 *   npm run dev                       # normal start
 *   npm run dev -- --this-pc-only     # do not open it to other devices on the Wi-Fi
 *   npm run dev -- --web-port 3005    # choose the web port
 */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const root = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";
const apiDir = path.join(root, "apps", "api");
const webDir = path.join(root, "apps", "web");
const children = [];
const log = (m) => console.log(`[hms] ${m}`);

function fail(message) {
  console.error(`\n[hms] ${message}`);
  shutdown(1);
}

function readEnv() {
  const envFile = path.join(root, ".env");
  if (!fs.existsSync(envFile)) fail("No .env file. Copy .env.example to .env and fill in the Supabase settings.");
  const env = {};
  for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function portFreeOn(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer().once("error", (e) => resolve(e.code === "EADDRNOTAVAIL"))
      .once("listening", () => srv.close(() => resolve(true))).listen(port, host);
  });
}

async function portFree(port) {
  for (const host of [undefined, "127.0.0.1", "::1"]) if (!(await portFreeOn(port, host))) return false;
  return true;
}

async function pickWebPort() {
  const i = process.argv.indexOf("--web-port");
  if (i !== -1) {
    const wanted = Number(process.argv[i + 1]);
    if (!Number.isInteger(wanted) || !(await portFree(wanted))) fail(`--web-port ${process.argv[i + 1]} is not a free port.`);
    return wanted;
  }
  for (let port = 3000; port < 3020; port++) if (await portFree(port)) return port;
  fail("No free web port between 3000 and 3019.");
}

/** First private IPv4 address of this machine (Wi-Fi/Ethernet). */
function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback/i.test(name)) continue;
      candidates.push({ name, address: a.address });
    }
  }
  candidates.sort((x, y) => Number(/wi-?fi|wlan|wireless/i.test(y.name)) - Number(/wi-?fi|wlan|wireless/i.test(x.name)));
  return candidates[0]?.address;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) fail(`Command failed: ${path.basename(cmd)} ${args.join(" ")}`);
}

/** Retried: a slow or unstable internet link to the cloud database can drop a connection. */
async function runWithRetry(cmd, args, opts = {}, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    if (spawnSync(cmd, args, { stdio: "inherit", ...opts }).status === 0) return;
    if (i < attempts) {
      log(`${args.slice(1).join(" ")} failed (attempt ${i}/${attempts}); retrying in 5 s ...`);
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
  fail(`Could not reach the Supabase database after ${attempts} attempts. Check your internet connection and SUPABASE_DB_URL.`);
}

function launch(name, cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: "inherit", shell: false, ...opts });
  child.on("exit", (code) => { if (!shuttingDown) fail(`${name} stopped (code ${code}).`); });
  children.push(child);
}

async function waitFor(url, name, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(url)).ok) return log(`${name} is ready: ${url}`); } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`${name} did not become ready at ${url}`);
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const env = readEnv();

  // 1. Cloud database (required). There is no local database.
  if (!env.SUPABASE_DB_URL) fail("SUPABASE_DB_URL is missing in .env. Add the Supabase Session pooler connection string.");
  const dbUrl = new URL(env.SUPABASE_DB_URL.replace(/^postgres(ql)?(\+psycopg)?:\/\//, "postgresql://"));
  if (!dbUrl.password || dbUrl.password.includes("YOUR-PASSWORD")) fail("SUPABASE_DB_URL has no database password. Replace [YOUR-PASSWORD] with it.");
  for (const k of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SECRET_KEY"]) if (!env[k]) fail(`${k} is missing in .env.`);
  log(`Cloud database: Supabase (${dbUrl.hostname}). Nothing is stored on this PC.`);

  // 2. Python environment for the API
  const venvPy = path.join(apiDir, ".venv", isWin ? "Scripts\\python.exe" : "bin/python");
  if (!fs.existsSync(venvPy)) {
    log("First run: installing the API's Python packages ...");
    run(isWin ? "python" : "python3", ["-m", "venv", path.join(apiDir, ".venv")]);
    run(venvPy, ["-m", "pip", "install", "-r", "requirements.txt"], { cwd: apiDir });
  }

  // 3. Network: open to the Wi-Fi unless --this-pc-only
  const lanIp = process.argv.includes("--this-pc-only") ? null : lanAddress();
  const webPort = await pickWebPort();
  if (webPort !== 3000 && !process.argv.includes("--web-port")) log(`Port 3000 is used by another app; the web app will use ${webPort}.`);
  const apiEnv = { ...process.env, ...env, SEED_DEMO_DATA: "false" }; // never put demo data into the real database
  delete apiEnv.DATABASE_URL; // only SUPABASE_DB_URL is used
  const origins = new Set((apiEnv.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean));
  origins.add(`http://localhost:${webPort}`);
  if (lanIp) origins.add(`http://${lanIp}:${webPort}`);
  apiEnv.CORS_ORIGINS = [...origins].join(",");

  // 4. Bring the cloud database schema up to date (also syncs roles / permissions)
  await runWithRetry(venvPy, ["-m", "alembic", "upgrade", "head"], { cwd: apiDir, env: apiEnv });
  await runWithRetry(venvPy, ["-m", "scripts.seed"], { cwd: apiDir, env: apiEnv });

  // 5. Web dependencies (first run)
  if (!fs.existsSync(path.join(webDir, "node_modules"))) run(isWin ? "npm.cmd" : "npm", ["install"], { cwd: webDir, shell: isWin });

  // 6. Servers. No API auto-reload: restart `npm run dev` after backend code changes.
  launch("API", venvPy, ["-m", "uvicorn", "app.main:app", "--host", lanIp ? "0.0.0.0" : "127.0.0.1", "--port", "8000"], { cwd: apiDir, env: apiEnv });
  await waitFor("http://127.0.0.1:8000/health", "API");
  const webEnv = { ...process.env, ...(lanIp && { HMS_LAN_HOST: lanIp }) };
  launch("Web app", isWin ? "npm.cmd" : "npm", ["run", "dev", "--", "-p", String(webPort), ...(lanIp ? ["-H", "0.0.0.0"] : [])], { cwd: webDir, env: webEnv, shell: isWin });
  await waitFor(`http://localhost:${webPort}/login`, "Web app");

  console.log("\n[hms] Dua Medical HMS is running (data: Supabase cloud).");
  console.log(`  This PC:            http://localhost:${webPort}`);
  if (lanIp) console.log(`  Phones / other PCs: http://${lanIp}:${webPort}   (same Wi-Fi)`);
  console.log("  Press Ctrl+C to stop.\n");
}

main().catch((e) => fail(e.stack || String(e)));
