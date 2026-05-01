import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function deployRevision(): string | undefined {
  const v =
    process.env["RAILWAY_GIT_COMMIT_SHA"] ??
    process.env["GIT_COMMIT"] ??
    process.env["SOURCE_VERSION"] ??
    process.env["VERCEL_GIT_COMMIT_SHA"];
  return v && v.length > 0 ? v : undefined;
}

router.get("/healthz", (_req, res) => {
  const rev = deployRevision();
  const data = HealthCheckResponse.parse({
    status: "ok",
    ...(rev !== undefined ? { deployRevision: rev } : {}),
  });
  res.json(data);
});

export default router;
