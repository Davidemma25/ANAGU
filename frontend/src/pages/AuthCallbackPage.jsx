import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuthCallbackPage() {
  const { completeEmailAuth, confirmPasswordReset } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);
  const [mode, setMode] = useState('checking');
  const [accessToken, setAccessToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const queryParams = new URLSearchParams(window.location.search);
    const token = hashParams.get('access_token') || queryParams.get('access_token') || '';
    const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token') || '';
    const type = hashParams.get('type') || queryParams.get('type') || '';
    const callbackError =
      hashParams.get('error_description') ||
      queryParams.get('error_description') ||
      hashParams.get('error') ||
      queryParams.get('error');

    window.history.replaceState({}, document.title, window.location.pathname);

    if (callbackError) {
      setError(callbackError.replace(/\+/g, ' '));
      setMode('error');
      return;
    }
    if (!token) {
      setError('This authentication link is invalid or has expired. Request a new one and try again.');
      setMode('error');
      return;
    }
    if (type === 'recovery') {
      setAccessToken(token);
      setMode('recovery');
      return;
    }

    completeEmailAuth(token, refreshToken)
      .then(() => {
        navigate('/dashboard', { replace: true });
      })
      .catch(() => {
        setError('Email confirmation could not be completed. Request a new verification email and try again.');
        setMode('error');
      });
  }, [completeEmailAuth, navigate]);

  const submitPassword = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await confirmPasswordReset({ accessToken, password });
      setMessage(result.message);
      setMode('complete');
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Password reset failed. Request a new recovery link.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-12">
      <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {mode === 'checking' && (
          <p role="status" className="text-sm text-slate-600">Confirming your email...</p>
        )}
        {mode === 'recovery' && (
          <>
            <h1 className="font-editorial text-2xl font-semibold text-slate-900">Choose a new password</h1>
            {error && <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <form onSubmit={submitPassword} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                New password
                <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
              </label>
              <button type="submit" disabled={submitting} className="w-full rounded bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {submitting ? 'Updating password...' : 'Update password'}
              </button>
            </form>
          </>
        )}
        {mode === 'complete' && (
          <>
            <h1 className="font-editorial text-2xl font-semibold text-slate-900">Password updated</h1>
            <p role="status" className="mt-4 text-sm text-emerald-800">{message}</p>
            <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-slate-900 underline">Sign in</Link>
          </>
        )}
        {mode === 'error' && (
          <>
            <h1 className="font-editorial text-2xl font-semibold text-slate-900">Authentication link problem</h1>
            <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-slate-900 underline">Return to sign in</Link>
          </>
        )}
      </section>
    </main>
  );
}
