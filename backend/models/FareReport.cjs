const mongoose = require("mongoose");

// A fare a user says they actually paid for a trip, stored next to what the estimator
// predicted for that same trip. Used to tune RATES and the time multipliers in
// services/pricing.cjs. No user identifiers are stored.
const fareReportSchema = new mongoose.Schema({
    paid: { type: Number, required: true },              // $ the user reported
    city: { type: String, default: null },               // service area containing the pickup
    pickup: { type: [Number], required: true },          // [lng, lat] (snapped into the area)
    dropoff: { type: [Number], required: true },         // [lng, lat]
    distanceMiles: { type: Number, required: true },     // Mapbox driving distance
    durationMinutes: { type: Number, required: true },   // Mapbox driving duration
    departAt: { type: String, required: true },          // local wall-clock "YYYY-MM-DDTHH:mm"
    dayOfWeek: { type: Number, required: true },         // 0 = Sunday ... 6 = Saturday
    hour: { type: Number, required: true },              // 0-23, local
    // what the estimator said at report time, so reports stay comparable as rates change
    estimate: { type: Number, required: true },
    estimateLow: { type: Number, required: true },
    estimateHigh: { type: Number, required: true },
    multiplier: { type: Number, required: true },
    timeLabel: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model("FareReport", fareReportSchema);
