# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An interactive map of Waymo robotaxi service areas. A user searches for an address; the
app drops a marker, asks the backend whether the point is inside any service-area polygon,
and — if it is not — draws an animated dashed line to the nearest polygon edge with the
distance in miles.

Two independent packages, each with its own `package.json` and `.env` (both `.env` files
are gitignored and must be created locally):

- `frontend/` — Vite + React 19 single-page app (the whole UI lives in `src/App.jsx`).
- `backend/` — Express 5 + Mongoose API over a MongoDB collection of service-area polygons.

## Commands

### Frontend (`cd frontend`)
- `npm run dev` — Vite dev server (default http://localhost:5173)
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the built `dist/`
- `npm run lint` — ESLint (flat config in `eslint.config.js`)

### Backend (`cd backend`)
- `node index.cjs` — start the API on port **3001** (hardcoded in `index.cjs`; no start
  script, no watch/reload, no test runner)

There is no test suite anywhere in the repo.

## Environment variables

`frontend/.env`:
- `VITE_APP_MAPBOX_API_KEY` — Mapbox GL access token
- `VITE_APP_API_URL` — base URL of the backend (the frontend appends `/api/...`)

`backend/.env`:
- `MONGODB_CONNECTION_STRING` — Mongo connection URI

## Architecture notes

- **Backend module system:** `backend/package.json` declares `"type": "module"`, but every
  backend source file is CommonJS with a `.cjs` extension (`require`/`module.exports`). Keep
  new backend files `.cjs`.
- **Geospatial logic** lives in `backend/services/logic.cjs` and is a thin wrapper around
  `@turf/turf`. All coordinates are `[longitude, latitude]` order throughout the stack.
  Route handlers in `backend/routes/check.cjs` do the DB read, then delegate math to
  `logic.cjs`.
- **Data model:** `backend/models/ServiceArea.cjs` — `{ city, state, coordinates, last_update,
  is_active }`. `coordinates` is a single flat ring `[[lng, lat], ...]` (one polygon, no
  holes). Queries filter on `is_active: true`. Polygons are seeded via `POST /api/service-areas`;
  there is no seed script.
- **API surface** (all under `/api`, mounted in `index.cjs`):
  - `GET /service-areas` — active polygons (used on map load to draw fills/outlines)
  - `POST /check-point` `{ long, lat }` → `{ "point-found": bool }`
  - `POST /closest-point` `{ long, lat }` → `{ "closest-point": <turf point>, "closest-poly": <turf polygon> }`
  - `POST /midpoint` `{ coordArr1, coordArr2 }` → `{ midpoint, distance }` (miles)
  - `POST /check` — legacy/unused by the frontend
- **Frontend structure:** everything is in `src/App.jsx` — a single `App` component with one
  big `useEffect` that builds the Mapbox map, the `MapboxGeocoder`, service-area layers, and
  the geocoder `result` handler that orchestrates marker + in/out check + closest-point line.
  Mapbox objects (map, geocoder, current marker, current distance popup) are held in `useRef`
  and imperatively mutated; React state is not used for map interaction.
  UI chrome (title card, LA/SF/AZ fly-to buttons, geocoder container) is Headless UI
  components positioned as absolute overlays; layout/responsive rules are in `src/App.css`
  (`.overlap`, `.map-container`, `*-card` classes).
- The Mapbox style is a custom published style referenced by URL in `App.jsx`.
