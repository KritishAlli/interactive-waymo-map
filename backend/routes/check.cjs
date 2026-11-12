const express = require("express");
require('dotenv').config();
const ServiceArea = require('../models/ServiceArea.cjs');

const router = express.Router();

const { isPointInAnyBound } = require("../services/logic.cjs");
const FareReport = require('../models/FareReport.cjs');
const { rateLimit } = require("express-rate-limit");
// active service areas, cached in memory so fare reports skip the MongoDB round trip
const AREA_CACHE_MS = 5 * 60 * 1000;
let areaCache = { at: 0, areas: null };
async function getActiveAreas() {
  if (!areaCache.areas || Date.now() - areaCache.at > AREA_CACHE_MS) {
    const serviceAreas = await ServiceArea.find({ is_active: true }, { city: true, coordinates: true });
    areaCache = { at: Date.now(), areas: serviceAreas.map(({ city, coordinates }) => ({ city, coordinates })) };
  }
  return areaCache.areas;
}

// Writes need the ADMIN_KEY env var sent as an "x-admin-key" header. If ADMIN_KEY isn't
// set, every write is refused.
const crypto = require("crypto");
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_KEY;
  const given = req.get("x-admin-key");
  if (!expected || typeof given !== "string") return res.status(401).json({ error: "Unauthorized" });
  // compare hashes so lengths match and the check takes the same time either way
  const hash = (s) => crypto.createHash("sha256").update(s).digest();
  if (!crypto.timingSafeEqual(hash(given), hash(expected))) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// add service areas (admin only)
router.post("/service-areas", requireAdmin, async (req, res) => {
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
// limits fare reports per client IP to keep spam out of the dataset. Counts are held in
// memory only (IPs are never stored with reports) and reset when the server restarts.
const fareReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,                // reports per IP per window
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many fare reports. Please try again later." },
});

// a user reports what they actually paid for an estimated trip. Pricing lives only in the
// frontend (frontend/src/pricing.js), so the browser sends the estimate the app made for
// that trip and ride time; it's stored as-is next to the paid amount.
router.post("/fare-reports", fareReportLimiter, async (req, res) => {
  const { pickup, dropoff, distanceMiles, durationMinutes, departAt, paid, fare } = req.body;
  const validCoord = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite);
  const validMoney = (n) => Number.isFinite(n) && n > 0 && n <= 1000;
  const when = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(typeof departAt === "string" ? departAt : "");
  const validFare = fare && typeof fare === "object" &&
    validMoney(fare.estimate) && validMoney(fare.low) && validMoney(fare.high) &&
    fare.low <= fare.estimate && fare.estimate <= fare.high &&
    Number.isFinite(fare.multiplier) && fare.multiplier > 0 && fare.multiplier <= 5 &&
    typeof fare.timeLabel === "string" && fare.timeLabel.length > 0 && fare.timeLabel.length <= 40;
  if (!validCoord(pickup) || !validCoord(dropoff) || !when || !validFare ||
      !Number.isFinite(distanceMiles) || distanceMiles <= 0 || distanceMiles > 200 ||
      !Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 600 ||
      !Number.isFinite(paid) || paid < 1 || paid > 500) {
    return res.status(400).json({ error: "Invalid fare report" });
  }

  const [, y, m, d, h] = when.map(Number);
  const areas = await getActiveAreas();
  const pickupArea = areas.find((area) => isPointInAnyBound(pickup[0], pickup[1], [area.coordinates]));

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