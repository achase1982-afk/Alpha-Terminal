import net from "node:net";
import { execSync } from "node:child_process";

const PORT = Number(process.argv[2] || 8080);

const probe = net.createServer();
probe.once("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    try {
      execSync("pkill -f 'dist/index\\.mjs' 2>/dev/null || true", { stdio: "ignore" });
    } catch {}
    setTimeout(() => process.exit(0), 600);
  } else {
    process.exit(0);
  }
});
probe.once("listening", () => probe.close(() => process.exit(0)));
probe.listen(PORT, "0.0.0.0");
