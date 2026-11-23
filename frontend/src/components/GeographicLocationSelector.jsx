import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

const selectClass =
  'w-full rounded-md border border-slate-300 px-3.5 py-2 text-sm disabled:bg-slate-100';

export default function GeographicLocationSelector({ value, onChange }) {
  const [states, setStates] = useState([]);
  const [lgas, setLgas] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [coverageNote, setCoverageNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get('/gis/locations/states')
      .then(({ data }) => {
        if (!active) return;
        setStates(data.locations || []);
        setCoverageNote(data.source?.note || '');
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError.response?.data?.error || 'Geographic reference locations are unavailable.'
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!value.stateId) {
      setLgas([]);
      return undefined;
    }

    let active = true;
    api
      .get(`/gis/locations/lgas/${value.stateId}`)
      .then(({ data }) => {
        if (active) setLgas(data.locations || []);
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.response?.data?.error || 'Local government areas are unavailable.');
        }
      });
    return () => {
      active = false;
    };
  }, [value.stateId]);

  useEffect(() => {
    if (!value.lgaId) {
      setCommunities([]);
      return undefined;
    }

    let active = true;
    api
      .get(`/gis/locations/communities/${value.lgaId}`)
      .then(({ data }) => {
        if (active) setCommunities(data.locations || []);
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError.response?.data?.error || 'Community and ward records are unavailable.'
          );
        }
      });
    return () => {
      active = false;
    };
  }, [value.lgaId]);

  const update = (key, selectedValue) => {
    const reset = key === 'stateId' ? { lgaId: '', communityId: '' } : { communityId: '' };
    onChange({ ...value, ...reset, [key]: selectedValue });
    setError('');
  };

  return (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-700">Geographic location</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-medium text-slate-600">
          State / FCT
          <select
            className={selectClass}
            value={value.stateId}
            onChange={(event) => update('stateId', event.target.value)}
          >
            <option value="">Select state (optional)</option>
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-600">
          Local government area
          <select
            className={selectClass}
            value={value.lgaId}
            disabled={!value.stateId}
            required={Boolean(value.stateId)}
            onChange={(event) => update('lgaId', event.target.value)}
          >
            <option value="">Select LGA</option>
            {lgas.map((lga) => (
              <option key={lga.id} value={lga.id}>
                {lga.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-600">
          Community / ward (optional)
          <select
            className={selectClass}
            value={value.communityId}
            disabled={!value.lgaId}
            onChange={(event) => update('communityId', event.target.value)}
          >
            <option value="">Select community / ward</option>
            {communities.map((community) => (
              <option key={community.id} value={community.id}>
                {community.name}
                {community.place_type === 'WARD' ? ' (ward)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-xs text-rose-700">{error}</p>}
      {coverageNote && <p className="text-xs text-slate-500">{coverageNote}</p>}
    </fieldset>
  );
}
