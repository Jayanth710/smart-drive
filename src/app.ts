import express from "express";

const app = express();
const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
    res.send("SmartDrive backend running 🚀");
})

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Running on http://localhost:${PORT}`)
})

export default app;