require('dotenv').config();

const express=require("express")
const cors = require('cors');
const PORT=process.env.PORT||5002
const {welcomeapi}=require("./src/services/welcomeapi/entry")

const app=express()
app.use(express.json());
app.use(cors());

app.post("/analyze-ticket", welcomeapi);


app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});



app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});