import { useRef,useEffect, useState } from 'react'
import mapboxgl from "mapbox-gl";

import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  async function testBackend() {
    const res = await fetch("http://localhost:3001/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({long: -77, lat: 44}),

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
      center:  [-71.05953, 42.36290],
      zoom: 13,
    });

    return () => {
      mapRef.current.remove()
    }
  }, [])
  return (
    
    
    <div id='map-container' ref={mapContainerRef}>
    </div>
    
  );
}

export default App
