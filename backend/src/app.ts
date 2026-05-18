import express from "express";
import dotenv from 'dotenv';
import cors from "cors";
import cookieParser from "cookie-parser";
dotenv.config();
import { validateEnv } from "./config/validateEnv.js";
validateEnv();
import uploadRouter from "./routes/upload.js";
import { setupPubSub } from "./utils/pubsub.js";
import queryRouter from "./routes/query.js";
import userRouter from "./routes/auth.js";
import connectDB from "./db/mongo.js";
import fileRouter from "./routes/file.js";
import { requestContextMiddleware } from "./middleware/requestContext.js";
import { csrfMiddleware } from "./middleware/csrf.js";

const app = express();
const PORT = process.env.PORT || 4000;
const allowedOrigins = [
    "http://localhost:3000",
    "https://smart-drive-eta.vercel.app",
    process.env.FRONT_END_URL
  ].filter(Boolean) as string[];

app.use(requestContextMiddleware);
app.use(express.json())
app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
}))
app.use(express.urlencoded({ extended: true }));

app.use(cookieParser());
app.use(csrfMiddleware);
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