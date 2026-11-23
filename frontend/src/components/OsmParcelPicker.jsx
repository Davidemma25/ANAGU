import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Undo2, Trash2, Crosshair, LocateFixed } from 'lucide-react';
import OsmLayerSwitcher from './OsmLayerSwitcher.jsx';
import OsmPlaceSearch from './OsmPlaceSearch.jsx';
import {
  DEFAULT_MAP_CENTER,
  OSM_BASE_LAYERS,
  computeAreaFromPointsSqm,
  computePerimeterFromPointsM,
  parseRingToLatLngPoints,
  pointsToClosedGeoJsonRing,
  requestCurrentPosition,
} from '../utils/osmMap.js';

function createVertexIcon(index) {
  return L.divIcon({
    className: 'anagu-osm-vertex-icon',
    html: `<div style="width:20px;height:20px;border-radius:9999px;background:#1F2421;color:#FFFFFF;border:2px solid #FDE878;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.35);cursor:grab;">${index + 1}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export default function OsmParcelPicker({
  coordinatesText,
  onChangeCoordinates,
  onSyncAreaSqm,
  focusLocation = null,
  onLocateCoordinates = null,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const drawGroupRef = useRef(null);
  const searchMarkerRef = useRef(null);
  const userLocMarkerRef = useRef(null);

  const [layerId, setLayerId] = useState('standard');
  const [searchLabel, setSearchLabel] = useState('');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');

  const points = useMemo(() => {
    const parsed = parseRingToLatLngPoints(coordinatesText);
    return parsed || [];
  }, [coordinatesText]);

  const pointsRef = useRef(points);
  pointsRef.current = points;

  const onChangeRef = useRef(onChangeCoordinates);
  onChangeRef.current = onChangeCoordinates;

  const onSyncAreaRef = useRef(onSyncAreaSqm);
  onSyncAreaRef.current = onSyncAreaSqm;

  const onLocateRef = useRef(onLocateCoordinates);
  onLocateRef.current = onLocateCoordinates;

  const computedAreaSqm = useMemo(() => computeAreaFromPointsSqm(points), [points]);
  const computedPerimeterM = useMemo(() => computePerimeterFromPointsM(points), [points]);

  const commitPoints = (nextPoints, shouldSyncArea = true) => {
    const ring = pointsToClosedGeoJsonRing(nextPoints);
    onChangeRef.current(
      ring.length > 0 ? JSON.stringify(ring, null, 2) : '[]',
      'MAP_DRAWING'
    );
    if (shouldSyncArea && onSyncAreaRef.current) {
      const area = nextPoints.length >= 3 ? computeAreaFromPointsSqm(nextPoints) : 0;
      onSyncAreaRef.current(area > 0 ? String(area) : '');
    }
  };

  // Mount Leaflet + OpenStreetMap once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialPoints = pointsRef.current;
    const hasFocusLoc =
      focusLocation &&
      Number.isFinite(Number(focusLocation.lat)) &&
      Number.isFinite(Number(focusLocation.lng));
    const initialCenter = hasFocusLoc
      ? [Number(focusLocation.lat), Number(focusLocation.lng)]
      : initialPoints.length > 0
      ? [initialPoints[0].lat, initialPoints[0].lng]
      : DEFAULT_MAP_CENTER;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: hasFocusLoc ? 17 : 16,
      zoomControl: true,
    });

    const baseLayer = OSM_BASE_LAYERS.standard;
    tileLayerRef.current = L.tileLayer(baseLayer.url, {
      attribution: baseLayer.attribution,
      maxZoom: baseLayer.maxZoom,
    }).addTo(map);

    drawGroupRef.current = L.layerGroup().addTo(map);

    map.on('click', (e) => {
      const next = [...pointsRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }];
      commitPoints(next, true);
    });

    mapRef.current = map;

    if (hasFocusLoc) {
      const fLat = Number(focusLocation.lat);
      const fLng = Number(focusLocation.lng);
      const gpsIcon = L.divIcon({
        className: 'anagu-user-location-pin',
        html: '<div style="width:20px;height:20px;border-radius:9999px;background:#047857;border:3px solid #FFFFFF;box-shadow:0 0 0 2px #1F2421, 0 2px 6px rgba(0,0,0,0.35);"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -11],
      });
      userLocMarkerRef.current = L.marker([fLat, fLng], { icon: gpsIcon })
        .bindPopup(
          `<div style="font-size:12px;"><strong>Map Focus</strong><br/>${fLat.toFixed(5)}, ${fLng.toFixed(5)}<br/>This point is not a parcel boundary. Click the map to draw the actual parcel corners.</div>`
        )
        .addTo(map)
        .openPopup();
    } else if (initialPoints.length >= 2) {
      map.fitBounds(
        initialPoints.map((p) => [p.lat, p.lng]),
        { padding: [32, 32], maxZoom: 17 }
      );
    }

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      drawGroupRef.current = null;
      searchMarkerRef.current = null;
      userLocMarkerRef.current = null;
    };
  }, []);

  // Sync map focus pin if focusLocation changes while mounted
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !focusLocation ||
      !Number.isFinite(Number(focusLocation.lat)) ||
      !Number.isFinite(Number(focusLocation.lng))
    ) {
      return;
    }
    const fLat = Number(focusLocation.lat);
    const fLng = Number(focusLocation.lng);
    if (userLocMarkerRef.current) {
      map.removeLayer(userLocMarkerRef.current);
    }
    const gpsIcon = L.divIcon({
      className: 'anagu-user-location-pin',
      html: '<div style="width:20px;height:20px;border-radius:9999px;background:#047857;border:3px solid #FFFFFF;box-shadow:0 0 0 2px #1F2421, 0 2px 6px rgba(0,0,0,0.35);"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -11],
    });
    userLocMarkerRef.current = L.marker([fLat, fLng], { icon: gpsIcon })
      .bindPopup(
      `<div style="font-size:12px;"><strong>Map Focus</strong><br/>${fLat.toFixed(5)}, ${fLng.toFixed(5)}<br/>This point is not a parcel boundary. Click the map to draw the actual parcel corners.</div>`
      )
      .addTo(map)
      .openPopup();
    map.setView([fLat, fLng], 17, { animate: false });
  }, [focusLocation?.lat, focusLocation?.lng]);

  // Swap OpenStreetMap base layer when layerId changes
  useEffect(() => {
    const map = mapRef.current;
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

  // Render polygon/polyline and draggable boundary vertices
  useEffect(() => {
    const map = mapRef.current;
    const group = drawGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    if (points.length === 0) return;

    const latLngs = points.map((p) => [p.lat, p.lng]);

    if (latLngs.length >= 3) {
      L.polygon(latLngs, {
        color: '#1F2421',
        weight: 2.5,
        fillColor: '#1F2421',
        fillOpacity: 0.2,
      }).addTo(group);
    } else if (latLngs.length === 2) {
      L.polyline(latLngs, {
        color: '#1F2421',
        weight: 2.5,
        dashArray: '5 4',
      }).addTo(group);
    }

    points.forEach((pt, idx) => {
      const marker = L.marker([pt.lat, pt.lng], {
        draggable: true,
        icon: createVertexIcon(idx),
        title: `Vertex ${idx + 1} (drag to adjust)`,
      }).addTo(group);

      marker.on('dragend', (evt) => {
        const { lat, lng } = evt.target.getLatLng();
        const updated = pointsRef.current.map((p, i) => (i === idx ? { lat, lng } : p));
        commitPoints(updated, true);
      });
    });
  }, [points]);

  const handleSelectPlace = (place) => {
    const map = mapRef.current;
    if (!map) return;

    setSearchLabel(place.shortLabel);
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
      .bindPopup(`<div style="font-size:12px;"><strong>${place.shortLabel}</strong><br/>Click map corners around this area to trace your parcel.</div>`)
      .addTo(map)
      .openPopup();
  };

  const handleRecenter = () => {
    const map = mapRef.current;
    if (!map) return;
    if (points.length >= 2) {
      map.fitBounds(
        points.map((p) => [p.lat, p.lng]),
        { padding: [32, 32], maxZoom: 17 }
      );
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 17);
    } else {
      map.setView(DEFAULT_MAP_CENTER, 16);
    }
  };

  const handleLocateMe = async () => {
    const map = mapRef.current;
    if (!map) return;
    setGeoError('');
    setLocating(true);
    try {
      const { lat, lng, accuracy } = await requestCurrentPosition();
      if (userLocMarkerRef.current) {
        map.removeLayer(userLocMarkerRef.current);
      }
      const gpsIcon = L.divIcon({
        className: 'anagu-user-location-pin',
        html: '<div style="width:20px;height:20px;border-radius:9999px;background:#047857;border:3px solid #FFFFFF;box-shadow:0 0 0 2px #1F2421, 0 2px 6px rgba(0,0,0,0.35);"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -11],
      });
      userLocMarkerRef.current = L.marker([lat, lng], { icon: gpsIcon })
        .bindPopup(
          `<div style="font-size:12px;"><strong>Your Current Location</strong><br/>${lat.toFixed(5)}, ${lng.toFixed(5)}${accuracy ? ` (±${accuracy} m)` : ''}<br/>This point is not a parcel boundary. Click the map to draw the actual parcel corners.</div>`
        )
        .addTo(map)
        .openPopup();
      map.setView([lat, lng], 17);
      onLocateRef.current?.({ lat, lng, accuracy });
    } catch (err) {
      setGeoError(err.message || 'Unable to determine your current location.');
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <OsmPlaceSearch
          onSelectPlace={handleSelectPlace}
          placeholder="Search OpenStreetMap area to trace parcel (e.g. Yaba, Lagos)..."
        />
        <OsmLayerSwitcher activeLayerId={layerId} onChangeLayer={setLayerId} />
      </div>

      <div
        ref={mapContainerRef}
        data-testid="osm-parcel-picker-map"
        className="h-[340px] w-full bg-slate-100 z-0 cursor-crosshair"
      />

      <div className="px-3.5 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={points.length === 0}
            onClick={() => commitPoints(points.slice(0, -1), true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-45 whitespace-nowrap"
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Undo Point</span>
          </button>
          <button
            type="button"
            disabled={points.length === 0}
            onClick={() => commitPoints([], true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-45 whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clear Boundary</span>
          </button>
          <button
            type="button"
            onClick={handleRecenter}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
          >
            <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Recenter</span>
          </button>
          <button
            type="button"
            onClick={handleLocateMe}
            disabled={locating}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium text-[#1F2421] bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap"
          >
            <LocateFixed className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
            <span>{locating ? 'Locating...' : 'Locate Me'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-slate-600 font-mono tabular-nums">
          <span>
            Vertices: <strong className="text-slate-900">{points.length}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Geodesic Area: <strong className="text-slate-900">{computedAreaSqm.toLocaleString()} m²</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Geodesic Perimeter:{' '}
            <strong className="text-slate-900">{computedPerimeterM.toLocaleString()} m</strong>
          </span>
          {searchLabel && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-sans text-slate-500">Focused: {searchLabel}</span>
            </>
          )}
        </div>
      </div>

      {geoError && (
        <p role="status" className="px-3.5 py-2 text-xs text-red-700 bg-red-50 border-t border-red-200">
          {geoError}
        </p>
      )}
    </div>
  );
}
