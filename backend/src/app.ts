import express from "express";
import dotenv from 'dotenv';
dotenv.config();
import uploadRouter from "./routes/upload.js";
import { setupPubSub } from "./utils/pubsub.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
    res.send("SmartDrive backend running 🚀");
})

await setupPubSub();

app.use('/upload', uploadRouter);

app.listen(PORT, () => {
    console.log(`Running on http://localhost:${PORT}`)
})

export default app;