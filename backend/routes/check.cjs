const express = require("express");
require('dotenv').config();
const ServiceArea = require('../models/ServiceArea.cjs');
//delete later
const turf = require("@turf/turf");

const router = express.Router();

const { isPointInBound , getDistance, isPointInAnyBound, getClosestPolygonPoint, getMidpoint, getTwoPointDistance} = require("../services/logic.cjs");
const { estimateFare } = require("../services/pricing.cjs");
// active service areas, cached in memory so pricing requests skip the MongoDB round trip
const AREA_CACHE_MS = 5 * 60 * 1000;
let areaCache = { at: 0, coords: null };
async function getActiveAreaCoords() {
  if (!areaCache.coords || Date.now() - areaCache.at > AREA_CACHE_MS) {
    const serviceAreas = await ServiceArea.find({ is_active: true }, { coordinates: true });
    areaCache = { at: Date.now(), coords: serviceAreas.map((area) => area.coordinates) };
  }
  return areaCache.coords;
}

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
  areaCache.coords = null; // pick up the new area on the next request
  res.status(201).json(newArea);  
})
// get all service areas
router.get("/service-areas", async (req, res) => {
  const serviceAreas = await ServiceArea.find({is_active: true});
  res.json({ serviceAreas });
})
router.post("/check-point", async (req, res) => {
  const { long, lat } = req.body;
  const serviceAreas = await ServiceArea.find({}, {is_active: true, coordinates: true});
  const coords = serviceAreas.map(area => area.coordinates);
  const outBool = isPointInAnyBound(long, lat, coords)
  res.json({ "point-found": outBool });

})
router.post("/closest-point", async (req, res) => {
  const { long, lat } = req.body;
  const serviceAreas = await ServiceArea.find({}, {is_active: true, coordinates: true});
  const coords = serviceAreas.map(area => area.coordinates);
  const result = getClosestPolygonPoint(long, lat, coords);

  res.json({ "closest-point": result[0], "closest-poly": result[1] });

})
router.post("/midpoint", async (req, res) => {
  const { coordArr1, coordArr2 } = req.body;
  const midpoint = getMidpoint(coordArr1, coordArr2);
  const distance = getTwoPointDistance(coordArr1, coordArr2);
  res.json({ "midpoint": midpoint, "distance": distance});

})
// estimate the fare for a trip. The frontend supplies the driving distance/duration
// (from Mapbox Directions); this checks both ends are serviceable and prices it.
router.post("/estimate-price", async (req, res) => {
  const { pickup, dropoff, distanceMiles, durationMinutes, departAt } = req.body;
  const validCoord = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite);
  if (!validCoord(pickup) || !validCoord(dropoff) ||
      !Number.isFinite(distanceMiles) || !Number.isFinite(durationMinutes) ||
      distanceMiles < 0 || durationMinutes < 0) {
    return res.status(400).json({ error: "pickup, dropoff, distanceMiles and durationMinutes are required" });
  }

  const coords = await getActiveAreaCoords();
  const pickupInArea = coords.length > 0 && isPointInAnyBound(pickup[0], pickup[1], coords);
  const dropoffInArea = coords.length > 0 && isPointInAnyBound(dropoff[0], dropoff[1], coords);

  res.json({
    serviceable: pickupInArea && dropoffInArea,
    pickupInArea,
    dropoffInArea,
    distanceMiles,
    durationMinutes,
    ...estimateFare(distanceMiles, durationMinutes, departAt),
  });
})
module.exports = router;