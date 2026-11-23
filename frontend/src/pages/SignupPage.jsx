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

export default function SignupPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    nationalId: '',
    phone: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);
    try {
      const result = await register(form);
      if (result.confirmationRequired) {
        setMessage(result.message);
      } else {
        navigate(getReturnPath(location.state?.from), { replace: true });
      }
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Account registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-12">
      <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="font-editorial text-2xl font-semibold text-slate-900">Create your account</h1>
        <p className="mt-2 text-sm text-slate-600">Confirm your email before signing in.</p>
        {error && <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message ? (
          <div role="status" className="mt-5 space-y-3">
            <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
            <Link
              to="/login"
              state={{ from: location.state?.from }}
              className="inline-block text-sm font-semibold text-slate-900 underline"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Full name
              <input required minLength={2} value={form.fullName} onChange={updateField('fullName')} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Email
              <input type="email" required value={form.email} onChange={updateField('email')} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              National ID
              <input required minLength={4} value={form.nationalId} onChange={updateField('nationalId')} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Phone (optional)
              <input type="tel" value={form.phone} onChange={updateField('phone')} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Password
              <input type="password" required minLength={8} value={form.password} onChange={updateField('password')} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </label>
            <button type="submit" disabled={submitting} className="w-full rounded bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {submitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        )}
        {!message && (
          <p className="mt-5 text-sm text-slate-600">
            Already registered?{' '}
            <Link
              to="/login"
              state={{ from: location.state?.from }}
              className="font-semibold text-slate-900 underline"
            >
              Sign in
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
