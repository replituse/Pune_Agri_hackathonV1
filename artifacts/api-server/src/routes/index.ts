import { Router, type IRouter } from "express";
import healthRouter from "./health";
import extractRouter from "./extract";
import schemesRouter from "./schemes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(extractRouter);
router.use(schemesRouter);

export default router;
