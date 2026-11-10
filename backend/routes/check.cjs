const express = require("express");
require('dotenv').config();
const ServiceArea = require('../models/ServiceArea.cjs');
//delete later
const turf = require("@turf/turf");

const router = express.Router();

const { isPointInBound , getDistance, isPointInAnyBound, getClosestPolygonPoint, getMidpoint, getTwoPointDistance} = require("../services/logic.cjs");
const { estimateFare } = require("../services/pricing.cjs");
const { toPolygons, snapEndpoint, checkRoute, MAX_SNAP_MILES } = require("../services/routing.cjs");

const validCoord = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite);

async function getActivePolygons() {
  const serviceAreas = await ServiceArea.find({ is_active: true }, { city: true, coordinates: true });
  return { areas: serviceAreas, polys: toPolygons(serviceAreas.map((a) => a.coordinates)) };
}

// where would a Waymo actually pick up / drop off for these addresses?
// outside addresses (within MAX_SNAP_MILES) are moved to the nearest point inside a service area
router.post("/route-endpoints", async (req, res) => {
  const { pickup, dropoff } = req.body;
  if (!validCoord(pickup) || !validCoord(dropoff)) {
    return res.status(400).json({ error: "pickup and dropoff must be [lng, lat]" });
  }
  const { areas, polys } = await getActivePolygons();
  const p = snapEndpoint(pickup, polys);
  const d = snapEndpoint(dropoff, polys);
  if (p.error || d.error) return res.status(503).json({ error: p.error || d.error });

  const label = (e) => areas[e.areaIndex]?.city;
  let error = null;
  if (p.tooFar || d.tooFar) {
    const which = p.tooFar && d.tooFar ? "Pickup and dropoff are" : p.tooFar ? "Pickup is" : "Dropoff is";
    error = `${which} more than ${MAX_SNAP_MILES} miles from a Waymo service area.`;
  } else if (p.areaIndex !== d.areaIndex) {
    error = `Pickup (${label(p)}) and dropoff (${label(d)}) are in different service areas.`;
  }

  res.json({
    error,
    city: label(p),
    pickup: p,
    dropoff: d,
  });
})

// which candidate routes stay inside the service areas?
router.post("/route-check", async (req, res) => {
  const { routes } = req.body;
  if (!Array.isArray(routes) || !routes.every((r) => Array.isArray(r) && r.every(validCoord))) {
    return res.status(400).json({ error: "routes must be an array of [[lng, lat], ...] lines" });
  }
  const { polys } = await getActivePolygons();
  res.json({ results: routes.map((coords) => checkRoute(coords, polys)) });
})

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

  const serviceAreas = await ServiceArea.find({ is_active: true }, { coordinates: true });
  const coords = serviceAreas.map(area => area.coordinates);
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