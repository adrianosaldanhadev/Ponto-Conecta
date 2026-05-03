import React, { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { Clock, LogIn, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';

export const Login: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      // Sugerir ao usuário que se o erro persistir ele deve abrir em nova aba
      const result = await signInWithPopup(auth, provider);
      
      const userRef = doc(db, 'users', result.user.uid);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        const isMaster = result.user.email === 'jonny2005ster@gmail.com';
        
        // CHECK FOR PRE-REGISTRATION (by email ID)
        const emailRef = doc(db, 'users', result.user.email!);
        const emailSnap = await getDoc(emailRef);
        
        if (emailSnap.exists()) {
          const preData = emailSnap.data();
          
          if (preData.status === 'inactive') {
            await auth.signOut();
            setError('Sua conta está inativa. Entre em contato com o administrador.');
            return;
          }

          await setDoc(userRef, {
            ...preData,
            uid: result.user.uid,
            createdAt: preData.createdAt || serverTimestamp(),
          });
          await deleteDoc(emailRef);
        } else if (isMaster) {
          // Master user creates their own profile automatically
          await setDoc(userRef, {
            uid: result.user.uid,
            name: result.user.displayName || 'Master Admin',
            email: result.user.email,
            role: 'admin',
            status: 'active',
            createdAt: serverTimestamp(),
          });
        } else {
          // Deny access - must be registered by Master
          await auth.signOut();
          setError('Acesso negado: Você não está cadastrado no sistema. Entre em contato com o administrador Master.');
          return;
        }
      } else {
        const currentUserData = userSnap.data();
        if (currentUserData.status === 'inactive') {
          await auth.signOut();
          setError('Sua conta está inativa. Entre em contato com o administrador.');
          return;
        }
      }
    } catch (err: any) {
      console.error("Auth Error:", err);
      if (err.code === 'auth/network-request-failed') {
        setError('Erro de rede: Verifique sua conexão ou tente abrir o aplicativo em uma nova aba (fora do ambiente de visualização).');
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError('O login foi cancelado. Você precisa completar o processo no popup.');
      } else if (err.code === 'auth/blocked-by-client') {
        setError('A autenticação foi bloqueada pelo navegador. Tente desativar bloqueadores de anúncios.');
      } else {
        setError('Falha na autenticação. Tente novamente mais tarde.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
      >
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-6">
          <Clock className="w-8 h-8 text-blue-600" />
        </div>
        
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Ponto Conecta Lan House</h1>
        <p className="text-slate-500 mb-8">Sistema Inteligente de Gestão de Ponto</p>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg flex flex-col items-center gap-3 text-red-600 text-sm">
            <div className="flex items-center gap-3 w-full">
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
            {error.includes('rede') && (
              <div className="mt-2 p-2 bg-white rounded border border-red-200 text-[11px] text-slate-600">
                <strong>Dica:</strong> Se você estiver vendo este erro, tente abrir o aplicativo em uma <strong>nova aba</strong> usando o ícone no canto superior direito do preview.
              </div>
            )}
          </div>
        )}
        
        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 px-4 rounded-xl transition-all shadow-sm disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          ) : (
            <>
              <LogIn className="w-5 h-5" />
              <span>Entrar com Google</span>
            </>
          )}
        </button>
        
        <div className="mt-8 text-xs text-slate-400">
          Acesso restrito para funcionários e administradores
        </div>
      </motion.div>
    </div>
  );
};
