import React from 'react';
import { useAuth } from '../lib/AuthContext';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { LogOut, LayoutDashboard, Clock, User as UserIcon, Shield } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

interface LayoutProps {
  children: React.ReactNode;
  view: 'employee' | 'admin';
  setView: (view: 'employee' | 'admin') => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, view, setView }) => {
  const { profile } = useAuth();
  
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-xl tracking-tight text-slate-800">Ponto Conecta Lan House</span>
          </div>
          
          <div className="flex items-center gap-4">
            {profile?.role === 'admin' && (
              <div className="hidden sm:flex bg-slate-100 p-1 rounded-xl gap-1">
                <button
                  onClick={() => setView('employee')}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
                    view === 'employee' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  <Clock className="w-4 h-4" />
                  Meu Ponto
                </button>
                <button
                  onClick={() => setView('admin')}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
                    view === 'admin' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  <Shield className="w-4 h-4" />
                  Admin
                </button>
              </div>
            )}

            <div className="h-8 w-px bg-slate-200 mx-2" />

            <div className="flex items-center gap-3">
              <div className="text-right hidden xs:block">
                <div className="text-sm font-bold text-slate-800 leading-none">{profile?.name}</div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{profile?.role}</div>
              </div>
              <button 
                onClick={() => signOut(auth)}
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                title="Sair"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-4 sm:p-8">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {children}
        </motion.div>
      </main>
      
      {/* Footer Mobile Nav (Floating) */}
      {profile?.role === 'admin' && (
        <div className="sm:hidden fixed bottom-6 left-1/2 -translate-x-1/2 bg-white px-6 py-3 rounded-full shadow-2xl border border-slate-100 flex items-center gap-8 z-50">
          <button 
            onClick={() => setView('employee')}
            className={cn("flex flex-col items-center gap-1", view === 'employee' ? "text-blue-600" : "text-slate-400")}
          >
            <Clock className="w-6 h-6" />
            <span className="text-[10px] font-bold">PONTO</span>
          </button>
          <button 
            onClick={() => setView('admin')}
            className={cn("flex flex-col items-center gap-1", view === 'admin' ? "text-blue-600" : "text-slate-400")}
          >
            <Shield className="w-6 h-6" />
            <span className="text-[10px] font-bold">ADMIN</span>
          </button>
        </div>
      )}
    </div>
  );
};
