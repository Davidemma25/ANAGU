import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  OSM_BASE_LAYERS,
  getBoundaryLatLngs,
  getDemarcationStyle,
} from '../utils/osmMap.js';

function ParcelFallbackGraphic({ title }) {
  return (
    <div className="w-full h-full bg-gradient-to-br from-[#2D312E] via-[#1F2421] to-[#121513] flex flex-col items-center justify-center p-4 text-center">
      <svg
        viewBox="0 0 120 80"
        className="w-20 h-14 text-[#FDE878]/70 mb-1.5"
        fill="none"
        aria-hidden="true"
      >
        <polygon
          points="20,58 46,24 96,20 104,56 54,66"
          stroke="currentColor"
          strokeWidth="2.5"
          fill="currentColor"
          fillOpacity="0.14"
        />
        <line x1="46" y1="24" x2="54" y2="66" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
      </svg>
      <span className="text-[11px] font-medium text-white/85 line-clamp-1">{title}</span>
    </div>
  );
}

export default function OsmParcelPreviewMap({
  boundaryGeojson,
  title = 'Land Parcel',
  isBlocked = false,
  isPendingVerification = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  const latLngs = useMemo(() => getBoundaryLatLngs(boundaryGeojson), [boundaryGeojson]);
  const style = useMemo(
    () => getDemarcationStyle({ isBlocked, isPendingVerification }),
    [isBlocked, isPendingVerification]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || latLngs.length < 3) return undefined;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(el, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      attributionControl: true,
    });

    if (map.attributionControl) {
      map.attributionControl.setPrefix(false);
    }

    const baseLayer = OSM_BASE_LAYERS.standard;
    L.tileLayer(baseLayer.url, {
      attribution: '&copy; OSM',
      maxZoom: baseLayer.maxZoom,
    }).addTo(map);

    const polygon = L.polygon(latLngs, {
      color: style.color,
      weight: style.weight,
      fillColor: style.fillColor,
      fillOpacity: style.fillOpacity,
      ...(style.dashArray ? { dashArray: style.dashArray } : {}),
    }).addTo(map);

    latLngs.forEach(([lat, lng]) => {
      L.circleMarker([lat, lng], {
        radius: 3.5,
        color: '#1F2421',
        weight: 1.5,
        fillColor: '#FDE878',
        fillOpacity: 1,
      }).addTo(map);
    });

    const bounds = polygon.getBounds();
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17, animate: false });
    mapRef.current = map;

    const timerId = setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize({ animate: false });
        mapRef.current.fitBounds(bounds, { padding: [24, 24], maxZoom: 17, animate: false });
      }
    }, 80);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize({ animate: false });
          mapRef.current.fitBounds(bounds, { padding: [24, 24], maxZoom: 17, animate: false });
        }
      });
      observer.observe(el);
    }

    return () => {
      clearTimeout(timerId);
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [latLngs, style]);

  if (latLngs.length < 3) {
    return <ParcelFallbackGraphic title={title} />;
  }

  return (
    <div className="relative w-full h-full pointer-events-none select-none">
      <div
        ref={containerRef}
        data-testid="osm-parcel-demarcation-preview"
        aria-label={`${title} OpenStreetMap boundary demarcation (${latLngs.length} corners)`}
        className="w-full h-full bg-slate-100"
      />
    </div>
  );
}
