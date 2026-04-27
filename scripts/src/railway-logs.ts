import { spawn } from "node:child_process";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const token = env("RAILWAY_TOKEN");
if (!token) {
  fail("Missing RAILWAY_TOKEN. Add it as a Cursor Cloud secret with Railway project access.");
}

const args = ["logs"];
const service = env("RAILWAY_SERVICE") ?? env("RAILWAY_SERVICE_ID");
const environment = env("RAILWAY_ENVIRONMENT") ?? env("RAILWAY_ENVIRONMENT_ID");
const deployment = env("RAILWAY_DEPLOYMENT_ID");
const lines = env("RAILWAY_LOG_LINES");
const since = env("RAILWAY_LOG_SINCE");
const filter = env("RAILWAY_LOG_FILTER");

if (service) args.push("--service", service);
if (environment) args.push("--environment", environment);
if (lines) args.push("--lines", lines);
if (since) args.push("--since", since);
if (filter) args.push("--filter", filter);
if (deployment) args.push(deployment);

const extraArgsIndex = process.argv.indexOf("--");
if (extraArgsIndex !== -1) {
  args.push(...process.argv.slice(extraArgsIndex + 1));
}

const child = spawn("pnpm", ["exec", "railway", ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    RAILWAY_TOKEN: token,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
