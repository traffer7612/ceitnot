import "dotenv/config";
import express from "express";
import cors from "cors";
import { configRouter } from "./routes/config.js";
import { statsRouter } from "./routes/stats.js";
import { faucetRouter } from "./routes/faucet.js";
import { rpcRouter } from "./routes/rpc.js";

const app = express();
const PORT = process.env.PORT ?? 3002;

app.use(cors({ origin: true }));
app.use(express.json());

app.use("/api/config", configRouter);
app.use("/api/stats", statsRouter);
app.use("/api/faucet", faucetRouter);
app.use("/api", rpcRouter);

/** Railway opens the service root URL — no SPA here, only JSON API. */
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "ceitnot-backend",
    health: "/api/health",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "ceitnot-backend" });
});

app.listen(PORT, () => {
  console.log(`Ceitnot backend running at http://localhost:${PORT}`);
});
