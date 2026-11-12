# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An interactive map of Waymo robotaxi service areas. A user searches for an address; the
app drops a marker, checks whether the point is inside any service-area polygon, and — if
it is not — draws an animated dashed line to the nearest polygon edge with the distance in
miles. A route mode plans a pickup → dropoff trip and estimates the fare; users can report
what they actually paid.

Two independent packages, each with its own `package.json` and `.env` (both `.env` files
are gitignored and must be created locally):

- `frontend/` — Vite + React 19 single-page app on Vercel (`vercel.json` proxies `/api` and
  `/health` to the backend).
- `backend/` — Express 5 + Mongoose API on Render's free plan (sleeps when idle, 30-60s to
  wake). MongoDB holds the service-area polygons and user fare reports.

**The page must never wait on the backend.** Service areas are bundled into the frontend,
and all geometry and pricing run in the browser. The backend is only needed to store fare
reports, and the page pings `/health` on load to start waking it.

## Commands

### Frontend (`cd frontend`)
- `npm run dev` — Vite dev server (default http://localhost:5173)
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the built `dist/`
- `npm run lint` — ESLint (flat config in `eslint.config.js`)
- `python3 scripts/gen_og.py` — regenerate `public/og-image.png` (link-preview image) with
  headless Chrome. Its sample fare is hardcoded; re-price it if `pricing.js` rates change.

### Backend (`cd backend`)
- `node index.cjs` — start the API on port **3001** (hardcoded in `index.cjs`; no start
  script, no watch/reload, no test runner)
- `node scripts/export-service-areas.cjs` — write the active polygons from MongoDB to
  `frontend/src/data/service-areas.json`. **Run and commit after any service-area change**;
  the map draws from that file, not the API.

There is no test suite anywhere in the repo.

## Environment variables

`frontend/.env`:
- `VITE_APP_MAPBOX_API_KEY` — Mapbox GL access token
- `VITE_APP_API_URL` — base URL of the backend (the frontend appends `/api/...`)

`backend/.env`:
- `MONGODB_CONNECTION_STRING` — Mongo connection URI
- `ADMIN_KEY` — secret required as an `x-admin-key` header on `POST /api/service-areas`;
  if unset, that route refuses every request

## Architecture notes

- **Backend module system:** `backend/package.json` declares `"type": "module"`, but every
  backend source file is CommonJS with a `.cjs` extension (`require`/`module.exports`). Keep
  new backend files `.cjs`.
- **Geometry** runs in the browser in `frontend/src/geo.js`: point-in-area, nearest edge,
  snapping trip ends into an area, and route-inside checks. All coordinates are
  `[longitude, latitude]` order throughout the stack. `backend/services/logic.cjs` (turf)
  only tags fare reports with their pickup city.
- **Pricing** lives only in `frontend/src/pricing.js` (rates + time-of-day multipliers).
  Tune rates there. Fare reports send the estimate the browser computed; the backend stores it
  as-is and has no pricing logic.
- **Data model:** `backend/models/ServiceArea.cjs` — `{ city, state, coordinates, last_update,
  is_active }`. `coordinates` is a single flat ring `[[lng, lat], ...]` (one polygon, no
  holes). Queries filter on `is_active: true`. Polygons are seeded via `POST /api/service-areas`.
  `backend/models/FareReport.cjs` — a user-reported fare plus the trip and the model's
  estimate; collected only, nothing reads it yet.
- **API surface** (all under `/api`, mounted in `index.cjs`):
  - `POST /fare-reports` — the only endpoint the frontend calls (rate-limited per IP)
  - `GET`/`POST /service-areas` — read/seed polygons (the frontend uses the exported JSON instead)
- **Frontend structure:** most of the UI is in `src/App.jsx` — a single `App` component with
  one big `useEffect` that builds the Mapbox map, the `MapboxGeocoder`s, service-area layers,
  and the geocoder `result` handler that orchestrates marker + in/out check + closest-point
  line. `src/FareReport.jsx` is the "what did you pay?" form; `src/backend.js` holds the
  backend URL and wake-up helpers.
  Mapbox objects (map, geocoder, current marker, current distance popup) are held in `useRef`
  and imperatively mutated; React state is not used for map interaction.
  UI chrome (title card, LA/SF/AZ fly-to buttons, geocoder container) is Headless UI
  components positioned as absolute overlays; layout/responsive rules are in `src/App.css`
  (`.overlap`, `.map-container`, `*-card` classes).
- The Mapbox style is a custom published style referenced by URL in `App.jsx`.
