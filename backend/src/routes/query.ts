import {Router} from "express";
import queryHandler from "../handlers/queryHandler.js";
import { verifyToken } from "../middleware/auth.js";

const queryRouter = Router();

queryRouter.get('/', verifyToken, queryHandler);

export default queryRouter;