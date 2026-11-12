// Writes the active service-area polygons from MongoDB to the frontend as static JSON, so the
// map can draw them without waiting for this backend to wake up.
// Run after adding or changing a service area:
//   cd backend && node scripts/export-service-areas.cjs
// then commit frontend/src/data/service-areas.json.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const mongoose = require("mongoose");
const ServiceArea = require("../models/ServiceArea.cjs");

const OUT = path.join(__dirname, "..", "..", "frontend", "src", "data", "service-areas.json");

async function main() {
    await mongoose.connect(process.env.MONGODB_CONNECTION_STRING);
    const areas = await ServiceArea.find({ is_active: true }).sort({ city: 1 }).lean();
    const serviceAreas = areas.map(({ city, state, coordinates, last_update }) => ({
        city, state, last_update, coordinates,
    }));
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ serviceAreas }) + "\n");
    console.log(`Wrote ${serviceAreas.length} service areas to ${path.relative(process.cwd(), OUT)}`);
    for (const a of serviceAreas) console.log(`  ${a.city}, ${a.state}: ${a.coordinates.length} points (updated ${a.last_update})`);
}

main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
