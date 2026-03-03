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

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "aura-backend" });
});

app.listen(PORT, () => {
  console.log(`Aura backend running at http://localhost:${PORT}`);
});
