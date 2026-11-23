import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import 'leaflet-control-geocoder/dist/Control.Geocoder.css';
import L from 'leaflet';
import { LocateFixed } from 'lucide-react';
import { Geocoder, geocoders } from 'leaflet-control-geocoder';
import { MapContainer, TileLayer, Marker, Popup, Polygon, Circle, useMap } from 'react-leaflet';
import {
  buildRegisterHereUrl,
  lookupParcelByCoordinates,
  requestCurrentPosition,
} from '../utils/osmMap.js';

export const DEFAULT_OSM_CENTER: [number, number] = [6.521, 3.377];
export const DEFAULT_OSM_ZOOM = 15;

const SAMPLE_PARCEL_BOUNDS: [number, number][] = [
  [6.52, 3.375],
  [6.52, 3.3765],
  [6.5215, 3.3765],
  [6.5215, 3.375],
];

const defaultPinIcon = L.divIcon({
  className: 'anagu-default-osm-pin',
  html: '<div style="width:18px;height:18px;border-radius:9999px;background:#1F2421;border:3px solid #FDE878;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -10],
});

const searchPinIcon = L.divIcon({
  className: 'anagu-osm-search-pin',
  html: '<div style="width:18px;height:18px;border-radius:9999px;background:#FDE878;border:3px solid #1F2421;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -10],
});

const userLocationIcon = L.divIcon({
  className: 'anagu-user-location-pin',
  html: '<div style="width:20px;height:20px;border-radius:9999px;background:#047857;border:3px solid #FFFFFF;box-shadow:0 0 0 2px #1F2421, 0 2px 6px rgba(0,0,0,0.35);"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -11],
});

function LeafletGeocoderControl() {
  const map = useMap();

  useEffect(() => {
    let searchMarker: L.Marker | null = null;

    const control = new Geocoder({
      defaultMarkGeocode: false,
      collapsed: false,
      position: 'topright',
      placeholder: 'Search location on map...',
      errorMessage: 'No matching OpenStreetMap location found.',
      suggestMinLength: 999,
      geocoder: geocoders.nominatim(),
    });

    control.on('startsuggest', () => control.removeThrobberClass());
    control.on('markgeocode', (e) => {
      control.removeThrobberClass();
      const { center, bbox, name } = e.geocode;
      if (searchMarker) {
        map.removeLayer(searchMarker);
      }

      if (bbox) {
        map.fitBounds(bbox, { maxZoom: 16, padding: [24, 24] });
      } else {
        map.setView(center, 16);
      }

      searchMarker = L.marker(center, { icon: searchPinIcon })
        .addTo(map)
        .bindPopup(`<div style="font-size:12px;line-height:1.4"><strong>${name}</strong></div>`)
        .openPopup();
    });

    control.addTo(map);
    const alts = control.getContainer()?.querySelector('.leaflet-control-geocoder-alternatives');
    const stopBubble = (ev: Event) => ev.stopPropagation();
    alts?.addEventListener('click', stopBubble);

    return () => {
      alts?.removeEventListener('click', stopBubble);
      if (searchMarker) {
        map.removeLayer(searchMarker);
      }
      map.removeControl(control);
    };
  }, [map]);

  return null;
}

interface ParcelLookupResult {
  matched: boolean;
  matchType: 'REGISTERED_PARCEL' | 'PENDING_APPLICATION' | 'INSTITUTIONAL_RECORD' | 'UNCLAIMED';
  parcelCode: string | null;
  referenceCode: string | null;
  parcelName: string | null;
  status: string | null;
  areaSqm: number | null;
  region: string | null;
  source: string | null;
}

interface UserLocationState {
  lat: number;
  lng: number;
  accuracy: number | null;
  lookup: ParcelLookupResult | null;
  nonce: number;
}

function UserLocationController({
  userLocation,
  onRegisterHere,
}: {
  userLocation: UserLocationState | null;
  onRegisterHere: (url: string) => void;
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!userLocation) return;
    map.setView([userLocation.lat, userLocation.lng], 16, { animate: false });
    const timer = setTimeout(() => {
      markerRef.current?.openPopup();
    }, 50);
    return () => clearTimeout(timer);
  }, [map, userLocation]);

  if (!userLocation) return null;

  const lookup = userLocation.lookup;
  const registerUrl = buildRegisterHereUrl(userLocation.lat, userLocation.lng);

  return (
    <>
      {userLocation.accuracy && userLocation.accuracy > 0 && (
        <Circle
          center={[userLocation.lat, userLocation.lng]}
          radius={Math.min(userLocation.accuracy, 500)}
          pathOptions={{
            color: '#047857',
            weight: 1.5,
            fillColor: '#10b981',
            fillOpacity: 0.12,
          }}
        />
      )}
      <Marker
        key={`${userLocation.nonce}-${userLocation.lat}-${userLocation.lng}`}
        ref={markerRef}
        position={[userLocation.lat, userLocation.lng]}
        icon={userLocationIcon}
        eventHandlers={{
          add: (e) => {
            setTimeout(() => e.target.openPopup(), 60);
          },
        }}
      >
        <Popup maxWidth={260}>
          <div className="text-xs leading-snug space-y-1.5 min-w-[200px]">
            <div>
              <strong>Your Current Location</strong>
              <br />
              <span className="font-mono tabular-nums text-slate-600">
                {userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}
              </span>
              {userLocation.accuracy ? ` (±${userLocation.accuracy} m)` : ''}
            </div>

            {lookup && (
              <div className="pt-1.5 border-t border-slate-200">
                {lookup.parcelCode ? (
                  <>
                    <div className="text-[11px] text-slate-500">
                      {lookup.matchType === 'INSTITUTIONAL_RECORD'
                        ? 'Reference Parcel Record'
                        : 'Registered Parcel Code'}
                    </div>
                    <div className="font-mono font-bold text-[#1F2421] text-sm">
                      {lookup.parcelCode}
                    </div>
                    {lookup.parcelName && (
                      <div className="text-slate-700">{lookup.parcelName}</div>
                    )}
                    <div className="text-[11px] text-slate-500">
                      Status: <strong className="text-slate-800">{lookup.status}</strong>
                      {lookup.areaSqm ? ` · ${lookup.areaSqm.toLocaleString()} m²` : ''}
                    </div>
                  </>
                ) : lookup.matchType === 'PENDING_APPLICATION' ? (
                  <>
                    <div className="text-[11px] text-amber-800 font-medium">
                      Pending GIS Validation
                    </div>
                    <div className="font-mono font-semibold text-slate-900">
                      {lookup.referenceCode}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Parcel code is assigned once the Administrator validates this application.
                    </div>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-slate-700 font-medium">
                      No registered parcel at this location.
                    </div>
                    <button
                      type="button"
                      onClick={() => onRegisterHere(registerUrl)}
                      className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium text-white bg-[#1F2421] hover:bg-black rounded whitespace-nowrap"
                    >
                      Register New Parcel Here
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Popup>
      </Marker>
    </>
  );
}

interface OpenStreetMapBaseProps {
  center?: [number, number];
  zoom?: number;
  className?: string;
  onNavigate?: (url: string) => void;
}

export function OpenStreetMapBase({
  center = DEFAULT_OSM_CENTER,
  zoom = DEFAULT_OSM_ZOOM,
  className = 'h-[380px] w-full',
  onNavigate,
}: OpenStreetMapBaseProps) {
  const [userLocation, setUserLocation] = useState<UserLocationState | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  const handleNavigate = (url: string) => {
    if (onNavigate) {
      onNavigate(url);
    } else if (typeof window !== 'undefined') {
      window.location.assign(url);
    }
  };

  const handleLocateMe = async () => {
    setLocationError('');
    setLocating(true);
    try {
      const coords = await requestCurrentPosition();
      const lookup = await lookupParcelByCoordinates(coords.lat, coords.lng);
      setUserLocation((prev) => ({
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
        lookup,
        nonce: (prev?.nonce || 0) + 1,
      }));
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Unable to determine your location.');
    } finally {
      setLocating(false);
    }
  };

  const registerUrl = userLocation
    ? buildRegisterHereUrl(userLocation.lat, userLocation.lng)
    : '/register';

  return (
    <div className="space-y-3">
      <div
        data-testid="default-osm-react-leaflet-map"
        className="relative border border-slate-200 rounded-md overflow-hidden bg-slate-100"
      >
        <MapContainer
          center={center}
          zoom={zoom}
          scrollWheelZoom={false}
          className={`${className} z-0`}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <LeafletGeocoderControl />
          <UserLocationController
            userLocation={userLocation}
            onRegisterHere={handleNavigate}
          />
          <Polygon
            positions={SAMPLE_PARCEL_BOUNDS}
            pathOptions={{
              color: '#1F2421',
              weight: 2,
              fillColor: '#047857',
              fillOpacity: 0.22,
            }}
          >
            <Popup>
              <div className="text-xs leading-snug">
                <strong>Sample Cadastral Zone · ANG-PARCEL-1001</strong>
                <br />
                WGS84 / SRID 4326 Reference Plot
              </div>
            </Popup>
          </Polygon>
          <Marker position={center} icon={defaultPinIcon}>
            <Popup>
              <div className="text-xs leading-snug">
                <strong>ANAGU Default Survey Origin</strong>
                <br />
                Lat {center[0].toFixed(3)}, Lng {center[1].toFixed(3)} (Yaba, Lagos)
              </div>
            </Popup>
          </Marker>
        </MapContainer>

        <button
          type="button"
          onClick={handleLocateMe}
          disabled={locating}
          className="absolute bottom-3 left-3 z-[400] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1F2421] bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-sm disabled:opacity-60 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1F2421]"
        >
          <LocateFixed className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
          <span>{locating ? 'Locating...' : 'Locate Me'}</span>
        </button>
      </div>

      {userLocation && userLocation.lookup && (
        <div
          data-testid="landing-location-lookup-result"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-md text-xs"
        >
          <div className="space-y-0.5">
            <p className="text-slate-500 font-mono tabular-nums">
              Location: {userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}
              {userLocation.accuracy ? ` (±${userLocation.accuracy} m)` : ''}
            </p>
            {userLocation.lookup.parcelCode ? (
              <p className="text-sm font-medium text-slate-900">
                Parcel Code:{' '}
                <span className="font-mono font-bold text-[#1F2421]">
                  {userLocation.lookup.parcelCode}
                </span>
                {userLocation.lookup.status ? (
                  <span className="text-xs font-normal text-slate-600">
                    {' '}
                    · {userLocation.lookup.status}
                    {userLocation.lookup.areaSqm
                      ? ` · ${userLocation.lookup.areaSqm.toLocaleString()} m²`
                      : ''}
                  </span>
                ) : null}
              </p>
            ) : userLocation.lookup.matchType === 'PENDING_APPLICATION' ? (
              <p className="text-sm font-medium text-slate-900">
                Pending Application:{' '}
                <span className="font-mono font-bold text-amber-800">
                  {userLocation.lookup.referenceCode}
                </span>{' '}
                <span className="text-xs font-normal text-slate-600">
                  · Awaiting Administrator GIS validation to assign Parcel Code
                </span>
              </p>
            ) : (
              <p className="text-sm font-medium text-slate-900">
                No registered parcel found at your current coordinates.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {userLocation.lookup.parcelCode ||
            userLocation.lookup.matchType === 'PENDING_APPLICATION' ? (
              <button
                type="button"
                onClick={() => handleNavigate('/gis-map')}
                className="px-3.5 py-2 text-xs font-medium text-white bg-[#1F2421] hover:bg-black rounded-xs whitespace-nowrap transition-colors"
              >
                Open Map Explorer
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleNavigate(registerUrl)}
                className="px-3.5 py-2 text-xs font-medium text-white bg-[#1F2421] hover:bg-black rounded-xs whitespace-nowrap transition-colors"
              >
                Register New Parcel Here
              </button>
            )}
          </div>
        </div>
      )}

      {locationError && (
        <p role="status" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {locationError}
        </p>
      )}
    </div>
  );
}

export default OpenStreetMapBase;
