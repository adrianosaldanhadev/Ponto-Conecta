import React, { useState } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { Login } from './components/Login';
import { Layout } from './components/Layout';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { Loader2 } from 'lucide-react';

const AppContent: React.FC = () => {
  const { user, profile, loading } = useAuth();
  const [view, setView] = useState<'employee' | 'admin'>('employee');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-blue-100 rounded-full animate-pulse" />
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="text-slate-400 font-medium animate-pulse">Carregando Ponto Conecta Lan House...</div>
      </div>
    );
  }

  if (!user || !profile) {
    return <Login />;
  }

  return (
    <Layout view={view} setView={setView}>
      {view === 'admin' && profile.role === 'admin' ? (
        <AdminDashboard />
      ) : (
        <EmployeeDashboard />
      )}
    </Layout>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
