import {Router} from "express";
import path from "path";
import { fileURLToPath } from "url";
import queryHandler from "../handlers/queryHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const queryRouter = Router();

queryRouter.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../../public/query.html"))
})

queryRouter.post('/', queryHandler);

export default queryRouter;