// Fare estimation for a Waymo trip. This is the only copy of the pricing logic: it runs in
// the browser so estimates never wait on the (free-tier, slow to wake) backend, and fare
// reports send its estimate to the backend to be stored next to what the user paid.
//
// Waymo does not publish its pricing formula. Per-city rates are least-squares fits
// (coefficients constrained >= 0) to the crowdsourced rides behind the Waymo Price Tracker
// (https://waymo-pricing.streamlit.app, data: github.com/EwoutH/Waymo-pricing), using the
// tracker's outlier filters: 113 rides, mostly 2024, as of Nov 2026. Each fit's intercept
// is split into `base` + the shared booking fee. Tune rates here.
//
// Prices differ a lot by city: Phoenix rides average ~$17 against ~$25 in SF and LA, and
// Phoenix barely charges for distance (fast, freeway-heavy trips), so one formula for all
// cities was off by several dollars. Re-fit when more rides are reported.
export const CITY_RATES = {
  //                    base ($)  $/mile  $/minute   fit: n, R²
  "San Francisco Bay": { base: 8.92, perMile: 1.48, perMinute: 0.31 }, // n=51, R² 0.74
  "Los Angeles":       { base: 5.64, perMile: 1.58, perMinute: 0.30 }, // n=24, R² 0.78
  "Phoenix":           { base: 8.08, perMile: 0.21, perMinute: 0.27 }, // n=38, R² 0.42
};

// Cities with no ride data yet (Dallas, San Diego, new areas): the average of the three
// fitted cities. A guess until rides from those cities are reported.
export const DEFAULT_RATES = { base: 7.55, perMile: 1.09, perMinute: 0.29 };

export const FEES = {
  bookingFee: 2.50,    // flat fee added after the time-of-day multiplier ($)
  minimumFare: 7.50,   // no trip costs less than this ($); lowest fare in the data was $7.51
  rangeSpread: 0.15,   // low/high = estimate -/+ 15%; the middle half of tracker rides
                       // landed within about -16%/+12% of their city's fit
};

export function ratesForCity(city) {
  return CITY_RATES[city] || DEFAULT_RATES;
}

// departAt is a wall-clock "YYYY-MM-DDTHH:mm" string in the trip's local time.
// Returns { multiplier, label } for that day/hour.
//
// Windows follow Obi's rideshare pricing reports (SF, Mar-Apr 2025 and Jan 2026):
// Waymo prices peak 4-6 pm (highest 5-6 pm) and bottom out around 5-6 am. Those reports
// show no clear morning peak, so the morning commute gets only a small bump. The weekend
// night premium comes from the tracker data: its 14 weekend-night rides cost ~5% more than
// their city's fit predicts. (The tracker has only 8 rides in the 4-6 pm window, too few to
// overrule Obi's reports on the evening peak.)
export function getTimeMultiplier(departAt) {
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
    return { multiplier: 1.05, label: "Weekend night" };
  }
  if (hour >= 4 && hour < 7) {
    return { multiplier: 0.9, label: "Early morning" };
  }
  return { multiplier: 1.0, label: "Standard" };
}

const round2 = (n) => Math.round(n * 100) / 100;

// city is the service-area name from service-areas.json (e.g. "Phoenix"); unknown or
// missing cities use DEFAULT_RATES.
export function estimateFare(distanceMiles, durationMinutes, departAt, city) {
  const rates = ratesForCity(city);
  const { multiplier, label } = getTimeMultiplier(departAt);

  const distanceCost = rates.perMile * distanceMiles;
  const timeCost = rates.perMinute * durationMinutes;
  const subtotal = (rates.base + distanceCost + timeCost) * multiplier;
  const estimate = Math.max(FEES.minimumFare, subtotal + FEES.bookingFee);

  return {
    estimate: round2(estimate),
    low: round2(Math.max(FEES.minimumFare, estimate * (1 - FEES.rangeSpread))),
    high: round2(estimate * (1 + FEES.rangeSpread)),
    multiplier,
    timeLabel: label,
    breakdown: {
      base: rates.base,
      distance: round2(distanceCost),
      time: round2(timeCost),
      bookingFee: FEES.bookingFee,
    },
  };
}
