import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/accounts", (_req, res) => {
  res.json([]);
});

router.get("/orders", (_req, res) => {
  res.json([]);
});

router.get("/transactions", (_req, res) => {
  res.json([]);
});

router.get("/account-hash", (_req, res) => {
  res.status(404).json({ error: "not_configured" });
});

router.post("/place-order", (_req, res) => {
  res.status(400).json({ error: "not_configured" });
});

router.delete("/cancel-order", (_req, res) => {
  res.status(400).json({ error: "not_configured" });
});

export default router;
