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
//
// Windows follow Obi's rideshare pricing reports (SF, Mar-Apr 2025 and Jan 2026):
// Waymo prices peak 4-6 pm (highest 5-6 pm) and bottom out around 5-6 am. Those reports
// show no clear morning peak, so the morning commute gets only a small bump. The weekend
// night window is not covered by that data and remains a guess.
function getTimeMultiplier(departAt) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(departAt || "");
    if (!match) return { multiplier: 1.0, label: "Standard" };

    const [, y, m, d, h] = match.map(Number);
    const day = new Date(y, m - 1, d).getDay(); // 0 = Sunday ... 6 = Saturday
    const hour = h;
    const isWeekday = day >= 1 && day <= 5;

    if (isWeekday && hour >= 16 && hour < 18) {
        return { multiplier: 1.3, label: "Evening peak" };
    }
    if (isWeekday && hour >= 7 && hour < 9) {
        return { multiplier: 1.1, label: "Morning commute" };
    }
    const isFriSatNight = (day === 5 || day === 6) && hour >= 21;
    const isSatSunEarly = (day === 6 || day === 0) && hour < 3;
    if (isFriSatNight || isSatSunEarly) {
        return { multiplier: 1.2, label: "Weekend night" };
    }
    if (hour >= 4 && hour < 7) {
        return { multiplier: 0.9, label: "Early morning" };
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
