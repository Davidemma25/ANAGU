import { OSM_BASE_LAYERS } from '../utils/osmMap.js';

const LAYER_ORDER = ['standard', 'humanitarian', 'topo'];

export default function OsmLayerSwitcher({ activeLayerId, onChangeLayer }) {
  return (
    <div
      role="group"
      aria-label="OpenStreetMap layer style"
      className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-md shrink-0"
    >
      {LAYER_ORDER.map((key) => {
        const layer = OSM_BASE_LAYERS[key];
        const isActive = activeLayerId === layer.id;
        return (
          <button
            key={layer.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChangeLayer(layer.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1F2421] ${
              isActive
                ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                : 'text-slate-700 hover:text-[#1F2421] hover:bg-white/70'
            }`}
          >
            {layer.label}
          </button>
        );
      })}
    </div>
  );
}
