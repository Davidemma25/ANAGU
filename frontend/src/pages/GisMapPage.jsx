import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  Eraser,
  LocateFixed,
  MapPin,
  Maximize2,
  Pencil,
  Ruler,
  Square,
  Trash2,
} from 'lucide-react';
import { api } from '../services/api.js';
import OsmLayerSwitcher from '../components/OsmLayerSwitcher.jsx';
import OsmPlaceSearch from '../components/OsmPlaceSearch.jsx';
import {
  DEFAULT_MAP_CENTER,
  OSM_BASE_LAYERS,
  buildRegisterHereUrl,
  computeGeodesicAreaSqm,
  computeGeodesicPerimeterM,
  findLocalParcelMatch,
  lookupParcelByCoordinates,
  parseRingToLatLngPoints,
  pointsToClosedGeoJsonRing,
  requestCurrentPosition,
} from '../utils/osmMap.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function geoJsonRingToLatLngs(geojson) {
  const ring = geojson?.coordinates?.[0] || [];
  return ring.map(([lng, lat]) => [lat, lng]);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sqmToHa(sqm) {
  return (Number(sqm) / 10000).toFixed(4);
}

function sqmToAcres(sqm) {
  return (Number(sqm) / 4046.856).toFixed(4);
}

function formatArea(sqm) {
  const n = Number(sqm);
  if (!n) return '—';
  if (n >= 10000) return `${sqmToHa(n)} ha (${n.toLocaleString()} m²)`;
  return `${n.toLocaleString()} m²`;
}

function formatPerimeter(m) {
  const n = Number(m);
  if (!n) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(3)} km` : `${n.toFixed(1)} m`;
}

/** Extract a closed GeoJSON ring from a Leaflet layer (Polygon or Rectangle). */
function layerToGeoJsonRing(layer) {
  const latLngs = layer.getLatLngs?.()[0] ?? layer.getLatLngs?.() ?? [];
  const flat = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;
  const coords = flat.map((ll) => [
    parseFloat(ll.lng.toFixed(7)),
    parseFloat(ll.lat.toFixed(7)),
  ]);
  if (coords.length >= 3) {
    const [fx, fy] = coords[0];
    const [lx, ly] = coords[coords.length - 1];
    if (fx !== lx || fy !== ly) coords.push([fx, fy]);
  }
  return coords;
}

/** Pretty-print a GeoJSON Polygon for the textarea. */
function ringToGeoJsonString(ring) {
  return JSON.stringify({ type: 'Polygon', coordinates: [ring] }, null, 2);
}

// ─── measurements badge ─────────────────────────────────────────────────────

function MeasurementsBadge({ areaSqm, perimeterM, vertexCount }) {
  if (!areaSqm) return null;
  return (
    <div className="absolute bottom-14 left-3 z-[400] bg-white/95 border border-[#1F2421]/20 rounded-md shadow-sm px-3 py-2 text-xs space-y-0.5 pointer-events-none">
      <div className="flex items-center gap-1.5 text-[#1F2421] font-semibold">
        <Ruler className="w-3 h-3 text-emerald-700" aria-hidden="true" />
        <span>Live Measurements</span>
      </div>
      <div className="font-mono tabular-nums text-slate-700">
        Area: <span className="font-semibold text-[#1F2421]">{formatArea(areaSqm)}</span>
      </div>
      <div className="font-mono tabular-nums text-slate-700">
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{sqmToHa(areaSqm)} ha · {sqmToAcres(areaSqm)} acres
      </div>
      <div className="font-mono tabular-nums text-slate-700">
        Perimeter: <span className="font-semibold text-[#1F2421]">{formatPerimeter(perimeterM)}</span>
      </div>
      {vertexCount > 0 && (
        <div className="text-slate-500">Vertices: {vertexCount}</div>
      )}
    </div>
  );
}

// ─── draw toolbar ────────────────────────────────────────────────────────────

function DrawToolbar({ mode, onPolygon, onRectangle, onEdit, onDelete, onClear, hasDrawn, isEditing }) {
  return (
    <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1.5">
      <button
        type="button"
        title="Draw Polygon"
        onClick={onPolygon}
        className={`w-9 h-9 rounded-md border flex items-center justify-center shadow-sm transition-colors ${
          mode === 'polygon'
            ? 'bg-[#1F2421] text-[#FDE878] border-[#1F2421]'
            : 'bg-white text-[#1F2421] border-slate-300 hover:bg-[#FDE878]'
        }`}
      >
        <Pencil className="w-4 h-4" aria-hidden="true" />
      </button>

      <button
        type="button"
        title="Draw Rectangle"
        onClick={onRectangle}
        className={`w-9 h-9 rounded-md border flex items-center justify-center shadow-sm transition-colors ${
          mode === 'rectangle'
            ? 'bg-[#1F2421] text-[#FDE878] border-[#1F2421]'
            : 'bg-white text-[#1F2421] border-slate-300 hover:bg-[#FDE878]'
        }`}
      >
        <Square className="w-4 h-4" aria-hidden="true" />
      </button>

      {hasDrawn && (
        <>
          <div className="border-t border-slate-200 my-0.5" />
          <button
            type="button"
            title="Edit vertices"
            onClick={onEdit}
            className={`w-9 h-9 rounded-md border flex items-center justify-center shadow-sm transition-colors ${
              isEditing
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-[#1F2421] border-slate-300 hover:bg-blue-50'
            }`}
          >
            <Maximize2 className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            title="Delete shape"
            onClick={onDelete}
            className="w-9 h-9 rounded-md border bg-white text-red-600 border-slate-300 hover:bg-red-50 flex items-center justify-center shadow-sm transition-colors"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            title="Clear all"
            onClick={onClear}
            className="w-9 h-9 rounded-md border bg-white text-slate-500 border-slate-300 hover:bg-slate-100 flex items-center justify-center shadow-sm transition-colors"
          >
            <Eraser className="w-4 h-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}

// ─── boundary panel ──────────────────────────────────────────────────────────

function BoundaryPanel({ drawnRing, onImport, onClear, onUseForApplication }) {
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const areaSqm = drawnRing ? computeGeodesicAreaSqm(drawnRing) : 0;
  const perimeterM = drawnRing ? computeGeodesicPerimeterM(drawnRing) : 0;

  const handleImport = () => {
    setImportError('');
    const pts = parseRingToLatLngPoints(importText.trim());
    if (!pts || pts.length < 3) {
      setImportError('Invalid GeoJSON or coordinate array. Need ≥ 3 [lng, lat] points.');
      return;
    }
    const ring = pointsToClosedGeoJsonRing(pts);
    onImport(ring);
    setImportText('');
  };

  const handleCopy = async () => {
    if (!drawnRing) return;
    try {
      await navigator.clipboard.writeText(ringToGeoJsonString(drawnRing));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable
    }
  };

  const handleDownload = () => {
    if (!drawnRing) return;
    const blob = new Blob([ringToGeoJsonString(drawnRing)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'anagu-parcel-boundary.geojson';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setPanelOpen((p) => !p)}
        className="w-full px-4 py-3 flex items-center justify-between text-left border-b border-slate-200 hover:bg-slate-50 transition-colors"
      >
        <h2 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Pencil className="w-3.5 h-3.5 text-[#1F2421]" aria-hidden="true" />
          <span>Draw &amp; Measure Parcel Boundary</span>
        </h2>
        {panelOpen ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {panelOpen && (
        <div className="p-4 space-y-4 text-xs text-slate-700">
          {/* Instructions */}
          <div className="bg-[#FEF9DB] border border-[#E5CF5D] rounded-md p-3 space-y-1.5">
            <p className="font-semibold text-[#1F2421]">How to draw a boundary:</p>
            <ol className="list-decimal pl-4 space-y-0.5 text-[#2D312E]">
              <li>Click <strong>✏ Draw Polygon</strong> (top-right of map)</li>
              <li>Click each corner of your land parcel</li>
              <li>Double-click or click the first point to close the shape</li>
              <li>Use <strong>⬜ Rectangle</strong> for quick rectangular plots</li>
              <li>Edit vertices with the <strong>⤢ Edit</strong> button</li>
            </ol>
          </div>

          {/* Live stats */}
          {drawnRing && areaSqm > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 space-y-1">
              <p className="font-semibold text-emerald-900 flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5" aria-hidden="true" />
                Drawn Parcel Measurements
              </p>
              <div className="font-mono tabular-nums space-y-0.5 text-emerald-800">
                <div>Area: <strong>{formatArea(areaSqm)}</strong></div>
                <div className="text-emerald-700 pl-4">
                  {sqmToHa(areaSqm)} hectares · {sqmToAcres(areaSqm)} acres
                </div>
                <div>Perimeter: <strong>{formatPerimeter(perimeterM)}</strong></div>
                <div>Vertices: {drawnRing.length - 1} corners</div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {drawnRing && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium transition-colors"
              >
                <Clipboard className="w-3.5 h-3.5" aria-hidden="true" />
                {copied ? 'Copied!' : 'Copy GeoJSON'}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium transition-colors"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Download .geojson
              </button>
              <button
                type="button"
                onClick={onClear}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Clear
              </button>
              {onUseForApplication && (
                <button
                  type="button"
                  onClick={() => onUseForApplication(drawnRing)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1F2421] text-white hover:bg-black font-semibold transition-colors"
                >
                  Use for Application →
                </button>
              )}
            </div>
          )}

          {/* GeoJSON preview */}
          {drawnRing && (
            <details className="text-[11px]">
              <summary className="cursor-pointer font-medium text-slate-600 hover:text-[#1F2421] select-none">
                View GeoJSON
              </summary>
              <pre className="mt-2 p-2 bg-slate-100 rounded text-[10px] font-mono overflow-x-auto text-slate-700 max-h-40 leading-relaxed">
                {ringToGeoJsonString(drawnRing)}
              </pre>
            </details>
          )}

          {/* Import coordinates */}
          <div className="border-t border-slate-200 pt-3 space-y-2">
            <p className="font-medium text-slate-700">
              Or paste GeoJSON / coordinate array:
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={4}
              placeholder={'[[3.377, 6.521], [3.380, 6.521], [3.380, 6.518], [3.377, 6.518]]'}
              className="w-full px-2.5 py-2 text-[11px] font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421] resize-y"
            />
            {importError && (
              <p className="text-red-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                {importError}
              </p>
            )}
            <button
              type="button"
              onClick={handleImport}
              disabled={!importText.trim()}
              className="px-3 py-1.5 rounded-md bg-[#1F2421] text-white text-xs font-semibold disabled:opacity-50 hover:bg-black transition-colors"
            >
              Preview on Map
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function GisMapPage() {
  const navigate = useNavigate();

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const parcelLayerGroupRef = useRef(null);
  const drawLayerRef = useRef(null);        // FeatureGroup for drawn shapes
  const drawControlRef = useRef(null);      // Leaflet.Draw control instance
  const searchMarkerRef = useRef(null);
  const userLocationLayerRef = useRef(null);
  const hasFittedParcelsRef = useRef(false);
  const userHasInteractedRef = useRef(false);

  const [layerId, setLayerId] = useState('standard');
  const [locating, setLocating] = useState(false);
  const [locationLookup, setLocationLookup] = useState(null);
  const [parcels, setParcels] = useState([]);
  const [pendingApps, setPendingApps] = useState([]);
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Drawing state
  const [drawMode, setDrawMode] = useState(null);   // 'polygon' | 'rectangle' | null
  const [isEditing, setIsEditing] = useState(false);
  const [drawnRing, setDrawnRing] = useState(null); // closed GeoJSON ring
  const [liveMeasure, setLiveMeasure] = useState({ areaSqm: 0, perimeterM: 0, vertexCount: 0 });

  // ── load parcel data ──────────────────────────────────────────────────────

  const loadMapData = useCallback(async () => {
    try {
      const { data } = await api.get('/gis/parcels');
      setParcels(data.parcels || []);
      setPendingApps(data.pendingApplications || []);
      if (data.pendingApplications?.length) {
        setSelectedAppId((prev) => prev || data.pendingApplications[0].id);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load GIS parcel boundaries.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMapData();
  }, [loadMapData]);

  // ── mount Leaflet map ─────────────────────────────────────────────────────

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

    // Layer group for existing parcels
    const parcelGroup = L.layerGroup().addTo(map);
    parcelLayerGroupRef.current = parcelGroup;

    // FeatureGroup that Leaflet.Draw places new shapes into
    const drawLayer = new L.FeatureGroup().addTo(map);
    drawLayerRef.current = drawLayer;
    mapInstanceRef.current = map;

    // ── Leaflet.Draw control ───────────────────────────────────────────────
    const drawControl = new L.Control.Draw({
      position: 'topright',
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: {
            color: '#047857',
            weight: 2.5,
            fillColor: '#10b981',
            fillOpacity: 0.25,
          },
          guideLayers: [drawLayer],
        },
        rectangle: {
          shapeOptions: {
            color: '#047857',
            weight: 2.5,
            fillColor: '#10b981',
            fillOpacity: 0.25,
          },
        },
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: {
        featureGroup: drawLayer,
        remove: true,
      },
    });

    // Hide the native Leaflet.Draw toolbar — we use our own buttons
    drawControl.addTo(map);
    drawControlRef.current = drawControl;

    // Hide the native toolbar div after adding
    const nativeToolbar = map
      .getContainer()
      ?.querySelector('.leaflet-draw-toolbar');
    if (nativeToolbar) nativeToolbar.style.display = 'none';
    const editToolbar = map
      .getContainer()
      ?.querySelector('.leaflet-draw-edit-toolbar');
    if (editToolbar) editToolbar.style.display = 'none';

    // ── Draw events ────────────────────────────────────────────────────────

    map.on(L.Draw.Event.CREATED, (e) => {
      // Clear any previous drawing first
      drawLayer.clearLayers();
      const layer = e.layer;
      drawLayer.addLayer(layer);

      const ring = layerToGeoJsonRing(layer);
      setDrawnRing(ring);
      const areaSqm = computeGeodesicAreaSqm(ring);
      const perimeterM = computeGeodesicPerimeterM(ring);
      setLiveMeasure({ areaSqm, perimeterM, vertexCount: ring.length - 1 });
      setDrawMode(null);
    });

    map.on(L.Draw.Event.DRAWVERTEX, () => {
      // Live update while drawing polygon
      const pts = [];
      map.eachLayer((l) => {
        if (l instanceof L.Marker && l._latlng) {
          pts.push([l._latlng.lng, l._latlng.lat]);
        }
      });
      if (pts.length >= 2) {
        const tempRing = [...pts, pts[0]];
        const areaSqm = computeGeodesicAreaSqm(tempRing);
        const perimeterM = computeGeodesicPerimeterM(tempRing);
        setLiveMeasure({ areaSqm, perimeterM, vertexCount: pts.length });
      }
    });

    map.on(L.Draw.Event.EDITED, () => {
      drawLayer.eachLayer((l) => {
        const ring = layerToGeoJsonRing(l);
        setDrawnRing(ring);
        setLiveMeasure({
          areaSqm: computeGeodesicAreaSqm(ring),
          perimeterM: computeGeodesicPerimeterM(ring),
          vertexCount: ring.length - 1,
        });
      });
      setIsEditing(false);
    });

    map.on(L.Draw.Event.DELETED, () => {
      setDrawnRing(null);
      setLiveMeasure({ areaSqm: 0, perimeterM: 0, vertexCount: 0 });
      setIsEditing(false);
    });

    map.on(L.Draw.Event.DRAWSTART, (e) => {
      setDrawMode(e.layerType);
    });

    map.on(L.Draw.Event.DRAWSTOP, () => {
      setDrawMode(null);
    });

    map.on('movestart', () => {
      userHasInteractedRef.current = true;
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      parcelLayerGroupRef.current = null;
      drawLayerRef.current = null;
      drawControlRef.current = null;
      searchMarkerRef.current = null;
      userLocationLayerRef.current = null;
      hasFittedParcelsRef.current = false;
    };
  }, []);

  // ── swap base layer ───────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    const cfg = OSM_BASE_LAYERS[layerId] || OSM_BASE_LAYERS.standard;
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(map);
    tileLayerRef.current.bringToBack();
  }, [layerId]);

  // ── render parcel polygons ────────────────────────────────────────────────

  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = parcelLayerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();
    const bounds = [];

    for (const p of parcels) {
      const latLngs = geoJsonRingToLatLngs(p.boundary_geojson);
      if (latLngs.length < 3) continue;
      const isRevoked = p.status === 'REVOKED';
      const color = isRevoked ? '#dc2626' : '#047857';

      const poly = L.polygon(latLngs, {
        color,
        weight: 2.5,
        fillColor: color,
        fillOpacity: 0.22,
      }).addTo(layerGroup);

      poly.bindPopup(
        `<div style="font-size:12px;line-height:1.6;min-width:180px">
          <strong style="font-size:13px">${escapeHtml(p.parcel_code)}</strong><br/>
          <span style="color:#475569">${escapeHtml(p.parcel_name || '')}</span><br/>
          Claimant: ${escapeHtml(p.claimant_name || '—')}<br/>
          Status: <strong style="color:${isRevoked ? '#b91c1c' : '#047857'}">${escapeHtml(p.status)}</strong><br/>
          Area: ${Number(p.area_sqm).toLocaleString()} m²
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
        dashArray: '7 4',
        fillColor: color,
        fillOpacity: isSelected ? 0.22 : 0.1,
      }).addTo(layerGroup);

      poly.bindPopup(
        `<div style="font-size:12px;line-height:1.6;min-width:180px">
          <strong style="font-size:13px">${escapeHtml(app.reference_code)}</strong><br/>
          <span style="color:#475569">${escapeHtml(app.parcel_name)}</span><br/>
          Status: <strong style="color:${isRejected ? '#b91c1c' : '#92400e'}">${escapeHtml(app.status)}</strong><br/>
          Declared: ${Number(app.declared_area_sqm).toLocaleString()} m²
        </div>`
      );
      bounds.push(...latLngs);
    }

    if (bounds.length > 0 && !hasFittedParcelsRef.current && !userHasInteractedRef.current) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
      hasFittedParcelsRef.current = true;
    }
  }, [parcels, pendingApps, selectedAppId]);

  // ── draw control handlers ─────────────────────────────────────────────────

  const startDrawPolygon = () => {
    const map = mapInstanceRef.current;
    const drawControl = drawControlRef.current;
    if (!map || !drawControl) return;
    // Stop any active editing
    if (isEditing) {
      drawLayerRef.current?.editLayer?.disable?.();
      setIsEditing(false);
    }
    if (drawMode === 'polygon') {
      map.fire('draw:drawstop');
      return;
    }
    new L.Draw.Polygon(map, drawControl.options.draw.polygon).enable();
  };

  const startDrawRectangle = () => {
    const map = mapInstanceRef.current;
    const drawControl = drawControlRef.current;
    if (!map || !drawControl) return;
    if (isEditing) {
      drawLayerRef.current?.editLayer?.disable?.();
      setIsEditing(false);
    }
    if (drawMode === 'rectangle') {
      map.fire('draw:drawstop');
      return;
    }
    new L.Draw.Rectangle(map, drawControl.options.draw.rectangle).enable();
  };

  const startEditVertices = () => {
    const drawLayer = drawLayerRef.current;
    if (!drawLayer) return;
    if (isEditing) {
      drawLayer.eachLayer((l) => l.editing?.disable?.());
      setIsEditing(false);
    } else {
      drawLayer.eachLayer((l) => l.editing?.enable?.());
      setIsEditing(true);
    }
  };

  const deleteDrawn = () => {
    if (!drawLayerRef.current) return;
    drawLayerRef.current.clearLayers();
    setDrawnRing(null);
    setLiveMeasure({ areaSqm: 0, perimeterM: 0, vertexCount: 0 });
    setIsEditing(false);
  };

  const clearAll = deleteDrawn;

  /** Import a GeoJSON ring from the paste panel → draw on map */
  const handleImportRing = useCallback((ring) => {
    const map = mapInstanceRef.current;
    const drawLayer = drawLayerRef.current;
    if (!map || !drawLayer) return;

    drawLayer.clearLayers();
    const latLngs = ring.map(([lng, lat]) => [lat, lng]);
    const poly = L.polygon(latLngs, {
      color: '#047857',
      weight: 2.5,
      fillColor: '#10b981',
      fillOpacity: 0.25,
    });
    drawLayer.addLayer(poly);

    const areaSqm = computeGeodesicAreaSqm(ring);
    const perimeterM = computeGeodesicPerimeterM(ring);
    setDrawnRing(ring);
    setLiveMeasure({ areaSqm, perimeterM, vertexCount: ring.length - 1 });

    if (latLngs.length >= 3) {
      map.fitBounds(poly.getBounds(), { padding: [36, 36], maxZoom: 17 });
      userHasInteractedRef.current = true;
    }
  }, []);

  /** Pre-fill the register/application page with the drawn boundary */
  const handleUseForApplication = (ring) => {
    const geoJsonStr = JSON.stringify({ type: 'Polygon', coordinates: [ring] });
    navigate(`/applications?tab=new&prefill=${encodeURIComponent(geoJsonStr)}`);
  };

  // ── place search ──────────────────────────────────────────────────────────

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
        `<div style="font-size:12px"><strong>${place.shortLabel}</strong><br/>${place.displayName}</div>`
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

  // ── locate me ─────────────────────────────────────────────────────────────

  const handleLocateMe = async () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    userHasInteractedRef.current = true;
    setError('');
    setLocating(true);
    try {
      const { lat, lng, accuracy } = await requestCurrentPosition();
      const apiLookup = await lookupParcelByCoordinates(lat, lng);
      const localLookup = findLocalParcelMatch(lat, lng, parcels, pendingApps);
      const lookup =
        apiLookup?.matched ? apiLookup : localLookup.matched ? localLookup : apiLookup || localLookup;
      const registerUrl = buildRegisterHereUrl(lat, lng);

      setLocationLookup({ lat, lng, accuracy, lookup, registerUrl });

      if (userLocationLayerRef.current) map.removeLayer(userLocationLayerRef.current);
      const group = L.layerGroup().addTo(map);

      if (accuracy && accuracy > 0) {
        L.circle([lat, lng], {
          radius: Math.min(accuracy, 500),
          color: '#047857',
          weight: 1.5,
          fillColor: '#10b981',
          fillOpacity: 0.12,
        }).addTo(group);
      }

      const gpsIcon = L.divIcon({
        className: '',
        html: '<div style="width:20px;height:20px;border-radius:9999px;background:#047857;border:3px solid #FFFFFF;box-shadow:0 0 0 2px #1F2421,0 2px 6px rgba(0,0,0,.35)"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -11],
      });

      let lookupHtml = '';
      if (lookup?.parcelCode) {
        lookupHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0">
          <div style="font-size:11px;color:#64748b">Registered Parcel</div>
          <div style="font-family:monospace;font-weight:700;color:#1F2421">${escapeHtml(lookup.parcelCode)}</div>
          ${lookup.parcelName ? `<div>${escapeHtml(lookup.parcelName)}</div>` : ''}
          <div style="font-size:11px;color:#475569">Status: <strong>${escapeHtml(lookup.status)}</strong></div>
        </div>`;
      } else if (lookup?.matchType === 'PENDING_APPLICATION') {
        lookupHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0">
          <div style="font-size:11px;color:#92400e;font-weight:600">Application submitted</div>
          <div style="font-family:monospace;font-weight:700;color:#1F2421">${escapeHtml(lookup.referenceCode)}</div>
        </div>`;
      } else {
        lookupHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0">
          <strong>No registered parcel here.</strong><br/>
          <button type="button" data-reg-url="${escapeHtml(registerUrl)}" style="margin-top:5px;padding:3px 10px;font-size:11px;font-weight:600;color:#fff;background:#1F2421;border:none;border-radius:4px;cursor:pointer">Register Land Here</button>
        </div>`;
      }

      const marker = L.marker([lat, lng], { icon: gpsIcon })
        .bindPopup(
          `<div style="font-size:12px;line-height:1.5;max-width:240px">
            <strong>Your Location</strong><br/>
            <span style="font-family:monospace">${lat.toFixed(5)}, ${lng.toFixed(5)}${accuracy ? ` (±${accuracy} m)` : ''}</span>
            ${lookupHtml}
          </div>`,
          { maxWidth: 260, autoPanPadding: [24, 24] }
        )
        .addTo(group);

      marker.on('popupopen', (evt) => {
        const btn = evt.popup?.getElement()?.querySelector('[data-reg-url]');
        if (btn) btn.addEventListener('click', () => navigate(registerUrl), { once: true });
      });

      map.setView([lat, lng], 16, { animate: false });
      setTimeout(() => {
        if (mapInstanceRef.current && userLocationLayerRef.current === group) {
          marker.openPopup();
        }
      }, 60);

      if (lookup?.matchType === 'PENDING_APPLICATION' && lookup.applicationId) {
        setSelectedAppId(lookup.applicationId);
      }
      userLocationLayerRef.current = group;
    } catch (err) {
      setError(err.message || 'Unable to determine your current location.');
    } finally {
      setLocating(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  const hasDrawn = Boolean(drawnRing);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            GIS Parcel Map Explorer
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Draw parcel boundaries, measure area &amp; perimeter, switch to satellite imagery,
            and launch land registration.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span>Validated: {parcels.length}</span>
          <span aria-hidden="true">·</span>
          <span>Pending: {pendingApps.length}</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-md bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Drawing mode banner */}
      {drawMode && (
        <div className="p-3 rounded-md bg-[#FEF9DB] border border-[#E5CF5D] text-sm text-[#1F2421] font-medium flex items-center gap-2">
          <Pencil className="w-4 h-4 shrink-0 text-[#1F2421]" aria-hidden="true" />
          {drawMode === 'polygon'
            ? 'Drawing polygon — click to add vertices, double-click or click the first point to close the shape.'
            : 'Drawing rectangle — click and drag to define the boundary.'}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* ── Map panel ──────────────────────────────────────────────────── */}
        <section className="lg:col-span-3 bg-white border border-slate-200 rounded-lg overflow-hidden">
          {/* Toolbar row */}
          <div className="px-4 py-2.5 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
            <OsmPlaceSearch onSelectPlace={handleSelectPlace} />
            <div className="flex items-center gap-2 shrink-0">
              <OsmLayerSwitcher activeLayerId={layerId} onChangeLayer={setLayerId} />
            </div>
          </div>

          {/* Legend row */}
          <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-1.5 rounded bg-emerald-600 inline-block" />
              Active parcel
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-1.5 rounded bg-amber-500 inline-block border-dashed border border-amber-500" />
              Pending claim
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-1.5 rounded bg-red-600 inline-block" />
              Rejected/Revoked
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-1.5 rounded bg-emerald-500 inline-block opacity-60" />
              Your drawing
            </span>
          </div>

          {/* Map canvas */}
          <div className="relative">
            <div
              ref={mapContainerRef}
              data-testid="gis-leaflet-map"
              className="h-[480px] w-full bg-slate-100 z-0"
            />

            {/* Our custom draw toolbar */}
            <DrawToolbar
              mode={drawMode}
              onPolygon={startDrawPolygon}
              onRectangle={startDrawRectangle}
              onEdit={startEditVertices}
              onDelete={deleteDrawn}
              onClear={clearAll}
              hasDrawn={hasDrawn}
              isEditing={isEditing}
            />

            {/* Live measurements overlay */}
            <MeasurementsBadge
              areaSqm={liveMeasure.areaSqm}
              perimeterM={liveMeasure.perimeterM}
              vertexCount={liveMeasure.vertexCount}
            />

            {/* Locate Me button */}
            <button
              type="button"
              onClick={handleLocateMe}
              disabled={locating}
              className="absolute bottom-3 left-3 z-[400] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1F2421] bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-sm disabled:opacity-60 whitespace-nowrap transition-colors"
            >
              <LocateFixed className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span>{locating ? 'Locating...' : 'Locate Me'}</span>
            </button>
          </div>

          {/* Location lookup result */}
          {locationLookup && (
            <div
              data-testid="gis-location-lookup-result"
              className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-0.5">
                <p className="font-mono tabular-nums text-slate-500">
                  <MapPin className="w-3 h-3 inline mr-1 text-slate-400" aria-hidden="true" />
                  {locationLookup.lat.toFixed(5)}, {locationLookup.lng.toFixed(5)}
                  {locationLookup.accuracy ? ` (±${locationLookup.accuracy} m)` : ''}
                </p>
                {locationLookup.lookup?.parcelCode ? (
                  <p className="text-sm font-medium text-slate-900">
                    Parcel:{' '}
                    <span className="font-mono font-bold text-[#1F2421]">
                      {locationLookup.lookup.parcelCode}
                    </span>
                    {locationLookup.lookup.areaSqm && (
                      <span className="text-xs text-slate-500 font-normal">
                        {' '}· {Number(locationLookup.lookup.areaSqm).toLocaleString()} m²
                      </span>
                    )}
                  </p>
                ) : locationLookup.lookup?.matchType === 'PENDING_APPLICATION' ? (
                  <p className="text-sm font-medium text-amber-800">
                    Pending:{' '}
                    <span className="font-mono font-bold">{locationLookup.lookup.referenceCode}</span>
                  </p>
                ) : (
                  <p className="text-sm font-medium text-slate-900">
                    Unclaimed — no parcel registered here yet.
                  </p>
                )}
              </div>
              {!locationLookup.lookup?.matched && (
                <Link
                  to={locationLookup.registerUrl}
                  className="inline-flex items-center px-3.5 py-2 text-xs font-medium text-white bg-[#1F2421] hover:bg-black rounded-md whitespace-nowrap shrink-0 transition-colors"
                >
                  Register Here
                </Link>
              )}
            </div>
          )}
        </section>

        {/* ── Sidebar ────────────────────────────────────────────────────── */}
        <aside className="lg:col-span-2 space-y-4">
          {/* Draw & Measure Panel */}
          <BoundaryPanel
            drawnRing={drawnRing}
            onImport={handleImportRing}
            onClear={deleteDrawn}
            onUseForApplication={handleUseForApplication}
          />

          {/* Pending Applications */}
          <section className="bg-white border border-slate-200 rounded-lg p-4">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Pending &amp; Submitted Claims
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Click to zoom to the boundary on the map.
            </p>

            {loading ? (
              <p className="mt-4 text-xs text-slate-500">Loading...</p>
            ) : pendingApps.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">
                No pending applications in the queue.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {pendingApps.map((app) => (
                  <li
                    key={app.id}
                    className={`p-2.5 rounded-md border text-xs ${
                      selectedAppId === app.id
                        ? 'border-[#1F2421] bg-[#FEF7D1]/50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleFocusApp(app)}
                      className="text-left w-full"
                    >
                      <p className="font-mono font-semibold text-slate-900">{app.reference_code}</p>
                      <p className="text-slate-700 mt-0.5">{app.parcel_name}</p>
                      <p className="text-slate-500 mt-0.5">
                        {app.claimant_name} ·{' '}
                        <span
                          className={
                            app.status === 'GIS_REJECTED' ? 'text-red-700 font-semibold' : ''
                          }
                        >
                          {app.status}
                        </span>
                      </p>
                    </button>
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
        </aside>
      </div>
    </div>
  );
}
