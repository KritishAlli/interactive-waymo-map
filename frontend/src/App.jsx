import { useRef,useEffect, useState } from 'react'
import mapboxgl from "mapbox-gl";
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';

import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  async function testBackend() {
    const res = await fetch("http://localhost:3001/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({long: -118.439789907, lat: 34.06999972}),

    });
    const data = await res.json();
    alert (JSON.stringify(data));
  }
  const mapRef = useRef()
  const mapContainerRef = useRef()

  useEffect(() => {
    mapboxgl.accessToken = "";

     mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      center:  [-118.439789907, 34.06999972],
      zoom: 13,
    });
    
    mapRef.current.on('load', () => {
      // Add a data source containing GeoJSON data.
      mapRef.current.addSource('LA', {
          'type': 'geojson',
          'data': {
              'type': 'Feature',
              'geometry': {
                  'type': 'Polygon',
                  // These coordinates outline Maine.
                  'coordinates': [
                    [
                      [
                        -118.45587021234712,
                        33.96638042114445
                      ],
                      [
                        -118.44850132286808,
                        33.957407240384654
                      ],
                      [
                        -118.38469028757214,
                        33.958317606310814
                      ],
                      [
                        -118.36038865642735,
                        33.938807628197345
                      ],
                      [
                        -118.33783074211175,
                        33.93806237333539
                      ],
                      [
                        -118.32719762524658,
                        33.95064033705699
                      ],
                      [
                        -118.32934518293735,
                        34.00541331708623
                      ],
                      [
                        -118.27913027691574,
                        34.00540433824058
                      ],
                      [
                        -118.25904697675355,
                        34.033262446859105
                      ],
                      [
                        -118.24057047780263,
                        34.02496100267825
                      ],
                      [
                        -118.22219134352639,
                        34.03100582415611
                      ],
                      [
                        -118.23317709414619,
                        34.08965573605639
                      ],
                      [
                        -118.27037808874019,
                        34.11662907180453
                      ],
                      [
                        -118.37572229453548,
                        34.09988772905554
                      ],
                      [
                        -118.46438814842509,
                        34.07352846593585
                      ],
                      [
                        -118.51026876300045,
                        34.026738560750175
                      ],
                      [
                        -118.45587021234712,
                        33.96638042114445
                      ]
                    ]
                  ]
              }
          }
      });

      // Add a new layer to visualize the polygon.
      mapRef.current.addLayer({
          'id': 'LA',
          'type': 'fill',
          'source': 'LA', // reference the data source
          'layout': {},
          'paint': {
              'fill-color': '#0080ff', // blue color fill
              'fill-opacity': 0.5
          }
      });  
  
    });
    mapRef.current.addControl(
      new MapboxGeocoder({
          accessToken: mapboxgl.accessToken,
          useBrowserFocus: true,
          mapboxgl: mapboxgl
      })
  );

    return () => {
      mapRef.current.remove()
    }
  }, [])
  return (
    
    
    <div style={
      {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vh'
      }
    }
    id='map-container' ref={mapContainerRef} >
      <button onClick={testBackend}>Test Backend</button>
    </div>
    
  );
}

export default App
