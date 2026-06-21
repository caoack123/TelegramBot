import { FormEvent, useState } from 'react';
import { Bot, Lock } from 'lucide-react';

interface LoginScreenProps {
  onAuthenticated: () => Promise<void>;
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '登录失败');
      }
      setPassword('');
      await onAuthenticated();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#2AABEE] text-white flex items-center justify-center">
          <Bot className="w-9 h-9" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-center text-gray-900">机器人管理后台</h1>
        <p className="text-sm text-center text-gray-500 mt-2 mb-7">输入管理密码后继续</p>

        <label htmlFor="admin-password" className="block text-sm font-medium text-gray-700 mb-2">
          管理密码
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            required
            autoFocus
          />
        </div>

        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-xl bg-[#2AABEE] py-3 text-white font-medium hover:bg-blue-500 disabled:opacity-60"
        >
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  );
}
