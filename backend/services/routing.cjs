// Geometry for route estimation mode: snapping pickup/dropoff into a service area and
// checking whether a driving route stays inside the service areas.
const turf = require("@turf/turf");

const MAX_SNAP_MILES = 5;       // further than this from any area -> refuse the trip
const SNAP_INSET_MILES = 0.03;  // push snapped points ~50m inside the boundary
const ROUTE_TOLERANCE_MILES = 0.1; // route points this close to an area count as inside (road snapping slop)
const EXCLUDES_PER_RUN = 4;     // exclude points suggested per stretch of route outside the area

const toPolygons = (coordArray) => coordArray.map((ring) => turf.polygon([ring]));

// signed distance in miles to a polygon (negative = inside)
const signedDistance = (pt, poly) => turf.pointToPolygonDistance(pt, poly, { units: "miles" });

function closestArea(coord, polys) {
    const pt = turf.point(coord);
    let best = { index: -1, dist: Infinity };
    polys.forEach((poly, index) => {
        const dist = signedDistance(pt, poly);
        if (dist < best.dist) best = { index, dist };
    });
    return best;
}

// Returns where the Waymo would actually stop for this address.
function snapEndpoint(coord, polys) {
    const { index, dist } = closestArea(coord, polys);
    if (index === -1) return { error: "No service areas available" };
    if (dist <= 0) {
        return { original: coord, point: coord, inArea: true, gapMiles: 0, areaIndex: index };
    }
    if (dist > MAX_SNAP_MILES) {
        return { original: coord, inArea: false, gapMiles: dist, areaIndex: index, tooFar: true };
    }

    const pt = turf.point(coord);
    const edge = turf.nearestPointOnLine(turf.polygonToLine(polys[index]), pt, { units: "miles" });
    // continue past the edge in the same direction so the stop is just inside the area
    const bearing = turf.bearing(pt, edge);
    const inset = turf.destination(edge, SNAP_INSET_MILES, bearing, { units: "miles" });
    const point = turf.booleanPointInPolygon(inset, polys[index])
        ? inset.geometry.coordinates
        : edge.geometry.coordinates;

    return {
        original: coord,
        point,
        inArea: false,
        gapMiles: turf.distance(pt, turf.point(point), { units: "miles" }),
        areaIndex: index,
    };
}

function isInsideAny(coord, polys) {
    const pt = turf.point(coord);
    if (polys.some((poly) => turf.booleanPointInPolygon(pt, poly))) return true;
    return polys.some((poly) => signedDistance(pt, poly) <= ROUTE_TOLERANCE_MILES);
}

// For a route line [[lng,lat],...]: is it fully inside, what fraction is inside, and one
// representative point per stretch that leaves the area (for Mapbox `exclude=point(...)`).
function checkRoute(coords, polys) {
    const inside = coords.map((c) => isInsideAny(c, polys));
    const insideCount = inside.filter(Boolean).length;

    const excludePoints = [];
    let runStart = -1;
    for (let i = 0; i <= coords.length; i++) {
        const out = i < coords.length && !inside[i];
        if (out && runStart === -1) runStart = i;
        if (!out && runStart !== -1) {
            // spread a few points along the stretch so Mapbox avoids the whole detour,
            // not just one spot on it
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

module.exports = { toPolygons, snapEndpoint, checkRoute, MAX_SNAP_MILES };
