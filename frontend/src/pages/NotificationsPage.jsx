import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../services/api.js';

const DELIVERY_COLOR = {
  PUBLISHED: 'text-emerald-700',
  QUEUED: 'text-amber-700',
  FAILED: 'text-red-700',
  ACKNOWLEDGED: 'text-slate-700',
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const loadNotifications = useCallback(async () => {
    try {
      const query = statusFilter !== 'ALL' ? `?status=${statusFilter}` : '';
      const { data } = await api.get(`/notifications${query}`);
      setNotifications(data.notifications || []);
      setStats(data.stats || null);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to load notifications.',
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      await loadNotifications();
      window.dispatchEvent(new Event('anagu:notifications-updated'));
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to mark notification read.',
      });
    }
  };

  const handleMarkAllRead = async () => {
    setBusyAction('mark-all');
    try {
      await api.patch('/notifications/read-all');
      await loadNotifications();
      window.dispatchEvent(new Event('anagu:notifications-updated'));
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || 'Failed to mark notifications as read.',
      });
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Account Notifications
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Real-time updates on your land applications, Sepolia registration payments, and title status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={busyAction !== ''}
            onClick={handleMarkAllRead}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md whitespace-nowrap"
          >
            <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Mark All Read</span>
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

      <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-4 max-w-xl">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Unread Alerts</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {stats?.unreadCount ?? 0}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Total Notifications</p>
          <p className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
            {notifications.length}
          </p>
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#1F2421]" aria-hidden="true" />
            <span>Recent Updates</span>
          </h2>
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {['ALL', 'PUBLISHED', 'QUEUED'].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap ${
                  statusFilter === status
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="p-6 text-center text-xs text-slate-500">Loading notifications...</p>
        ) : notifications.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-500">
            No notifications match this filter yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map((item) => (
              <div
                key={item.id}
                className={`p-4 space-y-2 ${item.is_read ? 'bg-white' : 'bg-slate-50/70'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-slate-900">
                      {item.event_type}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-mono font-semibold ${
                        DELIVERY_COLOR[item.delivery_status] || 'text-slate-600'
                      }`}
                    >
                      {item.delivery_status}
                    </span>
                  </div>
                  <span className="font-mono text-slate-500 tabular-nums">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </div>

                {item.payload?.data && (
                  <pre className="p-2.5 rounded bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700 whitespace-pre-wrap break-words">
                    {JSON.stringify(item.payload.data, null, 2)}
                  </pre>
                )}

                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-500 tabular-nums">
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                  {!item.is_read ? (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(item.id)}
                      className="px-2.5 py-1 font-medium text-slate-700 border border-slate-300 hover:bg-slate-100 rounded whitespace-nowrap"
                    >
                      Mark Read
                    </button>
                  ) : (
                    <span className="text-slate-400">Read</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
