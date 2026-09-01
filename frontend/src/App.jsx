import { useRef,useEffect, useState } from 'react'
import mapboxgl, { Marker } from "mapbox-gl";
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
import '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions.css';
import './App.css'
const API_KEY = import.meta.env.VITE_APP_MAPBOX_API_KEY;
const API_URL = import.meta.env.VITE_APP_API_URL;
import { Field, Fieldset, Input, Label, Legend, Select, Textarea, Button, Tab, TabGroup, TabList,Menu, MenuButton, MenuItem, MenuItems} from '@headlessui/react'


function App() {


  const mapRef = useRef()
  const mapContainerRef = useRef()
  const geocoderRef = useRef()
  const geocoderContainerRef = useRef()
  const currentMarkerRef = useRef();
  const currentDistancePopupRef = useRef();



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

    function animateDashArray(timestamp) {
      const newStep = parseInt((timestamp / 50) % dashArraySequence.length);

      if (newStep !== step) {
        mapRef.current.setPaintProperty(
          'line-dashed',
          'line-dasharray',
          dashArraySequence[step]
        );
        step = newStep;
      }

      requestAnimationFrame(animateDashArray);
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

      const res = await fetch(`${API_URL}/api/service-areas`);
  
      const data = await res.json();


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
      
      <div className='map-container' ref={mapContainerRef}>

            <Fieldset className="overlap overlap-1">
              <Legend className="text-block">Waymo Service Areas</Legend>
              <Label className={"text-block small-text-block"}>an interactive map.</Label>
              <Field>
                
              </Field>
            </Fieldset>

            
      </div>

      <Fieldset className="overlap overlap-2">

          <Field>

                <Button className="button" onClick={() => viewLocation("LA")}>LA</Button>
                <Button className="button" onClick={() => viewLocation("SF")}>SF</Button>
                <Button className="button" onClick={() => viewLocation("Phoenix")}>AZ</Button>
          </Field>
          
          
        </Fieldset>
      
      <Fieldset className={"overlap overlap-3"}>
      <div className='geocoder-container' ref={geocoderContainerRef}></div>


      </Fieldset>
    
    </div>
    
  );
}

export default App
