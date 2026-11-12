const turf = require("@turf/turf");

// Is [long, lat] inside any of the polygons? coordArray is a list of rings ([[lng, lat], ...]).
// The frontend does its own geometry (frontend/src/geo.js); this is only used to tag fare
// reports with the city of their pickup.
function isPointInAnyBound(long, lat, coordArray) {
    const point = turf.point([long, lat]);
    return coordArray.some((ring) => turf.booleanPointInPolygon(point, turf.polygon([ring])));
}

module.exports = { isPointInAnyBound };
