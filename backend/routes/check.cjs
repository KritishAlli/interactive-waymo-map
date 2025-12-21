const express = require("express");
//delete later
const turf = require("@turf/turf");

const router = express.Router();

const { isPointInBound } = require("../services/logic.cjs");

router.post("/check", (req, res) => {
    const { long, lat } = req.body;
    var poly = turf.polygon([
        [
          [-81, 41],
          [-81, 47],
          [-72, 47],
          [-72, 41],
          [-81, 41],
        ],
      ]);
    const output = isPointInBound(long, lat, poly);

    res.json({ output });
})

module.exports = router;