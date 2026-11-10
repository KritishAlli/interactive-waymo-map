import { useRef,useEffect, useState } from 'react'
import mapboxgl, { Marker } from "mapbox-gl";
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';

import './App.css'
import DateTimePicker from './DateTimePicker.jsx'
import { prepareAreas, snapTrip, checkRoute } from './geo.js'
const API_KEY = import.meta.env.VITE_APP_MAPBOX_API_KEY;
const API_URL = import.meta.env.VITE_APP_API_URL || "";
import { Field, Fieldset, Input, Label, Legend, Select, Textarea, Button, Tab, TabGroup, TabList,Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react'

// Render's free plan spins the backend down after inactivity; the first request
// triggers a cold start that can take 30-60s. Poll /health until it answers 200.
// format a Date as the "YYYY-MM-DDTHH:mm" value a datetime-local input expects
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const isNarrowScreen = () => window.matchMedia('(max-width: 768px)').matches;

async function waitForBackend({ timeoutMs = 90000, intervalMs = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      // network error = still cold starting, keep trying
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}


function App() {

  const [backendReady, setBackendReady] = useState(false);
  const [backendTimedOut, setBackendTimedOut] = useState(false);


  const mapRef = useRef()
  const mapContainerRef = useRef()
  const geocoderRef = useRef()
  const geocoderContainerRef = useRef()
  const currentMarkerRef = useRef();
  const currentDistancePopupRef = useRef();
  const dashAnimationRef = useRef();

  // route price estimation mode
  const [mode, setMode] = useState("search"); // "search" | "route"
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
  const areasRef = useRef(null); // service areas prepared for client-side geometry (geo.js)
  const [pickupLabel, setPickupLabel] = useState("");
  const [dropoffLabel, setDropoffLabel] = useState("");

  // mobile: the search card is a pull-down sheet that can be swiped up out of the way
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
      ? (dy < 0 ? Math.max(dy, -el.offsetHeight * 0.6) : dy * 0.15)
      : (dy > 0 ? Math.min(dy * 0.4, 60) : dy * 0.15);
    el.style.transform = `translateY(${offset}px)`;
  }

  function onSheetTouchEnd() {
    const d = sheetDragRef.current;
    sheetDragRef.current = null;
    if (!d?.active) return;
    const el = sheetRef.current;
    el.style.transition = '';
    el.style.transform = '';
    if (sheetOpen && d.dy < -40) {
      document.activeElement?.blur?.(); // drop the keyboard with the sheet
      setSheetOpen(false);
    } else if (!sheetOpen && d.dy > 30) {
      setSheetOpen(true);
    }
  }

  async function getAreas() {
    if (!areasRef.current) {
      const res = await fetch(`${API_URL}/api/service-areas`);
      const data = await res.json();
      areasRef.current = prepareAreas(data.serviceAreas);
    }
    return areasRef.current;
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
    const map = mapRef.current;
    if (map?.getLayer('line-dashed')) map.removeLayer('line-dashed');
    if (map?.getSource('closest-point-route')) map.removeSource('closest-point-route');
  }

  function clearRoute() {
    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];
    const map = mapRef.current;
    for (const id of ['route-line', 'route-gaps-line']) {
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

  async function postJSON(path, body) {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
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

  function distancePill(miles) {
    const el = document.createElement("div");
    el.className = "distance-pill";
    el.textContent = `${miles.toFixed(2)} mi`;
    return el;
  }

  function stopDot() {
    const el = document.createElement("div");
    el.className = "stop-dot";
    return el;
  }

  // route line + address pins; for addresses outside the area, a dashed line and
  // distance pill from the address to where the Waymo actually stops
  function drawRoute(route, ends) {
    const map = mapRef.current;
    clearRoute();
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: route.geometry },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#1a73e8', 'line-width': 6, 'line-emissive-strength': 1 },
    });

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
      paint: { 'line-color': 'orange', 'line-width': 5, 'line-dasharray': [0.5, 2], 'line-emissive-strength': 1 },
    });

    const markers = [
      new mapboxgl.Marker({ color: '#2e7d32' }).setLngLat(ends.pickup.original).addTo(map),
      new mapboxgl.Marker({ color: '#c62828' }).setLngLat(ends.dropoff.original).addTo(map),
    ];
    for (const e of gaps) {
      const mid = [(e.original[0] + e.point[0]) / 2, (e.original[1] + e.point[1]) / 2];
      markers.push(new mapboxgl.Marker({ element: stopDot() }).setLngLat(e.point).addTo(map));
      markers.push(new mapboxgl.Marker({ element: distancePill(e.gapMiles), anchor: 'center' }).setLngLat(mid).addTo(map));
    }
    routeMarkersRef.current = markers;

    const bounds = new mapboxgl.LngLatBounds(ends.pickup.original, ends.pickup.original);
    route.geometry.coordinates.forEach((c) => bounds.extend(c));
    bounds.extend(ends.dropoff.original);
    const isNarrow = isNarrowScreen();
    map.fitBounds(bounds, {
      // on mobile the sheet collapses to a one-line summary once the route is drawn
      padding: isNarrow
        ? { top: 130, bottom: 80, left: 40, right: 40 }
        : { top: 80, bottom: 80, left: 420, right: 420 },
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
      const areas = await getAreas();
      const ends = snapTrip(pickup, dropoff, areas);
      if (ends.error) throw new Error(ends.error);

      const { route, staysInside } = await findInAreaRoute(ends.pickup.point, ends.dropoff.point, departAt, areas);
      if (isNarrowScreen()) setSheetOpen(false); // show the route; price stays in the summary
      drawRoute(route, ends);

      const data = await postJSON('/api/estimate-price', {
        pickup: ends.pickup.point,
        dropoff: ends.dropoff.point,
        distanceMiles: route.distance / 1609.344,
        durationMinutes: route.duration / 60,
        departAt,
      });
      setEstimate({ ...data, ends, staysInside });
    } catch (err) {
      setEstimateError(err.message || "Something went wrong");
    } finally {
      setEstimating(false);
    }
  }

  async function isInsideBounds(long, lat) {
    const res = await fetch(`${API_URL}/api/check-point`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({long: long, lat: lat}),

    });
    const data = await res.json();
    console.log ("Inside function:")
    console.log(data);
    return data;
  }
  async function placeMarker(e) {
    if (currentMarkerRef.current) {
      currentMarkerRef.current.remove();
    }
    var marker = new mapboxgl.Marker().
        setLngLat(e.result.center)
        marker._element.id = "selection";
        marker.addTo(mapRef.current);
      currentMarkerRef.current = marker;

  }
  async function placeMidpointDistancePopup(coordArr1, coordArr2) {
    if (currentDistancePopupRef.current) {
      currentDistancePopupRef.current.remove();
    }
    const res = await fetch(`${API_URL}/api/midpoint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({coordArr1: coordArr1, coordArr2: coordArr2}),

    });
    const data = await res.json();

    const el = document.createElement("div");
    el.innerHTML = `
      <div style="
        background: black;
        color: white;
        padding: 8px 14px;
        border-radius: 20px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        white-space: nowrap;
      ">
        <strong>${data.distance.toFixed(2)} mi</strong>
      </div>
    `;

    var popup = new mapboxgl.Marker({
      element: el,
      anchor: "center"
    })
  .setLngLat(data.midpoint.geometry.coordinates)
    popup.addTo(mapRef.current);

    currentDistancePopupRef.current = popup;
  }
  async function getClosestPointLine(long, lat) {

    const res = await fetch(`${API_URL}/api/closest-point`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({long: long, lat: lat}),

    });
    
    const data = await res.json();
    console.log(data["closest-point"].geometry.coordinates);
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
            data["closest-point"].geometry.coordinates
          ]
        }
      }
    });
    placeMidpointDistancePopup([long, lat], data["closest-point"].geometry.coordinates);
    


    mapRef.current.addLayer({
      type: 'line',
      source: 'closest-point-route',
      id: 'line-dashed',
      paint: {
        'line-color': 'orange',
        'line-width': 6,
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
  async function viewLocation(location) {
    if (location == "LA") {
      mapRef.current.flyTo({
        center: [-118.25, 34.05],
        zoom: 10
      })
    }
    if (location == "SF") {
      mapRef.current.flyTo({
        center: [-122.25, 37.67],
        zoom: 9
      })
    }
    if (location == "Phoenix") {
      mapRef.current.flyTo({
        center: [-112.0740, 33.4484],
        zoom: 10
      })
    }
  }

  useEffect(() => {
    let cancelled = false;
    waitForBackend().then((ok) => {
      if (cancelled) return;
      if (ok) setBackendReady(true);
      else setBackendTimedOut(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.title = "Waymo Service Areas";
    mapboxgl.accessToken = API_KEY;
    

     mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      center:  [-118.439789907, 34.06999972],
      zoom: 13,
      style: "mapbox://styles/krialli/cmjuygaby006001s76rracetd"
    });


    mapRef.current.on('load', async () => {
      console.log(API_URL);

      // backend may still be cold-starting when the map finishes loading
      await waitForBackend();
      const res = await fetch(`${API_URL}/api/service-areas`);

      const data = await res.json();
      areasRef.current = prepareAreas(data.serviceAreas);


      // Add a data source containing GeoJSON data.
      for (let i = 0; i < data.serviceAreas.length; i++) {
        mapRef.current.addSource(data.serviceAreas[i].city, {
            'type': 'geojson',
            'data': {
                'type': 'Feature',
                'geometry': {
                    'type': 'Polygon',
                    'coordinates': [data.serviceAreas[i].coordinates]
                }
            }
      });
      mapRef.current.addLayer({
        'id': 'fill-' + data.serviceAreas[i].city,
        'type': 'fill',
        'source': data.serviceAreas[i].city, 
        'paint': {
            'fill-color': '#FF8000', 
            'fill-opacity': 0.4
        }
    });  
      mapRef.current.addLayer({
        'id': 'outline-' + data.serviceAreas[i].city,
        'type': 'line',
        'source': data.serviceAreas[i].city, 
        'layout': {},
        'paint': {
          'line-color': '#FF8000',
          'line-width': 3
        }
      });
      

    }
    mapRef.current.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true
          
        },
        trackUserLocation: true,
        showUserHeading: true
        
      }), 'bottom-left'
    );
  
    }
  );
  
      geocoderRef.current = new MapboxGeocoder({
          accessToken: mapboxgl.accessToken,
          useBrowserFocus: true,
          mapboxgl: mapboxgl,
      });
      geocoderRef.current.addTo(geocoderContainerRef.current);

      // route mode: pickup + dropoff search boxes (markers/route are drawn by estimateRoute)
      const makeRouteGeocoder = (placeholder, container, onPick) => {
        const g = new MapboxGeocoder({
          accessToken: mapboxgl.accessToken,
          mapboxgl: mapboxgl,
          marker: false,
          flyTo: false,
          placeholder,
        });
        g.addTo(container);
        g.on('result', (e) => { onPick(e.result.center, e.result.text || e.result.place_name); setEstimate(null); });
        g.on('clear', () => { onPick(null, ""); setEstimate(null); });
        return g;
      };
      pickupGeocoderRef.current = makeRouteGeocoder('Pickup address', pickupContainerRef.current,
        (c, label) => { setPickup(c); setPickupLabel(label); });
      dropoffGeocoderRef.current = makeRouteGeocoder('Dropoff address', dropoffContainerRef.current,
        (c, label) => { setDropoff(c); setDropoffLabel(label); });

      // panning the map on a phone tucks the sheet away, like most map apps
      mapRef.current.on('dragstart', () => {
        if (isNarrowScreen()) {
          document.activeElement?.blur?.();
          setSheetOpen(false);
        }
      });


      // when interacting/searching with the geocoder, make the map move to the point
      geocoderRef.current.on('result' , (e) => {

        mapRef.current.flyTo({
          center: e.result.center,
          zoom: 14
      });
      if (mapRef.current.getSource('closest-point-route')) {
        mapRef.current.removeLayer('line-dashed');
        mapRef.current.removeSource('closest-point-route');
      }
      placeMarker(e);
        

        (isInsideBounds(e.result.center[0], e.result.center[1])).then(result => {
          
          if (!result["point-found"]) {
            getClosestPointLine(e.result.center[0], e.result.center[1]);
          }

        });

      }
      )

      



    return () => {
      if (geocoderRef.current) {
        geocoderRef.current.onRemove();
      }
      pickupGeocoderRef.current?.onRemove();
      dropoffGeocoderRef.current?.onRemove();
      if (dashAnimationRef.current) cancelAnimationFrame(dashAnimationRef.current);
      mapRef.current.remove()
    }
  }, [])
  return (
    
    
    <div style={
      {
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        maxWidth: '100%',
        position: 'relative'

      }
    }>

      {!backendReady && (
        <div className="loading-screen">
          <div className="loading-spinner" />
          <div className="loading-text">
            {backendTimedOut
              ? "Server is taking longer than usual… hang tight or refresh."
              : "Waking up the server… est. 15 sec"}
          </div>
        </div>
      )}

      <div className='map-container' ref={mapContainerRef}>

            <Fieldset className="overlap title-card">
              <Legend className="text-block">Waymo Service Areas</Legend>
              <Label className={"text-block small-text-block"}>an interactive map.</Label>
              <Field>
                
              </Field>
            </Fieldset>

            
      </div>

      <Fieldset >

          <Field className="overlap locations-card">

                <Button className="button" onClick={() => viewLocation("LA")}>LA</Button>
                <Button className="button" onClick={() => viewLocation("SF")}>SF</Button>
                <Button className="button" onClick={() => viewLocation("Phoenix")}>AZ</Button>
          </Field>
          
          
        </Fieldset>
      
      <Fieldset
        ref={sheetRef}
        className={`overlap search-card${sheetOpen ? "" : " collapsed"}`}
        onTouchStart={onSheetTouchStart}
        onTouchMove={onSheetTouchMove}
        onTouchEnd={onSheetTouchEnd}
        onTouchCancel={onSheetTouchEnd}
      >
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
        <div className="mode-toggle" role="tablist" aria-label="Mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "search"}
            className={`mode-tab ${mode === "search" ? "active" : ""}`}
            onClick={() => switchMode("search")}
          >
            Check address
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "route"}
            className={`mode-tab ${mode === "route" ? "active" : ""}`}
            onClick={() => switchMode("route")}
          >
            Price a trip
          </button>
        </div>

        <div className='geocoder-container' ref={geocoderContainerRef} hidden={mode !== "search"}></div>

        <div className="route-panel" hidden={mode !== "route"}>
          <div className='geocoder-container route-geocoder' ref={pickupContainerRef}></div>
          <div className='geocoder-container route-geocoder' ref={dropoffContainerRef}></div>

          <DateTimePicker
            value={departAt}
            onChange={(v) => { setDepartAt(v); setEstimate(null); }}
          />

          <button
            type="button"
            className="button estimate-button"
            disabled={!pickup || !dropoff || estimating}
            onClick={estimateRoute}
          >
            {estimating ? "Estimating…" : "Estimate price"}
          </button>

          {estimateError && <div className="route-error">{estimateError}</div>}

          {estimate && (
            <div className="route-result">
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
              <div className="route-price">
                ${estimate.low.toFixed(0)}–${estimate.high.toFixed(0)}
              </div>
              <div className="route-meta">
                {estimate.distanceMiles.toFixed(1)} mi · {Math.round(estimate.durationMinutes)} min
                {" · "}{estimate.timeLabel}{estimate.multiplier !== 1 ? ` (×${estimate.multiplier})` : ""}
              </div>
              <div className="route-breakdown">
                Base ${estimate.breakdown.base.toFixed(2)} · Distance ${estimate.breakdown.distance.toFixed(2)}
                {" · "}Time ${estimate.breakdown.time.toFixed(2)} · Booking ${estimate.breakdown.bookingFee.toFixed(2)}
              </div>
              <div className="route-disclaimer">Unofficial estimate, not Waymo pricing.</div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="sheet-grabber"
          aria-label={sheetOpen ? "Hide options" : "Show options"}
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((o) => !o)}
        >
          <span />
        </button>
      </Fieldset>
    
    </div>
    
  );
}

export default App
