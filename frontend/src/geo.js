// Client-side geometry for route estimation: snapping pickup/dropoff into a service area
// and checking whether a driving route stays inside the service areas.
//
// Runs in the browser against the polygons already loaded for the map, so the retry loop
// never waits on the (slow, free-tier) backend. Uses a local flat projection per polygon
// (longitude scaled by cos(latitude)), which is accurate to well under 1% at city scale.
// Coordinates are [lng, lat] throughout.

const MILES_PER_DEG_LAT = 69.055;
export const MAX_SNAP_MILES = 5;          // further than this from any area -> refuse the trip
const SNAP_INSET_MILES = 0.03;            // put snapped stops ~50m inside the boundary
const ROUTE_TOLERANCE_MILES = 0.1;        // route points this close to an area count as inside
const EXCLUDES_PER_RUN = 4;               // exclude points suggested per stretch outside the area

// Precompute per-polygon data once: ring, bbox, and projection scale.
export function prepareAreas(serviceAreas) {
  return serviceAreas.map((area) => {
    const ring = area.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const cosLat = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
    return { city: area.city, ring, bbox: [minX, minY, maxX, maxY], cosLat };
  });
}

// ray casting point-in-polygon
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inBbox([x, y], [minX, minY, maxX, maxY], padLng = 0, padLat = 0) {
  return x >= minX - padLng && x <= maxX + padLng && y >= minY - padLat && y <= maxY + padLat;
}

export function isInArea(coord, area) {
  return inBbox(coord, area.bbox) && inRing(coord, area.ring);
}

// nearest point on the polygon boundary: { miles, point: [lng, lat] }
function nearestOnBoundary(coord, area) {
  const kx = MILES_PER_DEG_LAT * area.cosLat;
  const ky = MILES_PER_DEG_LAT;
  const px = coord[0] * kx, py = coord[1] * ky;
  let best = { d2: Infinity, point: null };
  const ring = area.ring;
  for (let i = 0; i < ring.length - 1; i++) {
    const ax = ring[i][0] * kx, ay = ring[i][1] * ky;
    const bx = ring[i + 1][0] * kx, by = ring[i + 1][1] * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const cx = ax + t * dx, cy = ay + t * dy;
    const d2 = (px - cx) ** 2 + (py - cy) ** 2;
    if (d2 < best.d2) best = { d2, point: [cx / kx, cy / ky] };
  }
  return { miles: Math.sqrt(best.d2), point: best.point };
}

function milesBetween(a, b, cosLat) {
  const dx = (b[0] - a[0]) * MILES_PER_DEG_LAT * cosLat;
  const dy = (b[1] - a[1]) * MILES_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

// great-circle distance in miles; used where the two points can be far apart
export function haversineMiles([lng1, lat1], [lng2, lat2]) {
  const R = 3958.8;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function isInAnyArea(coord, areas) {
  return areas.some((area) => isInArea(coord, area));
}

// Single-address search: the closest point on any service-area edge, with no distance cap
// (the address can be in another state). { point: [lng, lat], miles }
export function nearestAreaEdge(coord, areas) {
  let best = null;
  for (const area of areas) {
    const near = nearestOnBoundary(coord, area);
    const miles = haversineMiles(coord, near.point);
    if (!best || miles < best.miles) best = { point: near.point, miles };
  }
  return best;
}

// Where would the Waymo actually stop for this address?
// { original, point, inArea, gapMiles, areaIndex, tooFar? }
export function snapEndpoint(coord, areas) {
  let best = null;
  for (let i = 0; i < areas.length; i++) {
    if (isInArea(coord, areas[i])) {
      return { original: coord, point: coord, inArea: true, gapMiles: 0, areaIndex: i };
    }
    const near = nearestOnBoundary(coord, areas[i]);
    if (!best || near.miles < best.miles) best = { ...near, areaIndex: i };
  }
  if (!best) return null;
  if (best.miles > MAX_SNAP_MILES) {
    return { original: coord, inArea: false, gapMiles: best.miles, areaIndex: best.areaIndex, tooFar: true };
  }

  // continue past the edge, away from the address, so the stop is just inside the area
  const area = areas[best.areaIndex];
  const edge = best.point;
  let point = edge;
  if (best.miles > 0) {
    const f = SNAP_INSET_MILES / best.miles;
    const inset = [edge[0] + (edge[0] - coord[0]) * f, edge[1] + (edge[1] - coord[1]) * f];
    if (isInArea(inset, area)) point = inset;
  }
  return {
    original: coord,
    point,
    inArea: false,
    gapMiles: milesBetween(coord, point, area.cosLat),
    areaIndex: best.areaIndex,
  };
}

export function snapTrip(pickup, dropoff, areas) {
  const p = snapEndpoint(pickup, areas);
  const d = snapEndpoint(dropoff, areas);
  if (!p || !d) return { error: "Service areas haven't loaded yet. Try again in a moment." };

  let error = null;
  if (p.tooFar || d.tooFar) {
    const which = p.tooFar && d.tooFar ? "Pickup and dropoff are" : p.tooFar ? "Pickup is" : "Dropoff is";
    error = `${which} more than ${MAX_SNAP_MILES} miles from a Waymo service area.`;
  } else if (p.areaIndex !== d.areaIndex) {
    error = `Pickup (${areas[p.areaIndex].city}) and dropoff (${areas[d.areaIndex].city}) are in different service areas.`;
  }
  return { error, city: areas[p.areaIndex].city, pickup: p, dropoff: d };
}

function isInsideAny(coord, areas) {
  for (const area of areas) {
    if (isInArea(coord, area)) return true;
  }
  // allow small slop for road snapping near the boundary
  const padLat = ROUTE_TOLERANCE_MILES / MILES_PER_DEG_LAT;
  for (const area of areas) {
    const padLng = padLat / area.cosLat;
    if (inBbox(coord, area.bbox, padLng, padLat) && nearestOnBoundary(coord, area).miles <= ROUTE_TOLERANCE_MILES) {
      return true;
    }
  }
  return false;
}

// For a route line: is it fully inside, what fraction is inside, and points spread along
// each stretch that leaves the area (for Mapbox `exclude=point(...)`).
export function checkRoute(coords, areas) {
  const inside = coords.map((c) => isInsideAny(c, areas));
  const insideCount = inside.filter(Boolean).length;

  const excludePoints = [];
  let runStart = -1;
  for (let i = 0; i <= coords.length; i++) {
    const out = i < coords.length && !inside[i];
    if (out && runStart === -1) runStart = i;
    if (!out && runStart !== -1) {
      const runLen = i - runStart;
      const samples = Math.min(EXCLUDES_PER_RUN, runLen);
      for (let k = 0; k < samples; k++) {
        excludePoints.push(coords[runStart + Math.floor(((k + 0.5) * runLen) / samples)]);
      }
      runStart = -1;
    }
  }
  return {
    inside: insideCount === coords.length,
    fractionInside: coords.length ? insideCount / coords.length : 0,
    excludePoints,
  };
}

// Area of a single ring in square miles (shoelace on the same flat projection as above).
export function areaSqMiles(ring) {
  const lat0 = ring.reduce((s, [, y]) => s + y, 0) / ring.length;
  const kx = MILES_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j][0] * kx * ring[i][1] * MILES_PER_DEG_LAT - ring[i][0] * kx * ring[j][1] * MILES_PER_DEG_LAT;
  }
  return Math.abs(twice) / 2;
}
