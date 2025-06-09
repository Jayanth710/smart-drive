import express from "express";
import dotenv from 'dotenv';
dotenv.config();
import uploadRouter from "./routes/upload.js";
import { setupPubSub, subscribeToMessages } from "./utils/pubsub.js";

const app = express();
const PORT = process.env.PORT || 4000;

await setupPubSub();
// subscribeToMessages();

app.get("/", (req, res) => {
    res.send("SmartDrive backend running 🚀");
})

app.use('/upload', uploadRouter);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Running on http://localhost:${PORT}`)
})

export default app;