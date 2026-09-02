import { Router } from "express";
import { envelopesRouter } from "./envelopes.routes";
import { transactionsRouter } from "./transactions.routes";
import { vaultRouter } from "./vault.routes";

export const apiRouter = Router();

apiRouter.use("/envelopes", envelopesRouter);
apiRouter.use("/transactions", transactionsRouter);
apiRouter.use("/vault", vaultRouter);
