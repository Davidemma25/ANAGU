import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle, CheckCircle2, LocateFixed, MapPin } from 'lucide-react';
import { adminApi, extractErrorMessage } from '../services/adminApi.js';
import OsmLayerSwitcher from '../components/OsmLayerSwitcher.jsx';
import OsmPlaceSearch from '../components/OsmPlaceSearch.jsx';
import {
  DEFAULT_MAP_CENTER,
  OSM_BASE_LAYERS,
  requestCurrentPosition,
} from '../utils/osmMap.js';

function geoJsonRingToLatLngs(geojson) {
  const ring = geojson?.coordinates?.[0] || [];
  return ring.map(([lng, lat]) => [lat, lng]);
}

export default function AdminGisValidationPage() {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const layerGroupRef = useRef(null);
  const searchMarkerRef = useRef(null);
  const hasFittedParcelsRef = useRef(false);
  const userHasInteractedRef = useRef(false);

  const [layerId, setLayerId] = useState('standard');
  const [locating, setLocating] = useState(false);
  const [parcels, setParcels] = useState([]);
  const [pendingApps, setPendingApps] = useState([]);
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [validating, setValidating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMapData = useCallback(async () => {
    try {
      const { data } = await adminApi.get('/gis/parcels');
      setParcels(data.parcels || []);
      setPendingApps(data.pendingApplications || []);
      if (data.pendingApplications?.length) {
        setSelectedAppId((prev) => prev || data.pendingApplications[0].id);
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load GIS validation queue.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMapData();
  }, [loadMapData]);

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_MAP_CENTER,
      zoom: 15,
      zoomControl: true,
    });

    const baseLayer = OSM_BASE_LAYERS.standard;
    tileLayerRef.current = L.tileLayer(baseLayer.url, {
      attribution: baseLayer.attribution,
      maxZoom: baseLayer.maxZoom,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    layerGroupRef.current = layerGroup;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      layerGroupRef.current = null;
      searchMarkerRef.current = null;
      hasFittedParcelsRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const cfg = OSM_BASE_LAYERS[layerId] || OSM_BASE_LAYERS.standard;
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(map);
    tileLayerRef.current.bringToBack();
  }, [layerId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();
    const bounds = [];

    for (const p of parcels) {
      const latLngs = geoJsonRingToLatLngs(p.boundary_geojson);
      if (latLngs.length < 3) continue;
      const isRevoked = p.status === 'REVOKED';
      const color = isRevoked ? '#dc2626' : p.status === 'ACTIVE' ? '#047857' : '#1f2421';

      const poly = L.polygon(latLngs, {
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.25,
      }).addTo(layerGroup);

      poly.bindPopup(
        `<div style="font-size:12px;line-height:1.4">
          <strong>${p.parcel_code}</strong><br/>
          ${p.parcel_name || ''}<br/>
          Claimant: ${p.claimant_name || ''}<br/>
          Status: <strong>${p.status}</strong><br/>
          Area: ${p.area_sqm} m²
        </div>`
      );
      bounds.push(...latLngs);
    }

    for (const app of pendingApps) {
      const latLngs = geoJsonRingToLatLngs(app.coordinates_geojson);
      if (latLngs.length < 3) continue;
      const isRejected = app.status === 'GIS_REJECTED';
      const isSelected = app.id === selectedAppId;
      const color = isRejected ? '#dc2626' : '#d97706';

      const poly = L.polygon(latLngs, {
        color,
        weight: isSelected ? 3 : 2,
        dashArray: '6 4',
        fillColor: color,
        fillOpacity: isSelected ? 0.25 : 0.12,
      }).addTo(layerGroup);

      poly.bindPopup(
        `<div style="font-size:12px;line-height:1.4">
          <strong>${app.reference_code}</strong><br/>
          ${app.parcel_name}<br/>
          Status: <strong>${app.status}</strong><br/>
          Declared: ${app.declared_area_sqm} m²
        </div>`
      );
      bounds.push(...latLngs);
    }

    if (bounds.length > 0 && !hasFittedParcelsRef.current && !userHasInteractedRef.current) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
      hasFittedParcelsRef.current = true;
    }
  }, [parcels, pendingApps, selectedAppId]);

  const handleSelectPlace = (place) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    userHasInteractedRef.current = true;

    if (searchMarkerRef.current) {
      map.removeLayer(searchMarkerRef.current);
      searchMarkerRef.current = null;
    }
    if (place.boundingBox) {
      map.fitBounds(place.boundingBox, { maxZoom: 17, padding: [24, 24] });
    } else {
      map.setView([place.lat, place.lng], 16);
    }
    searchMarkerRef.current = L.circleMarker([place.lat, place.lng], {
      radius: 7,
      color: '#1F2421',
      weight: 2,
      fillColor: '#FDE878',
      fillOpacity: 0.95,
    })
      .bindPopup(
        `<div style="font-size:12px;"><strong>${place.shortLabel}</strong><br/>${place.displayName}</div>`
      )
      .addTo(map)
      .openPopup();
  };

  const handleFocusApp = (app) => {
    userHasInteractedRef.current = true;
    setSelectedAppId(app.id);
    const map = mapInstanceRef.current;
    const latLngs = geoJsonRingToLatLngs(app.coordinates_geojson);
    if (map && latLngs.length >= 3) {
      map.fitBounds(latLngs, { padding: [48, 48], maxZoom: 17 });
    }
  };

  const handleLocateMe = async () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    setLocating(true);
    setError('');
    try {
      const { lat, lng } = await requestCurrentPosition();
      userHasInteractedRef.current = true;
      map.setView([lat, lng], 16);
    } catch (err) {
      setError(err.message || 'Unable to locate current coordinates.');
    } finally {
      setLocating(false);
    }
  };

  const handleValidate = async (appId) => {
    setError('');
    setValidationResult(null);
    setValidating(true);
    try {
      const { data } = await adminApi.post(`/gis/validate/${appId}`);
      setValidationResult(data);
      await loadMapData();
    } catch (err) {
      if (err.response?.status === 422 && err.response?.data) {
        setValidationResult(err.response.data);
        await loadMapData();
      } else {
        setError(extractErrorMessage(err, 'Failed to execute spatial validation.'));
      }
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1F2421]">
            Administrator GIS Boundary Validation Workbench
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Execute PostGIS ST_IsValid() and ST_Intersects() overlap detection (1.0 m² tolerance) on submitted citizen claims.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600 font-mono tabular-nums">
          <span>Validated Parcels: {parcels.length}</span>
          <span aria-hidden="true">·</span>
          <span>Pending Queue: {pendingApps.length}</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <section className="lg:col-span-3 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span className="font-medium text-[#1F2421] flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#1F2421]" aria-hidden="true" />
              <span>Cadastral Polygon Inspector (WGS84 / SRID 4326)</span>
            </span>
            <span className="text-slate-500">
              Solid: Validated · Dashed Amber: Pending · Dashed Red: Rejected/Revoked
            </span>
          </div>
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
            <OsmPlaceSearch onSelectPlace={handleSelectPlace} />
            <OsmLayerSwitcher activeLayerId={layerId} onChangeLayer={setLayerId} />
          </div>
          <div className="relative">
            <div
              ref={mapContainerRef}
              data-testid="admin-gis-leaflet-map"
              className="h-[430px] w-full bg-slate-100 z-0"
            />
            <button
              type="button"
              onClick={handleLocateMe}
              disabled={locating}
              className="absolute bottom-3 left-3 z-[400] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1F2421] bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-sm disabled:opacity-60 whitespace-nowrap"
            >
              <LocateFixed className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span>{locating ? 'Locating...' : 'Center GPS'}</span>
            </button>
          </div>
        </section>

        <aside className="lg:col-span-2 space-y-4">
          <section className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="font-display text-base font-semibold text-[#1F2421]">
              GIS Validation Queue
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Select a pending application to zoom the map and execute spatial verification.
            </p>

            {loading ? (
              <p className="mt-4 text-xs text-slate-500">Loading validation queue...</p>
            ) : pendingApps.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">
                No pending or rejected applications awaiting GIS validation.
              </p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {pendingApps.map((app) => (
                  <li
                    key={app.id}
                    className={`p-3 rounded-md border text-xs ${
                      selectedAppId === app.id
                        ? 'border-[#1F2421] bg-[#FEF7D1]/50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleFocusApp(app)}
                        className="text-left min-w-0"
                      >
                        <p className="font-mono font-medium text-slate-900 tabular-nums">
                          {app.reference_code}
                        </p>
                        <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">
                          {app.parcel_name}
                        </p>
                        <p className="text-slate-500 mt-0.5">
                          {app.claimant_name} · {app.status}
                        </p>
                      </button>

                      <button
                        type="button"
                        disabled={validating}
                        onClick={() => {
                          setSelectedAppId(app.id);
                          handleValidate(app.id);
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-[#1F2421] hover:bg-black disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
                      >
                        {validating && selectedAppId === app.id ? 'Checking...' : 'Validate Parcel'}
                      </button>
                    </div>
                    {app.rejection_reason && (
                      <p className="mt-2 text-red-700 bg-red-50 border border-red-100 rounded p-2">
                        {app.rejection_reason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {validationResult && (
            <section
              aria-label="GIS Validation Diagnostics"
              className={`border rounded-lg p-5 text-xs space-y-2 ${
                validationResult.passed
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-red-50/80 border-red-200 text-red-950'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-sm">
                {validationResult.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-700" aria-hidden="true" />
                )}
                <span>
                  {validationResult.passed ? 'GIS Validation Passed' : 'GIS Validation Rejected'}
                </span>
              </div>
              <p>{validationResult.message}</p>
              <dl className="grid grid-cols-2 gap-2 pt-2 border-t border-black/10">
                <div>
                  <dt className="opacity-70">ST_IsValid()</dt>
                  <dd className="font-mono font-medium">
                    {String(validationResult.validation?.isValid)}
                  </dd>
                </div>
                <div>
                  <dt className="opacity-70">ST_Intersects() Overlap</dt>
                  <dd className="font-mono font-medium">
                    {String(validationResult.validation?.hasOverlap)}
                  </dd>
                </div>
                <div>
                  <dt className="opacity-70">Computed Area</dt>
                  <dd className="font-mono tabular-nums">
                    {validationResult.validation?.computedAreaSqm ?? '—'} m²
                  </dd>
                </div>
                <div>
                  <dt className="opacity-70">Computed Perimeter</dt>
                  <dd className="font-mono tabular-nums">
                    {validationResult.validation?.computedPerimeterM ?? '—'} m
                  </dd>
                </div>
                <div>
                  <dt className="opacity-70">Execution Time</dt>
                  <dd className="font-mono tabular-nums">{validationResult.validationTimeMs} ms</dd>
                </div>
              </dl>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
