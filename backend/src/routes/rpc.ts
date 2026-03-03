import { Router, Request, Response } from "express";

const RPC_URLS: Record<string, string> = {
  "42161": process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
};

export const rpcRouter = Router();

rpcRouter.post("/rpc/:chainId", async (req: Request, res: Response) => {
  const { chainId } = req.params;
  const url = RPC_URLS[chainId];
  if (!url) {
    return res.status(400).json({ error: `Unknown chainId: ${chainId}` });
  }
  try {
    const rpcRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await rpcRes.json();
    res.status(rpcRes.status).json(data);
  } catch (e) {
    console.error("RPC proxy error:", e);
    res.status(502).json({ error: "RPC proxy failed", message: String(e) });
  }
});
