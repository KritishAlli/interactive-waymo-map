//imports
const express = require("express");
const cors = require("cors");


// create the server app
const app = express();
app.use(cors());
//allow JSON (file type) in requests
app.use(express.json());

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

