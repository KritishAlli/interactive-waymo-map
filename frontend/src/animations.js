// Map animations. Mapbox paints in WebGL, so these are driven from JS with
// requestAnimationFrame rather than CSS. Each starter returns a cancel function.
import mapboxgl from 'mapbox-gl';

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// run `onFrame(progress 0..1)` over `duration` ms, after `delay` ms
export function tween(duration, onFrame, { delay = 0, ease = easeOutCubic, onDone } = {}) {
  let raf;
  let start = null;
  const frame = (now) => {
    if (start === null) start = now + delay;
    const t = Math.min(Math.max((now - start) / duration, 0), 1);
    if (now >= start) onFrame(ease(t));
    if (t < 1) raf = requestAnimationFrame(frame);
    else onDone?.();
  };
  if (prefersReducedMotion()) {
    onFrame(1);
    onDone?.();
    return () => {};
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// fade map paint properties, e.g. [['outline-LA', 'line-opacity', 0, 1]]
export function tweenPaint(map, props, duration, opts) {
  return tween(duration, (t) => {
    for (const [layer, prop, from, to] of props) {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop, from + (to - from) * t);
    }
  }, opts);
}

// reveal line layers from start to end (sources need `lineMetrics: true`)
export function drawLine(map, layerIds, duration, opts) {
  return tween(duration, (t) => {
    for (const id of layerIds) {
      // trim hides [t, 1]; at t = 1 hide nothing
      if (map.getLayer(id)) map.setPaintProperty(id, 'line-trim-offset', t >= 1 ? [0, 0] : [t, 1]);
    }
  }, opts);
}

// planar-enough distance for points along one city route
function cumulativeLengths(coords) {
  const cosLat = Math.cos((coords[0][1] * Math.PI) / 180);
  const lengths = [0];
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * cosLat;
    const dy = coords[i][1] - coords[i - 1][1];
    lengths.push(lengths[i - 1] + Math.hypot(dx, dy));
  }
  return lengths;
}

function pointAlong(coords, lengths, fraction) {
  const target = fraction * lengths[lengths.length - 1];
  let lo = 0;
  let hi = lengths.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] <= target) lo = mid;
    else hi = mid;
  }
  const seg = lengths[hi] - lengths[lo] || 1;
  const f = (target - lengths[lo]) / seg;
  return [
    coords[lo][0] + (coords[hi][0] - coords[lo][0]) * f,
    coords[lo][1] + (coords[hi][1] - coords[lo][1]) * f,
  ];
}

// the point `fraction` (0..1) of the way along a line, by distance
export function pointAlongLine(coords, fraction) {
  return pointAlong(coords, cumulativeLengths(coords), fraction);
}

// a glowing dot that drives the route on a loop, like a Waymo on its way
export function startRouteCar(map, coords, { lapMs = 4200, pauseMs = 900 } = {}) {
  if (prefersReducedMotion() || coords.length < 2) return () => {};
  const lengths = cumulativeLengths(coords);
  const el = document.createElement('div');
  el.className = 'route-car';
  const marker = new mapboxgl.Marker({ element: el }).setLngLat(coords[0]).addTo(map);

  let raf;
  let start = null;
  const frame = (now) => {
    if (start === null) start = now;
    const elapsed = (now - start) % (lapMs + pauseMs);
    const t = Math.min(elapsed / lapMs, 1);
    marker.setLngLat(pointAlong(coords, lengths, easeInOutCubic(t)));
    // fade in at pickup, out at dropoff, hidden during the pause
    const fade = Math.min(t / 0.06, (1 - t) / 0.06, 1);
    el.style.opacity = elapsed > lapMs ? 0 : fade;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    marker.remove();
  };
}

// an expanding ring under a searched address: teal inside the service area, gray outside
export function pulseMarker(map, lngLat, inside) {
  const el = document.createElement('div');
  el.className = `pulse-ring ${inside ? 'inside' : 'outside'}`;
  el.innerHTML = '<span></span><span></span>';
  return new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
}

// pin that drops in and bounces; `delay` in ms
export function dropIn(marker, delay = 0) {
  const el = marker.getElement();
  el.classList.add('marker-drop');
  el.style.setProperty('--anim-delay', `${delay}ms`);
  return marker;
}
