import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Play, ShieldCheck, HardDrive, Cpu } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { adminApi } from '../services/adminApi.js';

export default function AdminEvaluationPage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [trials, setTrials] = useState(5);
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const loadLatest = useCallback(async () => {
    try {
      const { data } = await adminApi.get('/evaluation/latest');
      setReport(data.report || null);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to load evaluation report.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  const handleRunSuite = async () => {
    setRunning(true);
    setFeedback({ type: '', text: '' });
    try {
      const { data } = await adminApi.post('/evaluation/run', { trials });
      setReport(data.report);
      setFeedback({ type: 'success', text: data.message });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to execute live fraud & benchmark suite.',
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Fraud Simulations &amp; Performance Benchmarks
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Live isolated execution of all 4 academic security scenarios and repeated-trial subsystem latency, EVM gas, and storage measurements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <label htmlFor="eval-trials" className="text-xs font-medium text-slate-600">
            Trials:
          </label>
          <select
            id="eval-trials"
            value={trials}
            onChange={(e) => setTrials(Number(e.target.value))}
            disabled={running}
            className="px-2.5 py-2 text-xs border border-slate-300 rounded-md bg-white font-mono"
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
          </select>
          <button
            type="button"
            disabled={running}
            onClick={handleRunSuite}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1F2421] hover:bg-black disabled:opacity-50 rounded-md whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{running ? 'Running Live Suite...' : 'Run Live Evaluation Suite'}</span>
          </button>
        </div>
      </div>

      {feedback.text && (
        <div
          role="alert"
          className={`p-3.5 rounded-md border text-sm ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-500">
          Loading latest evaluation telemetry...
        </div>
      ) : !report ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center space-y-2">
          <FlaskConical className="w-7 h-7 text-slate-400 mx-auto" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-800">No recorded evaluation run yet.</p>
          <p className="text-xs text-slate-500">
            Click &ldquo;Run Live Evaluation Suite&rdquo; above or run <code className="font-mono">npm run evaluate</code> to execute all 4 fraud simulations and subsystem benchmarks.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500">Fraud Scenarios Passed</p>
              <p
                className={`mt-1 font-display text-2xl font-bold tabular-nums ${
                  report.allScenariosPassed ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {report.scenarios.filter((s) => s.passed).length} / {report.scenarios.length}
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500">Repeated Trials / Subsystem</p>
              <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {report.benchmarks.trials}
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500">Store Footprint</p>
              <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {(report.benchmarks.storage.prototypeStoreBytes / 1024).toFixed(2)} KB
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500">Measured Timestamp</p>
              <p className="mt-1 font-mono text-xs font-semibold text-slate-800 tabular-nums">
                {new Date(report.generatedAt).toLocaleString()}
              </p>
            </div>
          </div>

          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>Automated Fraud &amp; Attack Prevention Verification (4 Scenarios)</span>
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
              {report.scenarios.map((scenario, idx) => (
                <div
                  key={scenario.id}
                  className={`p-5 space-y-2 ${idx >= 2 ? 'border-t border-slate-200' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{scenario.title}</h3>
                    <span
                      className={`font-mono text-xs font-semibold shrink-0 ${
                        scenario.passed ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {scenario.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-slate-700">{scenario.outcome}</p>
                  <p className="text-xs text-slate-600">{scenario.evidence}</p>
                  <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                    HTTP {scenario.httpStatus} · Elapsed: {scenario.latencyMs} ms
                  </p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <section className="lg:col-span-3 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#1F2421]" aria-hidden="true" />
                  <span>Subsystem Latency &amp; EVM Gas ({report.benchmarks.trials} Trials)</span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Subsystem</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Min (ms)</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Mean (ms)</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Max (ms)</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Avg Gas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.benchmarks.subsystems.map((sub) => (
                      <tr key={sub.id}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{sub.label}</td>
                        <td className="px-3 py-2.5 font-mono text-right tabular-nums text-slate-600">
                          {sub.minMs}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-right tabular-nums font-semibold text-slate-900">
                          {sub.meanMs}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-right tabular-nums text-slate-600">
                          {sub.maxMs}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-right tabular-nums text-slate-600">
                          {sub.avgGasUsed !== null ? sub.avgGasUsed.toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Mean Execution Time (ms)
              </h2>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={report.benchmarks.subsystems.map((s) => ({
                      name:
                        {
                          GIS_SPATIAL_CHECK: 'GIS',
                          COMMUNITY_ORACLE: 'Oracle',
                          BLOCKCHAIN_MINT: 'Mint',
                          POLYGON_ESCROW_CYCLE: 'Escrow',
                          ADMIN_REVOKE: 'Revoke',
                          MQTT_QOS1_PUBSUB: 'MQTT',
                        }[s.id] || s.id,
                      meanMs: s.meanMs,
                    }))}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" interval={0} tick={{ fontSize: 10, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#475569' }} />
                    <Tooltip />
                    <Bar dataKey="meanMs" fill="#1F2421" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="pt-3 border-t border-slate-200 text-xs text-slate-600 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                  <HardDrive className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                  <span>Measured Storage Footprint</span>
                </div>
                <p className="font-mono text-[11px] tabular-nums">
                  Store: {report.benchmarks.storage.prototypeStoreBytes.toLocaleString()} bytes across{' '}
                  {report.benchmarks.storage.totalRecordsStored} records (avg{' '}
                  {report.benchmarks.storage.avgBytesPerRecord} B/record)
                </p>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
