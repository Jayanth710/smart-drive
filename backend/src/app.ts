import express from "express";
import dotenv from 'dotenv';
import cors from "cors";
dotenv.config();
import uploadRouter from "./routes/upload.js";
import { setupPubSub } from "./utils/pubsub.js";
import queryRouter from "./routes/query.js";
import userRouter from "./routes/auth.js";
import connectDB from "./db/mongo.js";
import { verifyToken } from "./middleware/auth.js";
import fileRouter from "./routes/file.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json())
app.use(cors({
    origin: "http://localhost:3000",
    credentials: true,
  }))
app.use(express.urlencoded({ extended: true }));

await connectDB()
await setupPubSub();

app.get("/", (req, res) => {
    res.send("SmartDrive backend running 🚀");
})

app.use('/api', userRouter)
app.use('/upload', uploadRouter);
app.use('/search', queryRouter);
app.use('/file', fileRouter)

app.listen(PORT, () => {
    console.log(`Running on http://localhost:${PORT}`)
})


export default app;