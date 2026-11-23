import { OSM_BASE_LAYERS } from '../utils/osmMap.js';

const LAYER_ORDER = ['standard', 'satellite', 'humanitarian', 'topo'];

const LAYER_ICONS = {
  standard: '🗺',
  satellite: '🛰',
  humanitarian: '🏥',
  topo: '⛰',
};

export default function OsmLayerSwitcher({ activeLayerId, onChangeLayer }) {
  return (
    <div
      role="group"
      aria-label="Map base layer"
      className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-md shrink-0 flex-wrap"
    >
      {LAYER_ORDER.map((key) => {
        const layer = OSM_BASE_LAYERS[key];
        const isActive = activeLayerId === layer.id;
        return (
          <button
            key={layer.id}
            type="button"
            aria-pressed={isActive}
            title={layer.label}
            onClick={() => onChangeLayer(layer.id)}
            className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1F2421] flex items-center gap-1 ${
              isActive
                ? 'bg-[#1F2421] text-[#FDE878] shadow-xs'
                : 'text-slate-700 hover:text-[#1F2421] hover:bg-white/70'
            }`}
          >
            <span aria-hidden="true">{LAYER_ICONS[key]}</span>
            <span className="hidden sm:inline">{layer.label}</span>
          </button>
        );
      })}
    </div>
  );
}
