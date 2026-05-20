import {Router} from "express";
import queryHandler, { logSearchClick } from "../handlers/queryHandler.js";
import { verifyToken } from "../middleware/auth.js";

const queryRouter = Router();

queryRouter.get('/', verifyToken, queryHandler);
// R10 — click logging
queryRouter.post('/click', verifyToken, logSearchClick);

export default queryRouter;