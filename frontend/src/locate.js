import mapboxgl from 'mapbox-gl';

// "Find my location" button. Replaces mapboxgl.GeolocateControl, which permanently
// disables itself (grey button, red slash) the moment the browser reports permission
// denied, with no explanation. Safari reports that whenever Location Services are off
// for it, so the button looked broken. This one stays tappable, says how to fix it,
// and doesn't ask for compass access on iOS (a second prompt that was easy to dismiss).

const POSITION_OPTIONS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 };

function deniedHelp() {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /safari/i.test(ua) && !/chrome|chromium|crios|fxios|edgios|android/i.test(ua);
  if (iOS && safari) {
    return 'Location is blocked. Turn on Settings → Privacy & Security → Location Services → Safari Websites ' +
      '("While Using the App"), then allow Location for this site under "aA" → Website Settings, and reload.';
  }
  if (iOS) {
    return 'Location is blocked. Turn on Settings → Privacy & Security → Location Services for your browser, then reload.';
  }
  if (safari) {
    return 'Location is blocked. Turn on Safari in System Settings → Privacy & Security → Location Services, ' +
      'then set this site to "Allow" in Safari → Settings → Websites → Location, and reload.';
  }
  return 'Location is blocked. Allow it for this site from the icon at the left of the address bar, then try again.';
}

export default class LocateControl {
  // onMessage(text | null): show or clear a message for the user
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.watchId = null;
    this.marker = null;
  }

  onAdd(map) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    // reuse Mapbox's geolocate styles for the icon and its waiting/active states
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'mapboxgl-ctrl-geolocate';
    this.button.setAttribute('aria-label', 'Find my location');
    const icon = document.createElement('span');
    icon.className = 'mapboxgl-ctrl-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.title = 'Find my location';
    this.button.appendChild(icon);
    this.button.addEventListener('click', () => this.locate());
    this.container.appendChild(this.button);
    return this.container;
  }

  onRemove() {
    this.stopWatch();
    this.marker?.remove();
    this.container.remove();
    this.map = undefined;
  }

  setState(state) { // null | 'waiting' | 'active'
    this.button.classList.toggle('mapboxgl-ctrl-geolocate-waiting', state === 'waiting');
    this.button.classList.toggle('mapboxgl-ctrl-geolocate-active', state === 'active');
  }

  locate() {
    if (!navigator.geolocation) {
      this.onMessage("This browser can't share your location.");
      return;
    }
    if (!window.isSecureContext) {
      this.onMessage('Location only works over https (or localhost). Open the https version of this site.');
      return;
    }
    this.onMessage(null);
    this.setState('waiting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!this.map) return;
        this.show(pos, true);
        this.setState('active');
        this.watch();
      },
      (err) => this.fail(err),
      POSITION_OPTIONS,
    );
  }

  // keep the dot following the user after the first fix
  watch() {
    if (this.watchId !== null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => { if (this.map) this.show(pos, false); },
      () => {}, // the first fix already worked; ignore later hiccups
      POSITION_OPTIONS,
    );
  }

  stopWatch() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  show(pos, fly) {
    const lngLat = [pos.coords.longitude, pos.coords.latitude];
    if (!this.marker) {
      const el = document.createElement('div');
      el.className = 'mapboxgl-user-location-dot'; // Mapbox's blue pulsing dot
      this.marker = new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(this.map);
    } else {
      this.marker.setLngLat(lngLat);
    }
    if (fly) this.map.flyTo({ center: lngLat, zoom: Math.max(this.map.getZoom(), 14) });
  }

  fail(err) {
    if (!this.map) return;
    this.setState(this.watchId !== null ? 'active' : null);
    if (err.code === 1) this.onMessage(deniedHelp());
    else this.onMessage("Couldn't find your location. Check that Location Services are on and try again.");
  }
}
