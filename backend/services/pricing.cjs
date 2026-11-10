// Fare estimation for a Waymo trip.
// Waymo does not publish its pricing formula; these rates are approximations meant to
// land in the same range as reported Waymo fares. Tune them here.
const RATES = {
    base: 3.00,          // flat start fee ($)
    perMile: 1.75,       // $ per mile driven
    perMinute: 0.40,     // $ per minute of drive time
    bookingFee: 2.50,    // flat fee added after the time-of-day multiplier ($)
    minimumFare: 8.00,   // no trip costs less than this ($)
    rangeSpread: 0.12,   // low/high estimate = estimate -/+ 12%
};

// departAt is a wall-clock "YYYY-MM-DDTHH:mm" string in the trip's local time.
// Returns { multiplier, label } for that day/hour.
function getTimeMultiplier(departAt) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(departAt || "");
    if (!match) return { multiplier: 1.0, label: "Standard" };

    const [, y, m, d, h] = match.map(Number);
    const day = new Date(y, m - 1, d).getDay(); // 0 = Sunday ... 6 = Saturday
    const hour = h;
    const isWeekday = day >= 1 && day <= 5;

    if (isWeekday && ((hour >= 7 && hour < 10) || (hour >= 16 && hour < 19))) {
        return { multiplier: 1.3, label: "Rush hour" };
    }
    const isFriSatNight = (day === 5 || day === 6) && hour >= 21;
    const isSatSunEarly = (day === 6 || day === 0) && hour < 3;
    if (isFriSatNight || isSatSunEarly) {
        return { multiplier: 1.2, label: "Weekend night" };
    }
    if (hour >= 0 && hour < 5) {
        return { multiplier: 0.9, label: "Late night" };
    }
    return { multiplier: 1.0, label: "Standard" };
}

const round2 = (n) => Math.round(n * 100) / 100;

function estimateFare(distanceMiles, durationMinutes, departAt) {
    const { multiplier, label } = getTimeMultiplier(departAt);

    const distanceCost = RATES.perMile * distanceMiles;
    const timeCost = RATES.perMinute * durationMinutes;
    const subtotal = (RATES.base + distanceCost + timeCost) * multiplier;
    const estimate = Math.max(RATES.minimumFare, subtotal + RATES.bookingFee);

    return {
        estimate: round2(estimate),
        low: round2(Math.max(RATES.minimumFare, estimate * (1 - RATES.rangeSpread))),
        high: round2(estimate * (1 + RATES.rangeSpread)),
        multiplier,
        timeLabel: label,
        breakdown: {
            base: RATES.base,
            distance: round2(distanceCost),
            time: round2(timeCost),
            bookingFee: RATES.bookingFee,
        },
    };
}

module.exports = { estimateFare, getTimeMultiplier, RATES };
