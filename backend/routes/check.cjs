const express = require("express");
require('dotenv').config();
const ServiceArea = require('../models/ServiceArea.cjs');
//delete later
const turf = require("@turf/turf");

const router = express.Router();

const { isPointInBound , getDistance, isPointInAnyBound, getClosestPolygonPoint, getMidpoint, getTwoPointDistance} = require("../services/logic.cjs");
const FareReport = require('../models/FareReport.cjs');
const { rateLimit } = require("express-rate-limit");
const { estimateFare } = require("../services/pricing.cjs");
// active service areas, cached in memory so pricing requests skip the MongoDB round trip
const AREA_CACHE_MS = 5 * 60 * 1000;
let areaCache = { at: 0, areas: null };
async function getActiveAreas() {
  if (!areaCache.areas || Date.now() - areaCache.at > AREA_CACHE_MS) {
    const serviceAreas = await ServiceArea.find({ is_active: true }, { city: true, coordinates: true });
    areaCache = { at: Date.now(), areas: serviceAreas.map(({ city, coordinates }) => ({ city, coordinates })) };
  }
  return areaCache.areas;
}
async function getActiveAreaCoords() {
  return (await getActiveAreas()).map((area) => area.coordinates);
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
  areaCache.areas = null; // pick up the new area on the next request
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

// limits fare reports per client IP to keep spam out of the dataset. Counts are held in
// memory only (IPs are never stored with reports) and reset when the server restarts.
const fareReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,                // reports per IP per window
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many fare reports. Please try again later." },
});

// a user reports what they actually paid for an estimated trip. The estimate is recomputed
// here (not taken from the client) so every report records what the model predicted.
router.post("/fare-reports", fareReportLimiter, async (req, res) => {
  const { pickup, dropoff, distanceMiles, durationMinutes, departAt, paid } = req.body;
  const validCoord = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite);
  const when = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(typeof departAt === "string" ? departAt : "");
  if (!validCoord(pickup) || !validCoord(dropoff) || !when ||
      !Number.isFinite(distanceMiles) || distanceMiles <= 0 || distanceMiles > 200 ||
      !Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 600 ||
      !Number.isFinite(paid) || paid < 1 || paid > 500) {
    return res.status(400).json({ error: "Invalid fare report" });
  }

  const [, y, m, d, h] = when.map(Number);
  const areas = await getActiveAreas();
  const pickupArea = areas.find((area) => isPointInAnyBound(pickup[0], pickup[1], [area.coordinates]));
  const fare = estimateFare(distanceMiles, durationMinutes, departAt);

  await FareReport.create({
    paid: Math.round(paid * 100) / 100,
    city: pickupArea ? pickupArea.city : null,
    pickup,
    dropoff,
    distanceMiles,
    durationMinutes,
    departAt,
    dayOfWeek: new Date(y, m - 1, d).getDay(),
    hour: h,
    estimate: fare.estimate,
    estimateLow: fare.low,
    estimateHigh: fare.high,
    multiplier: fare.multiplier,
    timeLabel: fare.timeLabel,
  });
  res.status(201).json({ ok: true });
})
module.exports = router;