//imports
require('dotenv').config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");


// create the server app
const app = express();
app.use(cors());
//allow JSON (file type) in requests
app.use(express.json());

// connect to MongoDB'
mongoose.connect(process.env.MONGODB_CONNECTION_STRING)
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.error('MongoDB connection error:', err));

// readiness check — cheap, no DB query, safe to poll from the frontend loading screen
app.get("/health", (req, res) => {
    const dbReady = mongoose.connection.readyState === 1; // 1 = connected
    res.status(dbReady ? 200 : 503).json({
        status: dbReady ? "ready" : "starting",
        uptime: process.uptime(),
    });
});

//import router
const router = require("./routes/check.cjs");
//for every request that matches the /api path, direct it to the router
app.use("/api", router);





app.get("/", (req, res) => {
    res.send("Backend is running");

});



//start the server
app.listen(3001, () => {
    console.log("Server running on port 3001");
});

