const express = require("express");
require('dotenv').config();
const ServiceArea = require('../models/ServiceArea.cjs');
//delete later
const turf = require("@turf/turf");

const router = express.Router();

const { isPointInBound } = require("../services/logic.cjs");

router.post("/check", async (req, res) => {
    const { long, lat } = req.body;
    //return all service areas
    // await and async used because .find can take a while, so wait for this line to finish before moving on
    const serviceAreas = await ServiceArea.find({is_active: true});
    const out = serviceAreas[0].coordinates;
    res.json({ serviceAreas });
})

// add service areas
router.post("/service-areas", async (req, res) => {
  const newArea = new ServiceArea(req.body);
  await newArea.save();
  res.status(201).json(newArea);  
})
// get all service areas
router.get("/service-areas", async (req, res) => {
  const serviceAreas = await ServiceArea.find({is_active: true});
  res.json({ serviceAreas });
})
module.exports = router;