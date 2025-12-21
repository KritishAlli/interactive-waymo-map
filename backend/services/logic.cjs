const turf = require("@turf/turf");
// takes in double long,lat, and polygon poly, returns if that point is in polygon
function isPointInBound(long,lat, poly) {
    var point = turf.point([long, lat]);
    return (turf.booleanPointInPolygon(point, poly));
}
module.exports = {isPointInBound};