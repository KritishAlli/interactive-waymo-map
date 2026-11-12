// Fare estimation for a Waymo trip. This is the only copy of the pricing logic: it runs in
// the browser so estimates never wait on the (free-tier, slow to wake) backend, and fare
// reports send its estimate to the backend to be stored next to what the user paid.
//
// Waymo does not publish its pricing formula. Per-city rates are least-squares fits
// (coefficients constrained >= 0) to the crowdsourced rides behind the Waymo Price Tracker
// (https://waymo-pricing.streamlit.app, data: github.com/EwoutH/Waymo-pricing), using the
// tracker's outlier filters: 113 rides, mostly 2024, as of Nov 2026. Tune rates here.
//
// There is no base fare: a trip is (distance + time) x the time-of-day multiplier + the
// booking fee, at least the minimum fare. Rates are fitted to that exact model, with each
// ride's multiplier applied. Night rides (16) are left out of the fit, since night pricing
// is a product choice rather than fitted (see getTimeMultiplier).
//
// Prices differ a lot by city: Phoenix rides average ~$17 against ~$25 in SF and LA, so
// one formula for all cities was off by several dollars. Phoenix fares barely grow with
// distance, which a model with no base fare can't capture well (R² ~0): expect short
// Phoenix trips to be underestimated and long ones overestimated. Re-fit when more rides
// are reported.
export const CITY_RATES = {
  //                    $/mile  $/minute        fit: n, R²
  "San Francisco Bay": { perMile: 1.52, perMinute: 0.56 }, // n=40, R² 0.50
  "Los Angeles":       { perMile: 2.17, perMinute: 0.28 }, // n=23, R² 0.74
  "Phoenix":           { perMile: 1.28, perMinute: 0.30 }, // n=34, R² -0.02
};

// Cities with no ride data yet (Dallas, San Diego, new areas): the average of the three
// fitted cities. A guess until rides from those cities are reported.
export const DEFAULT_RATES = { perMile: 1.66, perMinute: 0.38 };

export const FEES = {
  bookingFee: 2.50,    // flat fee added after the time-of-day multiplier ($)
  minimumFare: 6.50,   // no trip costs less than this ($)
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
// show no clear morning peak, so the morning commute gets only a small bump. (The tracker
// has only 8 rides in the 4-6 pm window, too few to overrule Obi's reports on the evening
// peak.)
//
// Night (10 pm-5 am, every day) is priced at half: a deliberate product choice, not fitted
// to data. The tracker's rides in those hours cost about as much as daytime ones.
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
  if (hour >= 22 || hour < 5) {
    return { multiplier: 0.5, label: "Night" };
  }
  if (hour >= 5 && hour < 7) {
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

  // The time-of-day multiplier scales distance and time; the booking fee is flat. The
  // breakdown shows the scaled amounts, plus a minimum-fare top-up when one applies, so
  // its lines always add up to the estimate.
  const distanceCost = round2(rates.perMile * distanceMiles * multiplier);
  const timeCost = round2(rates.perMinute * durationMinutes * multiplier);
  const fare = round2(distanceCost + timeCost + FEES.bookingFee);
  const estimate = Math.max(FEES.minimumFare, fare);

  return {
    estimate,
    low: round2(Math.max(FEES.minimumFare, estimate * (1 - FEES.rangeSpread))),
    high: round2(estimate * (1 + FEES.rangeSpread)),
    multiplier,
    timeLabel: label,
    breakdown: {
      distance: distanceCost,
      time: timeCost,
      bookingFee: FEES.bookingFee,
      minimumFareTopUp: round2(estimate - fare), // 0 unless the minimum fare applies
    },
  };
}
