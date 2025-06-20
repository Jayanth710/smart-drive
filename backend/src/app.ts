import express from "express";
import dotenv from 'dotenv';
import cors from "cors";
dotenv.config();
import uploadRouter from "./routes/upload.js";
import { setupPubSub } from "./utils/pubsub.js";
import queryRouter from "./routes/query.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json())
app.use(cors())

await setupPubSub();

app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
    res.send("SmartDrive backend running 🚀");
})

app.use('/upload', uploadRouter);
app.use('/query', queryRouter);

app.listen(PORT, () => {
    console.log(`Running on http://localhost:${PORT}`)
})

export default app;