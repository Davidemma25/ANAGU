/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import 'leaflet-control-geocoder/dist/Control.Geocoder.css';
import L from 'leaflet';
import { Geocoder, geocoders } from 'leaflet-control-geocoder';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';

const DEFAULT_LOCATION: [number, number] = [6.521, 3.377];

const markerIcon = L.divIcon({
  className: 'anagu-osm-marker',
  html: '<div style="width:16px;height:16px;border-radius:9999px;background:#0F1E36;border:2px solid #FDE878;"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const searchIcon = L.divIcon({
  className: 'anagu-osm-search-marker',
  html: '<div style="width:16px;height:16px;border-radius:9999px;background:#FDE878;border:2px solid #0F1E36;"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const userLocationIcon = L.divIcon({
  className: 'anagu-user-location-pin',
  html: '<div style="width:20px;height:20px;border-radius:9999px;background:#047857;border:3px solid #FFFFFF;box-shadow:0 0 0 2px #0F1E36;"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function GeocoderSearchControl() {
  const map = useMap();

  useEffect(() => {
    let resultMarker: L.Marker | null = null;

    const geocoderControl = new Geocoder({
      defaultMarkGeocode: false,
      collapsed: false,
      position: 'topright',
      placeholder: 'Search location on map...',
      suggestMinLength: 999,
      geocoder: geocoders.nominatim(),
    });

    geocoderControl.on('startsuggest', () => geocoderControl.removeThrobberClass());
    geocoderControl.on('markgeocode', (e) => {
      geocoderControl.removeThrobberClass();
      const { center, bbox, name } = e.geocode;
      if (resultMarker) {
        map.removeLayer(resultMarker);
      }
      if (bbox) {
        map.fitBounds(bbox, { maxZoom: 16 });
      } else {
        map.setView(center, 16);
      }
      resultMarker = L.marker(center, { icon: searchIcon })
        .addTo(map)
        .bindPopup(name)
        .openPopup();
    });

    geocoderControl.addTo(map);
    const alts = geocoderControl.getContainer()?.querySelector('.leaflet-control-geocoder-alternatives');
    const stopBubble = (ev: Event) => ev.stopPropagation();
    alts?.addEventListener('click', stopBubble);

    return () => {
      alts?.removeEventListener('click', stopBubble);
      if (resultMarker) {
        map.removeLayer(resultMarker);
      }
      map.removeControl(geocoderControl);
    };
  }, [map]);

  return null;
}

function LocateUserMarker({ position }: { position: [number, number] | null }) {
  const map = useMap();

  useEffect(() => {
    if (!position) return;
    map.setView(position, 16);
  }, [map, position]);

  if (!position) return null;

  return (
    <Marker
      position={position}
      icon={userLocationIcon}
      eventHandlers={{
        add: (e) => {
          setTimeout(() => e.target.openPopup(), 60);
        },
      }}
    >
      <Popup>
        Your Current Location ({position[0].toFixed(5)}, {position[1].toFixed(5)})
      </Popup>
    </Marker>
  );
}

export function OpenStreetMapBase() {
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    setError('');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos([pos.coords.latitude, pos.coords.longitude]);
        setLocating(false);
      },
      (err) => {
        setError(err.message || 'Unable to retrieve your location.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="space-y-2">
      <div className="relative h-[420px] w-full rounded-md overflow-hidden border border-slate-200">
        <MapContainer center={DEFAULT_LOCATION} zoom={15} scrollWheelZoom={false} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <GeocoderSearchControl />
          <LocateUserMarker position={userPos} />
          <Marker position={DEFAULT_LOCATION} icon={markerIcon}>
            <Popup>ANAGU Default Survey Location (6.521, 3.377)</Popup>
          </Marker>
        </MapContainer>
        <button
          type="button"
          onClick={handleLocateMe}
          disabled={locating}
          className="absolute bottom-3 left-3 z-[400] px-3 py-1.5 text-xs font-medium text-slate-900 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-50"
        >
          {locating ? 'Locating...' : 'Locate Me'}
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export default function App() {
  return (
    <main className="min-h-screen p-6 bg-slate-50">
      <h1 className="text-xl font-semibold text-slate-900 mb-4">ANAGU OpenStreetMap Explorer</h1>
      <OpenStreetMapBase />
    </main>
  );
}
