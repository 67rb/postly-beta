import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = [];
const api = spawn(process.execPath, ["server/index.js"], { cwd: root, stdio: "inherit", env: { ...process.env, API_ONLY: "1", PORT: "4175", APP_BASE_URL: "http://localhost:4174", OAUTH_REDIRECT_BASE: "http://localhost:4175" } });
children.push(api);
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "4174", "--strictPort"], { cwd: root, stdio: "inherit", env: process.env });
children.push(vite);
const shutdown = () => { for (const child of children) if (!child.killed) child.kill("SIGTERM"); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
for (const child of children) child.on("exit", code => { if (code && code !== 0) process.exitCode = code; shutdown(); });
