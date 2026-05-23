import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { LogOut, LayoutDashboard, Clock, User as UserIcon, Shield, Download, Smartphone, X, Share, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface LayoutProps {
  children: React.ReactNode;
  view: 'employee' | 'admin';
  setView: (view: 'employee' | 'admin') => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, view, setView }) => {
  const { profile } = useAuth();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showiOSInstructions, setShowiOSInstructions] = useState(false);

  useEffect(() => {
    // Check if the app is already running in standalone mode (installed as PWA)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         (navigator as any).standalone === true;
    
    // Check if previously dismissed
    const isDismissed = localStorage.getItem('pwa-dismissed') === 'true';

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      // Store prompt event
      setDeferredPrompt(e);
      if (!isStandalone && !isDismissed) {
        setShowInstallBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // If it's iOS and not standalone and not dismissed, show the install banner
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    if (isIOS && !isStandalone && !isDismissed) {
      setShowInstallBanner(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowInstallBanner(false);
      }
      setDeferredPrompt(null);
    } else {
      // Show iOS/Safari modal instructions
      setShowiOSInstructions(true);
    }
  };

  const handleDismiss = () => {
    setShowInstallBanner(false);
    localStorage.setItem('pwa-dismissed', 'true');
  };
  
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

            {/* Install Shortcut Button */}
            <button
              onClick={handleInstall}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase text-blue-600 bg-blue-50 hover:bg-blue-100 active:scale-95 transition-all border border-blue-100 shadow-sm"
              title="Criar atalho de aplicativo no celular ou PC"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Instalar App</span>
              <span className="xs:hidden">Instalar</span>
            </button>

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

      {/* PWA Floating Install Banner */}
      <AnimatePresence>
        {showInstallBanner && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-96 bg-white border border-slate-200 p-4 rounded-2xl shadow-2xl z-40 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex gap-3">
                <div className="bg-blue-50 p-2.5 rounded-xl text-blue-600 shrink-0">
                  <Smartphone className="w-6 h-6 animate-bounce" />
                </div>
                <div>
                  <h4 className="font-extrabold text-sm text-slate-800">Instalar no Celular ou PC</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Adicione o aplicativo Ponto Conecta Lan House à tela inicial para acesso rápido e prático.
                  </p>
                </div>
              </div>
              <button onClick={handleDismiss} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={handleInstall}
                className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 text-white font-extrabold text-xs uppercase tracking-wider text-center shadow-md shadow-blue-200 hover:bg-blue-700 transition-all cursor-pointer"
              >
                Instalar Aplicativo
              </button>
              <button
                onClick={handleDismiss}
                className="py-2.5 px-4 rounded-xl border border-slate-200 text-slate-500 font-bold text-xs uppercase hover:bg-slate-50 transition-all cursor-pointer"
              >
                Mais Tarde
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS Safari Manual Install Modal */}
      <AnimatePresence>
        {showiOSInstructions && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden p-6 relative flex flex-col gap-6"
            >
              <button
                onClick={() => setShowiOSInstructions(false)}
                className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex flex-col items-center text-center mt-2 animate-pulse">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                  <Smartphone className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-black text-slate-800">Instalar no iPhone / iPad</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-[250px]">
                  Siga estas etapas simples usando o Safari para adicionar à tela de início:
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    1
                  </div>
                  <div className="text-xs text-slate-600 leading-relaxed">
                    Toque no botão de <strong>Compartilhar</strong> <Share className="w-4 h-4 inline-block mx-1 text-blue-600" /> na barra inferior do Safari.
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    2
                  </div>
                  <div className="text-xs text-slate-600 leading-relaxed">
                    Role a lista pelas opções e selecione <strong>Adicionar à Tela de Início</strong> <Plus className="w-4 h-4 inline-block mx-1 text-slate-800 border rounded bg-slate-50 p-0.5" />.
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    3
                  </div>
                  <div className="text-xs text-slate-600 leading-relaxed">
                    Defina o nome da sua preferência e toque em <strong>Adicionar</strong> no canto direito superior.
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowiOSInstructions(false)}
                className="w-full py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 cursor-pointer"
              >
                Entendi!
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
