import express from "express";
import uploadRouter from "./routes/upload.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
    res.send("SmartDrive backend running 🚀");
})

app.use('/upload', uploadRouter);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Running on http://localhost:${PORT}`)
})

export default app;