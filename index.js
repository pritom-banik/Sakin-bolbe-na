require('dotenv').config();

const express=require("express")
const cors = require('cors');
const PORT=process.env.PORT||5002

const app=express()
app.use(express.json());
app.use(cors());

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});