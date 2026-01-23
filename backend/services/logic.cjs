const turf = require("@turf/turf");
// takes in double long,lat, and polygon poly, returns if that point is in polygon
function isPointInBound(point, poly) {
    return (turf.booleanPointInPolygon(point, poly));
}
function getTwoPointDistance(coordArr1, coordArr2) {
    const point1 = turf.point(coordArr1);
    const point2 = turf.point(coordArr2);

    return turf.distance(point1, point2, { units: "miles" });
}
function getDistance(long, lat, poly) {
    var point = turf.point([long, lat]);
    return (turf.pointToPolygonDistance(point, poly))
}
function isPointInAnyBound(long, lat, coordArray) {
    var cur_poly = turf.polygon([coordArray[0]])
    var point = turf.point([long, lat]);
    console.log("Long: " + long)
    console.log("Lat: " + lat)
    for (let i = 0; i < coordArray.length; i++) {
        cur_poly = turf.polygon([coordArray[i]]);
        console.log("Running on " + i);
        if (isPointInBound(point, cur_poly)) {
            return true;
        }
    }
    return false;
}
function getDistanceToClosestPolygon(long, lat, coordArray){
    var point = turf.point([long, lat]);

    var min_poly = turf.polygon([coordArray[0]]);
    var min_dist = turf.pointToPolygonDistance(point, min_poly, {units: "miles"});



    for (let i = 0; i < coordArray.length; i++) {
        var cur_poly = turf.polygon([coordArray[i]]);
        var cur_dist = turf.pointToPolygonDistance(point, cur_poly, {units: "miles"});

        if (cur_dist < min_dist) {
            min_dist = cur_dist;
            min_poly = cur_poly;
        }

    }

    return [min_dist, min_poly];
}

function getClosestPolygonPoint(long, lat, coordArray) {
    var point = turf.point([long, lat]);
    var result = getDistanceToClosestPolygon(long, lat, coordArray);
    var dist = result[0];
    var poly = result[1];

    if (dist < 0) {
        return (-1, poly);
    }
    var line = turf.polygonToLine(poly);
    var out_point = turf.nearestPointOnLine(line, point, { units: "miles" });

    return [out_point, poly];

}
function getMidpoint(coordArr1, coordArr2) {
    const point1 = turf.point(coordArr1);
    const point2 = turf.point(coordArr2);

    return turf.midpoint(point1, point2);
}

module.exports = {isPointInBound, getDistance, isPointInAnyBound, getDistanceToClosestPolygon, getClosestPolygonPoint, getMidpoint, getTwoPointDistance};