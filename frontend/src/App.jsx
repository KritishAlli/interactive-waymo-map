import { useRef,useEffect, useState } from 'react'
import mapboxgl, { Marker } from "mapbox-gl";
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';

import './App.css'
import DateTimePicker from './DateTimePicker.jsx'
import { prepareAreas, snapTrip, checkRoute, areaSqMiles, isInAnyArea, nearestAreaEdge } from './geo.js'
import { estimateFare } from './pricing.js'
import { warmBackend } from './backend.js'
import { useTheme, isDark } from './theme.js'
// exported from MongoDB by backend/scripts/export-service-areas.cjs; bundled so the map
// never waits on the backend
import serviceAreasData from './data/service-areas.json'
import LocateControl, { getPosition, locationErrorMessage } from './locate.js'
import { tween, tweenPaint, drawLine, startRouteCar, pulseMarker, dropIn, pointAlongLine } from './animations.js'
import AnimatedNumber from './AnimatedNumber.jsx'
import FareReport from './FareReport.jsx'
import About from './About.jsx'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { MapPinIcon } from '@heroicons/react/24/outline'

// `name` must match the `city` field of the service area in the database
const CITIES = [
  { name: 'Los Angeles',       short: 'LA',        state: 'CA', center: [-118.25, 34.05],   zoom: 10 },
  { name: 'San Francisco Bay', short: 'SF Bay',    state: 'CA', center: [-122.25, 37.67],   zoom: 9 },
  { name: 'Phoenix',           short: 'Phoenix',   state: 'AZ', center: [-112.074, 33.4484], zoom: 10 },
  { name: 'San Diego',         short: 'San Diego', state: 'CA', center: [-117.19, 32.79],   zoom: 10.5 },
  { name: 'Dallas',            short: 'Dallas',    state: 'TX', center: [-96.80, 32.81],    zoom: 10.5 },
];

// Waymo-app style: dim everything outside the service areas, white outline around them
const STATE_NAMES = { AZ: 'Arizona', CA: 'California', TX: 'Texas' };

const AREA_STYLE = {
  maskColor: '#0e1621', maskOpacity: 0.16,
  fillOpacity: 0, fillOpacityHover: 0.08,
  lineWidth: 3, lineWidthHover: 3.5,
};

const CURRENT_LOCATION_LABEL = "Current location";

// Mapbox paints in JS, so it can't read CSS variables; keep these in sync with index.css.
// Read through mapColors() so new layers and pins pick up the current theme.
const MAP_COLORS = {
  light: {
    accent: '#007d6e',       // --accent
    accentBright: '#00c2a8', // --accent-bright
    ink: '#0e1621',          // --text
    muted: '#5b6472',        // --text-secondary
    route: '#007d6e',        // --accent
    routeCasing: '#ffffff',
    pickup: '#0e1621',       // --text
    dropoff: '#007d6e',      // --accent
    areaLine: '#ffffff',     // service-area outlines
    areaLineHover: '#00c2a8',
  },
  // night basemap: teal instead of white for outlines, casing and the search pin
  dark: {
    accent: '#007d6e',
    accentBright: '#00c2a8',
    ink: '#00a08c',
    muted: '#4f9a90',
    route: '#00c2a8',
    routeCasing: '#0a2e2a',  // dark teal halo instead of white
    pickup: '#0e1621',       // same pins as light: dark pickup, teal dropoff
    dropoff: '#007d6e',
    areaLine: '#00a08c',
    areaLineHover: '#5eead4',
  },
};
const mapColors = () => MAP_COLORS[isDark() ? 'dark' : 'light'];
const lightPreset = () => (isDark() ? 'night' : 'day');

function ThemeIcon({ dark }) {
  return dark ? (
    // sun: switch to light
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ) : (
    // moon: switch to dark
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function LocationArrowIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 3 3 10.5l7.5 3L13.5 21 21 3z" />
    </svg>
  );
}
const API_KEY = import.meta.env.VITE_APP_MAPBOX_API_KEY;

const SERVICE_AREAS = serviceAreasData.serviceAreas;
const AREAS = prepareAreas(SERVICE_AREAS); // prepared for client-side geometry (geo.js)
const AREA_SIZES = Object.fromEntries(SERVICE_AREAS.map((a) => [a.city, areaSqMiles(a.coordinates)])); // sq mi

// format a Date as the "YYYY-MM-DDTHH:mm" value a datetime-local input expects
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const isNarrowScreen = () => window.matchMedia('(max-width: 768px)').matches;

// search pin: drop-in delay, and when it hits the ground (55% of the 0.6s pin-drop in App.css)
const PIN_DROP_DELAY_MS = 350;
const PIN_LANDS_MS = PIN_DROP_DELAY_MS + 330;


function App() {

  const [theme, toggleTheme] = useTheme();
  const [mapReady, setMapReady] = useState(false); // map style loaded and service areas drawn
  const [slowLoad, setSlowLoad] = useState(false); // map is taking unusually long to load
  const [locationMessage, setLocationMessage] = useState(null); // locate-button errors


  const mapRef = useRef()
  const mapContainerRef = useRef()
  const geocoderRef = useRef()
  const geocoderContainerRef = useRef()
  const currentMarkerRef = useRef();
  const currentDistancePopupRef = useRef();
  const dashAnimationRef = useRef();
  const currentPulseRef = useRef();
  const routeAnimCancelsRef = useRef([]); // cancel fns for the route draw + car loop
  const routeDrawnRef = useRef(null); // { coords, drawEndsAt } of the route on the map
  const [loadingGone, setLoadingGone] = useState(false); // loading screen finished fading out

  // route price estimation mode
  const [mode, setMode] = useState("route"); // "search" | "route"
  const [pickup, setPickup] = useState(null);   // [lng, lat]
  const [dropoff, setDropoff] = useState(null); // [lng, lat]
  const [departAt, setDepartAt] = useState(() => toLocalInputValue(new Date()));
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState("");
  const [estimating, setEstimating] = useState(false);
  const pickupContainerRef = useRef();
  const dropoffContainerRef = useRef();
  const pickupGeocoderRef = useRef();
  const dropoffGeocoderRef = useRef();
  const routeMarkersRef = useRef([]);
  const [pickupLabel, setPickupLabel] = useState("");
  const [dropoffLabel, setDropoffLabel] = useState("");
  const [locatingFor, setLocatingFor] = useState(null); // "pickup" | "dropoff" | null

  // fill the pickup or dropoff box with the device's location
  async function pickCurrentLocation(which) {
    setLocatingFor(which);
    setLocationMessage(null);
    try {
      const pos = await getPosition();
      const coords = [pos.coords.longitude, pos.coords.latitude];
      const geocoder = which === "pickup" ? pickupGeocoderRef.current : dropoffGeocoderRef.current;
      geocoder?.setInput(CURRENT_LOCATION_LABEL); // sets the text without searching
      geocoder?._showClearButton?.(); // private API; the (x) only shows after typed searches otherwise
      if (which === "pickup") { setPickup(coords); setPickupLabel(CURRENT_LOCATION_LABEL); }
      else { setDropoff(coords); setDropoffLabel(CURRENT_LOCATION_LABEL); }
      setEstimate(null);
      document.activeElement?.blur?.();
    } catch (err) {
      setLocationMessage(locationErrorMessage(err));
    } finally {
      setLocatingFor(null);
    }
  }

  function currentLocationButton(which) {
    return (
      <button
        type="button"
        className="current-location-btn"
        aria-label={`Use current location as ${which}`}
        title="Use current location"
        disabled={locatingFor !== null}
        onClick={() => pickCurrentLocation(which)}
      >
        {locatingFor === which ? <span className="mini-spinner" /> : <LocationArrowIcon />}
      </button>
    );
  }

  // mobile: the search card is a bottom sheet; swipe up to expand it, down to tuck it away
  const [sheetOpen, setSheetOpen] = useState(true);
  const sheetRef = useRef();
  const sheetDragRef = useRef(null);

  function onSheetTouchStart(e) {
    if (!isNarrowScreen()) return;
    const el = sheetRef.current;
    const onGrabber = e.target.closest('.sheet-grabber, .sheet-summary');
    // leave text fields, suggestion lists and the clock dial alone; when the sheet
    // scrolls, only the grabber drags it so scrolling still works
    if (!onGrabber) {
      if (e.target.closest('input, textarea, .suggestions, .dtp-face')) return;
      if (el.scrollHeight > el.clientHeight + 1) return;
    }
    const t = e.touches[0];
    sheetDragRef.current = { x: t.clientX, y: t.clientY, dy: 0, active: false };
  }

  function onSheetTouchMove(e) {
    const d = sheetDragRef.current;
    if (!d) return;
    const t = e.touches[0];
    const dx = t.clientX - d.x;
    const dy = t.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) { sheetDragRef.current = null; return; }
      d.active = true;
      sheetRef.current.style.transition = 'none';
    }
    d.dy = dy;
    // follow the finger toward the next state, resist the other way
    const el = sheetRef.current;
    const offset = sheetOpen
      ? (dy > 0 ? Math.min(dy, el.offsetHeight * 0.6) : dy * 0.15)
      : (dy < 0 ? Math.max(dy * 0.4, -60) : dy * 0.15);
    el.style.transform = `translateY(${offset}px)`;
  }

  function onSheetTouchEnd() {
    const d = sheetDragRef.current;
    sheetDragRef.current = null;
    if (!d?.active) return;
    const el = sheetRef.current;
    el.style.transition = '';
    el.style.transform = '';
    if (sheetOpen && d.dy > 40) {
      document.activeElement?.blur?.(); // drop the keyboard with the sheet
      setSheetOpen(false);
    } else if (!sheetOpen && d.dy < -30) {
      setSheetOpen(true);
    }
  }

  // desktop: the side panel covers the left of the map, so shift camera targets right
  // by half its width (plus the gap) to center them in the visible part
  function panelInset() {
    if (isNarrowScreen() || !sheetRef.current) return 0;
    return sheetRef.current.offsetLeft + sheetRef.current.offsetWidth;
  }

  function setAreaHighlight(city, on) {
    const map = mapRef.current;
    if (!map?.getLayer('fill-' + city)) return;
    if (on && routeDrawnRef.current) return; // no teal hover wash while a route is on the map
    map.setPaintProperty('fill-' + city, 'fill-opacity', on ? AREA_STYLE.fillOpacityHover : AREA_STYLE.fillOpacity);
    map.setPaintProperty('outline-' + city, 'line-width', on ? AREA_STYLE.lineWidthHover : AREA_STYLE.lineWidth);
    map.setPaintProperty('outline-' + city, 'line-color', on ? mapColors().areaLineHover : mapColors().areaLine);
  }

  function stopDashAnimation() {
    if (dashAnimationRef.current) cancelAnimationFrame(dashAnimationRef.current);
    dashAnimationRef.current = null;
  }

  // remove the single-address search marker, distance pill and dashed line
  function clearSearchOverlays() {
    stopDashAnimation();
    currentMarkerRef.current?.remove();
    currentMarkerRef.current = null;
    currentDistancePopupRef.current?.remove();
    currentDistancePopupRef.current = null;
    currentPulseRef.current?.remove();
    currentPulseRef.current = null;
    const map = mapRef.current;
    if (map?.getLayer('line-dashed')) map.removeLayer('line-dashed');
    if (map?.getSource('closest-point-route')) map.removeSource('closest-point-route');
  }

  function clearRoute() {
    routeAnimCancelsRef.current.forEach((cancel) => cancel());
    routeAnimCancelsRef.current = [];
    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];
    routeDrawnRef.current = null;
    const map = mapRef.current;
    for (const id of ['route-line', 'route-casing', 'route-gaps-line']) {
      if (map?.getLayer(id)) map.removeLayer(id);
    }
    for (const id of ['route', 'route-gaps']) {
      if (map?.getSource(id)) map.removeSource(id);
    }
  }

  function switchMode(next) {
    if (next === mode) return;
    if (next === "route") {
      clearSearchOverlays();
      geocoderRef.current?.clear();
    } else {
      clearRoute();
      setEstimate(null);
      setEstimateError("");
    }
    setMode(next);
  }

  // Mapbox Directions with alternatives; `excludes` are points the route must avoid.
  // depart_at only applies to future times, so retry without it on failure.
  async function fetchRoutes(from, to, when, excludes = []) {
    const fmt = (c) => c.map((n) => n.toFixed(6));
    let url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fmt(from).join(',')};${fmt(to).join(',')}` +
      `?geometries=geojson&overview=full&alternatives=true&access_token=${API_KEY}`;
    if (excludes.length) {
      url += `&exclude=${excludes.map((c) => `point(${fmt(c).join('%20')})`).join(',')}`;
    }
    const isFuture = when && new Date(when).getTime() > Date.now();
    if (isFuture) {
      const res = await fetch(`${url}&depart_at=${encodeURIComponent(when)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.routes?.length) return data.routes;
      }
    }
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.routes?.length) throw new Error(data.message || "No driving route found");
    return data.routes;
  }

  // Find the fastest route that stays inside the service area. If none of Mapbox's
  // alternatives do, tell it to avoid the spots where the best one leaves and ask again.
  async function findInAreaRoute(from, to, when, areas) {
    const MAX_ATTEMPTS = 6;
    const MAX_EXCLUDES = 50; // Mapbox limit
    let excludes = [];
    let best = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let routes;
      try {
        routes = await fetchRoutes(from, to, when, excludes);
      } catch (err) {
        if (!best) throw err;
        break; // excludes made the trip unroutable; fall back to the best so far
      }
      // checked in the browser: a few ms, vs. seconds round-tripping to the free-tier backend
      const candidates = routes.map((route) => ({ route, ...checkRoute(route.geometry.coordinates, areas) }));

      const inside = candidates.filter((c) => c.inside).sort((x, y) => x.route.duration - y.route.duration);
      if (inside.length) return { route: inside[0].route, staysInside: true };

      const roundBest = candidates.reduce((x, y) => (y.fractionInside > x.fractionInside ? y : x));
      if (!best || roundBest.fractionInside > best.fractionInside) best = roundBest;

      const next = roundBest.excludePoints.filter(
        (p) => !excludes.some((e) => e[0] === p[0] && e[1] === p[1])
      );
      if (!next.length || excludes.length >= MAX_EXCLUDES) break;
      excludes = [...excludes, ...next].slice(0, MAX_EXCLUDES);
    }
    return { route: best.route, staysInside: false };
  }

  // `delay` (ms) staggers the CSS pop-in so map labels appear as the line reaches them
  function distancePill(miles, delay = 0) {
    const el = document.createElement("div");
    el.className = "distance-pill";
    el.textContent = `${miles.toFixed(2)} mi`;
    el.style.setProperty('--anim-delay', `${delay}ms`);
    return el;
  }

  function stopDot(delay = 0) {
    const el = document.createElement("div");
    el.className = "stop-dot";
    el.style.setProperty('--anim-delay', `${delay}ms`);
    return el;
  }

  // route line + address pins; for addresses outside the area, a dashed line and
  // distance pill from the address to where the Waymo actually stops
  function drawRoute(route, ends) {
    const map = mapRef.current;
    clearRoute();
    map.addSource('route', {
      type: 'geojson',
      lineMetrics: true, // needed for line-trim-offset (the draw-on animation)
      data: { type: 'Feature', properties: {}, geometry: route.geometry },
    });
    // casing under the line keeps it readable over the shaded service areas;
    // both start fully trimmed and are drawn on from pickup to dropoff
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': mapColors().routeCasing, 'line-width': 9, 'line-emissive-strength': 1, 'line-trim-offset': [0, 1] },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': mapColors().route, 'line-width': 5, 'line-emissive-strength': 1, 'line-trim-offset': [0, 1] },
    });
    const DRAW_MS = 1400;
    const coords = route.geometry.coordinates;
    routeDrawnRef.current = { coords, drawEndsAt: performance.now() + 250 + DRAW_MS };
    CITIES.forEach((c) => setAreaHighlight(c.name, false)); // drop a highlight the cursor left on
    routeAnimCancelsRef.current.push(
      drawLine(map, ['route-casing', 'route-line'], DRAW_MS, {
        delay: 250,
        onDone: () => routeAnimCancelsRef.current.push(startRouteCar(map, coords)),
      })
    );

    const gaps = [ends.pickup, ends.dropoff].filter((e) => !e.inArea);
    map.addSource('route-gaps', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: gaps.map((e) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [e.original, e.point] },
        })),
      },
    });
    map.addLayer({
      id: 'route-gaps-line',
      type: 'line',
      source: 'route-gaps',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': mapColors().muted, 'line-width': 4, 'line-dasharray': [0.5, 2], 'line-emissive-strength': 1 },
    });

    // pickup pin drops first, dropoff lands as the line arrives
    const markers = [
      dropIn(new mapboxgl.Marker({ color: mapColors().pickup }).setLngLat(ends.pickup.original), 0).addTo(map),
      dropIn(new mapboxgl.Marker({ color: mapColors().dropoff }).setLngLat(ends.dropoff.original), 250 + DRAW_MS - 150).addTo(map),
    ];
    for (const e of gaps) {
      const mid = [(e.original[0] + e.point[0]) / 2, (e.original[1] + e.point[1]) / 2];
      const delay = e === ends.pickup ? 200 : 250 + DRAW_MS;
      markers.push(new mapboxgl.Marker({ element: stopDot(delay) }).setLngLat(e.point).addTo(map));
      markers.push(new mapboxgl.Marker({ element: distancePill(e.gapMiles, delay + 120), anchor: 'center' }).setLngLat(mid).addTo(map));
    }
    routeMarkersRef.current = markers;

    const bounds = new mapboxgl.LngLatBounds(ends.pickup.original, ends.pickup.original);
    route.geometry.coordinates.forEach((c) => bounds.extend(c));
    bounds.extend(ends.dropoff.original);
    const isNarrow = isNarrowScreen();
    map.fitBounds(bounds, {
      // on mobile the sheet collapses to a one-line summary once the route is drawn
      padding: isNarrow
        ? { top: 80, bottom: 150, left: 40, right: 40 }
        : { top: 80, bottom: 80, left: panelInset() + 60, right: 80 },
      maxZoom: 15,
    });
  }

  async function estimateRoute() {
    if (!pickup || !dropoff) return;
    setEstimating(true);
    setEstimateError("");
    setEstimate(null);
    clearRoute();
    try {
      const ends = snapTrip(pickup, dropoff, AREAS);
      if (ends.error) throw new Error(ends.error);

      const { route, staysInside } = await findInAreaRoute(ends.pickup.point, ends.dropoff.point, departAt, AREAS);
      if (isNarrowScreen()) setSheetOpen(false); // show the route; price stays in the summary
      drawRoute(route, ends);

      const distanceMiles = route.distance / 1609.344;
      const durationMinutes = route.duration / 60;
      setEstimate({
        ...estimateFare(distanceMiles, durationMinutes, departAt),
        distanceMiles,
        durationMinutes,
        ends,
        staysInside,
      });
    } catch (err) {
      setEstimateError(err.message || "Something went wrong");
    } finally {
      setEstimating(false);
    }
  }

  function placeMarker(e) {
    if (currentMarkerRef.current) {
      currentMarkerRef.current.remove();
    }
    var marker = dropIn(new mapboxgl.Marker({ color: mapColors().ink }).
        setLngLat(e.result.center), PIN_DROP_DELAY_MS) // land after the camera starts flying
        marker._element.id = "selection";
        marker.addTo(mapRef.current);
      currentMarkerRef.current = marker;

  }
  // distance pill halfway along the dashed line
  function placeMidpointDistancePopup(from, to, miles) {
    currentDistancePopupRef.current?.remove();
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    currentDistancePopupRef.current = new mapboxgl.Marker({ element: distancePill(miles), anchor: "center" })
      .setLngLat(mid)
      .addTo(mapRef.current);
  }
  // dashed line from an address outside every service area to the nearest area edge
  function getClosestPointLine(long, lat) {
    const nearest = nearestAreaEdge([long, lat], AREAS);
    if (!nearest) return;
    if (mapRef.current.getSource('closest-point-route')) {
      mapRef.current.removeLayer('line-dashed');
      mapRef.current.removeSource('closest-point-route');
    }
    mapRef.current.addSource('closest-point-route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [long, lat],
            nearest.point
          ]
        }
      }
    });
    placeMidpointDistancePopup([long, lat], nearest.point, nearest.miles);
    


    mapRef.current.addLayer({
      type: 'line',
      source: 'closest-point-route',
      id: 'line-dashed',
      paint: {
        'line-color': mapColors().muted,
        'line-width': 5,
        'line-dasharray': [0, 4, 3],
        'line-emissive-strength': 1
      }
    });
    
    const dashArraySequence = [
      [0, 4, 3],
      [0.5, 4, 2.5],
      [1, 4, 2],
      [1.5, 4, 1.5],
      [2, 4, 1],
      [2.5, 4, 0.5],
      [3, 4, 0],
      [0, 0.5, 3, 3.5],
      [0, 1, 3, 3],
      [0, 1.5, 3, 2.5],
      [0, 2, 3, 2],
      [0, 2.5, 3, 1.5],
      [0, 3, 3, 1],
      [0, 3.5, 3, 0.5]
    ];

    let step = 0;
    stopDashAnimation(); // only one animation loop at a time

    function animateDashArray(timestamp) {
      if (!mapRef.current?.getLayer('line-dashed')) return; // line was removed
      const newStep = parseInt((timestamp / 50) % dashArraySequence.length);

      if (newStep !== step) {
        mapRef.current.setPaintProperty(
          'line-dashed',
          'line-dasharray',
          dashArraySequence[step]
        );
        step = newStep;
      }

      dashAnimationRef.current = requestAnimationFrame(animateDashArray);
    }

    animateDashArray(0);

  }
  function viewLocation(city) {
    mapRef.current.flyTo({
      center: city.center,
      zoom: city.zoom,
      offset: [panelInset() / 2, 0],
    });
  }

  // fare callout on the middle of the route; follows `estimate`, so it goes away as soon as
  // the estimate is cleared (edited addresses/time, tab switch, re-estimating)
  useEffect(() => {
    const drawn = routeDrawnRef.current;
    if (!estimate || !drawn || !mapRef.current) return;
    // Mapbox owns the outer element's transform, so the card animates inside a wrapper:
    //   .fare-callout-wrap > .fare-callout (card: shine + price + meta + tail) + .fare-callout-ripple
    const wrap = document.createElement("div");
    wrap.className = "fare-callout-wrap";
    const card = document.createElement("div");
    card.className = "fare-callout";
    const shine = document.createElement("span");
    shine.className = "fare-callout-shine";
    const price = document.createElement("strong");
    const meta = document.createElement("span");
    meta.className = "fare-callout-meta";
    meta.textContent = `${estimate.distanceMiles.toFixed(1)} mi · ${Math.round(estimate.durationMinutes)} min`;
    card.append(shine, price, meta);
    const ripple = document.createElement("span");
    ripple.className = "fare-callout-ripple";
    wrap.append(ripple, card);

    // spring up once the line has drawn past the middle
    const delay = Math.max(0, drawn.drawEndsAt - performance.now() - 500);
    wrap.style.setProperty('--anim-delay', `${delay}ms`);

    // price ticks up from $0 as the card lands
    const setPrice = (t) => {
      price.textContent = `$${(estimate.low * t).toFixed(0)}–$${(estimate.high * t).toFixed(0)}`;
    };
    setPrice(0);
    const cancelCount = tween(800, setPrice, { delay: delay + 150 });

    const marker = new mapboxgl.Marker({ element: wrap, anchor: 'bottom', offset: [0, -8] })
      .setLngLat(pointAlongLine(drawn.coords, 0.5))
      .addTo(mapRef.current);
    return () => { cancelCount(); marker.remove(); };
  }, [estimate]);

  useEffect(() => {
    // nothing waits on the backend; just start waking it for fare reports
    warmBackend();
    const slowTimer = setTimeout(() => setSlowLoad(true), 15000);
    return () => clearTimeout(slowTimer);
  }, []);

  // restyle the map for the theme: night basemap, and recolor lines already drawn
  // (pins keep the color they were dropped with)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setConfigProperty('basemap', 'lightPreset', lightPreset());
    const c = mapColors();
    const recolor = {
      'route-line': c.route, 'route-casing': c.routeCasing,
      'route-gaps-line': c.muted, 'line-dashed': c.muted,
      ...Object.fromEntries(SERVICE_AREAS.map((a) => ['outline-' + a.city, c.areaLine])),
    };
    for (const [id, color] of Object.entries(recolor)) {
      if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', color);
    }
  }, [theme, mapReady]);

  useEffect(() => {
    mapboxgl.accessToken = API_KEY;
    

     mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      center:  [-118.439789907, 34.06999972],
      zoom: 13,
      style: "mapbox://styles/krialli/cmjuygaby006001s76rracetd",
      config: { basemap: { lightPreset: lightPreset() } },
    });


    mapRef.current.on('load', () => {
      const data = { serviceAreas: SERVICE_AREAS };
      const map = mapRef.current;
      setMapReady(true);

      // one world-sized polygon with every service area cut out as a hole
      map.addSource('outside-mask', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
              ...data.serviceAreas.map((a) => a.coordinates),
            ],
          },
        },
      });
      map.addLayer({
        id: 'outside-mask',
        type: 'fill',
        source: 'outside-mask',
        paint: { 'fill-color': AREA_STYLE.maskColor, 'fill-opacity': 0 }, // faded in below
      });

      for (const area of data.serviceAreas) {
        map.addSource(area.city, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [area.coordinates] },
          },
        });
        map.addLayer({
          id: 'fill-' + area.city,
          type: 'fill',
          source: area.city,
          paint: {
            'fill-color': mapColors().accentBright,
            'fill-opacity': AREA_STYLE.fillOpacity,
            'fill-opacity-transition': { duration: 150 },
          },
        });
        map.addLayer({
          id: 'outline-' + area.city,
          type: 'line',
          source: area.city,
          layout: { 'line-join': 'round' },
          paint: {
            'line-color': mapColors().areaLine,
            'line-width': AREA_STYLE.lineWidth,
            'line-width-transition': { duration: 150 },
            'line-color-transition': { duration: 150 },
            'line-emissive-strength': 1,
            'line-opacity': 0, // faded in below
          },
        });
        map.on('mouseenter', 'fill-' + area.city, () => setAreaHighlight(area.city, true));
        map.on('mouseleave', 'fill-' + area.city, () => setAreaHighlight(area.city, false));
      }

      // reveal: the outside dims, then the outlines glow in with a teal flash that settles to white
      tweenPaint(map, [['outside-mask', 'fill-opacity', 0, AREA_STYLE.maskOpacity]], 900, { delay: 200 });
      data.serviceAreas.forEach((area, i) => {
        const delay = 350 + i * 120;
        tweenPaint(map, [
          ['outline-' + area.city, 'line-opacity', 0, 1],
          ['fill-' + area.city, 'fill-opacity', 0.25, AREA_STYLE.fillOpacity],
        ], 1100, { delay });
        // flash the hover color, then hand back to the normal style
        map.setPaintProperty('outline-' + area.city, 'line-color', mapColors().areaLineHover);
        setTimeout(() => {
          if (map.getLayer('outline-' + area.city)) {
            map.setPaintProperty('outline-' + area.city, 'line-color', mapColors().areaLine);
          }
        }, delay + 700);
      });
    }
  );

    mapRef.current.addControl(new LocateControl(setLocationMessage), 'bottom-left');
  
      geocoderRef.current = new MapboxGeocoder({
          accessToken: mapboxgl.accessToken,
          useBrowserFocus: true,
          mapboxgl: mapboxgl,
          countries: 'us', // every service area is in the US
          placeholder: 'Search an address',
      });
      geocoderRef.current.addTo(geocoderContainerRef.current);

      // route mode: pickup + dropoff search boxes (markers/route are drawn by estimateRoute).
      // On a phone, picking one address moves on to the next empty box, else drops the keyboard.
      const advanceFocus = (container) => {
        if (!isNarrowScreen()) return;
        const next = [pickupContainerRef.current, dropoffContainerRef.current]
          .filter((c) => c !== container)
          .map((c) => c.querySelector('input'))
          .find((input) => input && !input.value);
        if (next) next.focus();
        else document.activeElement?.blur?.();
      };
      const makeRouteGeocoder = (placeholder, container, onPick) => {
        const g = new MapboxGeocoder({
          accessToken: mapboxgl.accessToken,
          mapboxgl: mapboxgl,
          marker: false,
          flyTo: false,
          countries: 'us',
          placeholder,
        });
        g.addTo(container);
        g.on('result', (e) => {
          onPick(e.result.center, e.result.text || e.result.place_name);
          setEstimate(null);
          advanceFocus(container);
        });
        g.on('clear', () => { onPick(null, ""); setEstimate(null); });
        return g;
      };
      pickupGeocoderRef.current = makeRouteGeocoder('Pickup location', pickupContainerRef.current,
        (c, label) => { setPickup(c); setPickupLabel(label); });
      dropoffGeocoderRef.current = makeRouteGeocoder('Where to?', dropoffContainerRef.current,
        (c, label) => { setDropoff(c); setDropoffLabel(label); });

      // rank results near what's on screen first. The geocoders live in the panel rather
      // than on the map, so their built-in trackProximity never sees the map; do it here.
      const syncProximity = () => {
        const { lng, lat } = mapRef.current.getCenter();
        for (const g of [geocoderRef.current, pickupGeocoderRef.current, dropoffGeocoderRef.current]) {
          g?.setProximity({ longitude: lng, latitude: lat });
        }
      };
      syncProximity();
      mapRef.current.on('moveend', syncProximity);

      // panning or tapping the map on a phone tucks the sheet away, like most map apps
      mapRef.current.on('click', () => {
        if (isNarrowScreen()) {
          document.activeElement?.blur?.();
          setSheetOpen(false);
        }
      });
      mapRef.current.on('dragstart', () => {
        if (isNarrowScreen()) {
          document.activeElement?.blur?.();
          setSheetOpen(false);
        }
      });


      // when interacting/searching with the geocoder, make the map move to the point
      geocoderRef.current.on('result' , (e) => {

        const narrow = isNarrowScreen();
        if (narrow) document.activeElement?.blur?.(); // drop the keyboard so the result is visible
        mapRef.current.flyTo({
          center: e.result.center,
          zoom: 14,
          // on a phone the search card covers the bottom of the map; center the pin in what's left
          offset: narrow ? [0, -(sheetRef.current?.offsetHeight || 0) / 2] : [panelInset() / 2, 0],
      });
      if (mapRef.current.getSource('closest-point-route')) {
        mapRef.current.removeLayer('line-dashed');
        mapRef.current.removeSource('closest-point-route');
      }
      placeMarker(e);
      currentPulseRef.current?.remove();
      currentPulseRef.current = null;

        // ripple under the pin: teal = covered, gray = outside; keep the pin on top.
        // Wait for the pin to land (dropIn delay + impact); skip if it's been replaced or cleared.
        const marker = currentMarkerRef.current;
        const inside = isInAnyArea(e.result.center, AREAS);
        setTimeout(() => {
          if (currentMarkerRef.current !== marker || !marker) return;
          currentPulseRef.current?.remove();
          currentPulseRef.current = pulseMarker(mapRef.current, e.result.center, inside);
          const pin = marker.getElement();
          pin?.parentNode?.appendChild(pin);

          if (!inside) {
            getClosestPointLine(e.result.center[0], e.result.center[1]);
          }
        }, PIN_LANDS_MS);

      }
      )

      



    return () => {
      if (geocoderRef.current) {
        geocoderRef.current.onRemove();
      }
      pickupGeocoderRef.current?.onRemove();
      dropoffGeocoderRef.current?.onRemove();
      if (dashAnimationRef.current) cancelAnimationFrame(dashAnimationRef.current);
      routeAnimCancelsRef.current.forEach((cancel) => cancel());
      mapRef.current.remove()
    }
  }, [])
  const cityList = CITIES.map((city) => ({ ...city, sqmi: AREA_SIZES[city.name] }));

  return (
    <div className="app">

      {!loadingGone && (
        <div
          className={`loading-screen${mapReady ? " leaving" : ""}`}
          role="status"
          aria-live="polite"
          onAnimationEnd={(e) => { if (e.animationName === "loading-out") setLoadingGone(true); }}
        >
          {/* not an h1: the panel title below is the page's single h1 */}
          <div className="loading-title">Waymo Fare Calculator</div>
          <div className="loading-bar"><span /></div>
          <div className="loading-text">
            {slowLoad
              ? "This is taking longer than usual. Hang tight, or try refreshing."
              : "Loading map…"}
          </div>
        </div>
      )}

      {locationMessage && (
        <div className="location-toast" role="alert">
          <span>{locationMessage}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setLocationMessage(null)}>
            <XMarkIcon width={18} height={18} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="map-container" ref={mapContainerRef} />

      <button
        type="button"
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={theme === "dark" ? "Light mode" : "Dark mode"}
      >
        <ThemeIcon dark={theme === "dark"} />
      </button>

      <aside
        ref={sheetRef}
        className={`panel search-card${sheetOpen ? "" : " collapsed"}${mapReady ? " entered" : ""}`}
        aria-label="Search and fare estimates"
        onTouchStart={onSheetTouchStart}
        onTouchMove={onSheetTouchMove}
        onTouchEnd={onSheetTouchEnd}
        onTouchCancel={onSheetTouchEnd}
      >
        <header className="panel-header">
          <h1 className="brand-title">Waymo Fare Calculator</h1>
          {/* keyed on mode so the new line fades in when the tab changes */}
          <p className="brand-tagline" key={mode}>
            {mode === "route"
              ? "Map a route and estimate a fare."
              : "See if an address is in a Waymo service area."}
          </p>
        </header>

        {mode === "route" && !sheetOpen && (
          <button type="button" className="sheet-summary" onClick={() => setSheetOpen(true)}>
            <span className="sheet-summary-route">
              {pickupLabel || "Pickup"} → {dropoffLabel || "Dropoff"}
            </span>
            <span className="sheet-summary-price">
              {estimating ? "Estimating…"
                : estimate ? `$${estimate.low.toFixed(0)}–$${estimate.high.toFixed(0)}`
                : "Edit"}
            </span>
          </button>
        )}

        <div className="mode-toggle" role="tablist" aria-label="Mode" data-mode={mode}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "route"}
            className={`mode-tab ${mode === "route" ? "active" : ""}`}
            onClick={() => switchMode("route")}
          >
            Price a trip
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "search"}
            className={`mode-tab ${mode === "search" ? "active" : ""}`}
            onClick={() => switchMode("search")}
          >
            Check address
          </button>
        </div>

        <div className="geocoder-container" ref={geocoderContainerRef} hidden={mode !== "search"}></div>

        {/* mobile only: compact city shortcuts */}
        <div className="city-chips" hidden={mode !== "search"}>
          {CITIES.map((city) => (
            <button key={city.name} type="button" className="city-chip" onClick={() => viewLocation(city)}>
              {city.short}
            </button>
          ))}
        </div>

        <div className="route-panel" hidden={mode !== "route"}>
          <div className="route-field pickup">
            <div className="geocoder-container route-geocoder" ref={pickupContainerRef}></div>
            {currentLocationButton("pickup")}
          </div>
          <div className="route-field dropoff">
            <div className="geocoder-container route-geocoder" ref={dropoffContainerRef}></div>
            {currentLocationButton("dropoff")}
          </div>

          <DateTimePicker
            value={departAt}
            onChange={(v) => { setDepartAt(v); setEstimate(null); }}
          />

          <button
            type="button"
            className={`button estimate-button${estimating ? " busy" : ""}`}
            disabled={!pickup || !dropoff || estimating}
            onClick={estimateRoute}
          >
            {estimating ? "Estimating…" : "Estimate price"}
          </button>

          {estimateError && <div className="route-error">{estimateError}</div>}

          {estimate && (
            <div className="receipt">
              {estimate.ends.pickup.inArea === false && (
                <div className="route-note">
                  Pickup is outside the service area. Nearest Waymo pickup is {estimate.ends.pickup.gapMiles.toFixed(2)} mi away (dashed line).
                </div>
              )}
              {estimate.ends.dropoff.inArea === false && (
                <div className="route-note">
                  Dropoff is outside the service area. Nearest Waymo dropoff is {estimate.ends.dropoff.gapMiles.toFixed(2)} mi away (dashed line).
                </div>
              )}
              {!estimate.staysInside && (
                <div className="route-warning">
                  Couldn&apos;t find a route that stays fully inside the service area. The route shown leaves it briefly.
                </div>
              )}

              <div className="receipt-head">
                <div className="receipt-label">Estimated fare</div>
                <div className="route-price">
                  $<AnimatedNumber value={estimate.low} />–$<AnimatedNumber value={estimate.high} />
                </div>
                <div className="route-meta">
                  {estimate.distanceMiles.toFixed(1)} mi · {Math.round(estimate.durationMinutes)} min
                  {" · "}{estimate.timeLabel}{estimate.multiplier !== 1 ? ` (×${estimate.multiplier})` : ""}
                </div>
              </div>

              <ol className="receipt-trip">
                <li><span className="trip-dot pickup" />{pickupLabel || "Pickup"}</li>
                <li><span className="trip-dot dropoff" />{dropoffLabel || "Dropoff"}</li>
              </ol>

              <dl className="receipt-breakdown">
                <div><dt>Base fare</dt><dd>${estimate.breakdown.base.toFixed(2)}</dd></div>
                <div><dt>Distance</dt><dd>${estimate.breakdown.distance.toFixed(2)}</dd></div>
                <div><dt>Time</dt><dd>${estimate.breakdown.time.toFixed(2)}</dd></div>
                <div><dt>Booking fee</dt><dd>${estimate.breakdown.bookingFee.toFixed(2)}</dd></div>
              </dl>

              <p className="route-disclaimer">Unofficial estimate, not Waymo pricing.</p>

              <FareReport estimate={estimate} departAt={departAt} />
            </div>
          )}
        </div>

        <section className="city-list" aria-labelledby="city-list-title">
          <h2 className="section-title" id="city-list-title">Service areas</h2>
          <ul>
            {cityList.map((city, i) => (
              <li key={city.name} style={{ '--i': i }}>
                <button
                  type="button"
                  className="city-row"
                  onClick={() => viewLocation(city)}
                  onMouseEnter={() => setAreaHighlight(city.name, true)}
                  onMouseLeave={() => setAreaHighlight(city.name, false)}
                  onFocus={() => setAreaHighlight(city.name, true)}
                  onBlur={() => setAreaHighlight(city.name, false)}
                >
                  <MapPinIcon className="city-icon" width={26} height={26} strokeWidth={1.75} aria-hidden="true" />
                  <span className="city-text">
                    <span className="city-name">{city.name}</span>
                    <span className="city-meta">{STATE_NAMES[city.state]}</span>
                  </span>
                  <span className="city-size">
                    {city.sqmi
                      ? <span className="fade-in">{Math.round(city.sqmi).toLocaleString()} sq mi</span>
                      : <span className="skeleton" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <About />

        <footer className="panel-footer">
          Unofficial project. Not affiliated with Waymo.
        </footer>

        <button
          type="button"
          className="sheet-grabber"
          aria-label={sheetOpen ? "Hide options" : "Show options"}
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((o) => !o)}
        >
          <span />
        </button>
      </aside>
    </div>
  );
}

export default App
