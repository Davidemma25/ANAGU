import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function getReturnPath(from) {
  const path =
    typeof from === 'string'
      ? from
      : from?.pathname
        ? `${from.pathname}${from.search || ''}${from.hash || ''}`
        : '/dashboard';
  return path.startsWith('/') && !path.startsWith('//') ? path : '/dashboard';
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login({ email, password });
        navigate(getReturnPath(location.state?.from), { replace: true });
      } else if (mode === 'request') {
        const result = await requestPasswordReset(email);
        setMessage(result.message);
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Authentication request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-12">
      <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="font-editorial text-2xl font-semibold text-slate-900">
          {mode === 'login' ? 'Sign in' : 'Reset password'}
        </h1>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === 'login' || mode === 'request' ? (
            <label className="block text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
          ) : null}

          {mode === 'login' && (
            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
          )}

          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {message && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Send reset email'}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm">
          {mode === 'login' ? (
            <button type="button" onClick={() => setMode('request')} className="text-slate-700 underline">
              Forgot password?
            </button>
          ) : (
            <button type="button" onClick={() => setMode('login')} className="text-slate-700 underline">
              Back to sign in
            </button>
          )}
          <Link
            to="/signup"
            state={{ from: location.state?.from }}
            className="font-semibold text-slate-900"
          >
            Create account
          </Link>
        </div>
      </section>
    </main>
  );
}
