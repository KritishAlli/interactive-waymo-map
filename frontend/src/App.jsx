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
    mapboxgl.accessToken = "pk.eyJ1Ijoia3JpYWxsaSIsImEiOiJjbWpnOWx3NnUxMGFkM2ZwcTJyNnFuODdrIn0.NjMSIQJ7akqZbeDkHkOmWg";
    

     mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      center:  [-118.439789907, 34.06999972],
      zoom: 13,
    });


    mapRef.current.on('load', async () => {

      const res = await fetch("http://localhost:3001/api/service-areas");
  
      const data = await res.json();
      console.log(data.serviceAreas[0]);


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
        'id': data.serviceAreas[i].city,
        'type': 'fill',
        'source': data.serviceAreas[i].city, // reference the data source
        'layout': {},
        'paint': {
            'fill-color': '#0080ff', // blue color fill
            'fill-opacity': 0.5
        }
    });  
    }

      // Add a new layer to visualize the polygon.
      
  
    }
  );
  
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
    }>
      
        
      
      <div style={{padding: '1rem'}}>
        <button onClick={testBackend}>Test Backend</button>
      </div>

      <div id='map-container' ref={mapContainerRef} style={{flex: 1}}>

      </div>
    </div>
    
  );
}

export default App
