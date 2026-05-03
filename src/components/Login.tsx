import React, { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Clock, LogIn, ShieldAlert, Mail, Lock, UserPlus, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type LoginMode = 'login' | 'register' | 'google';

export const Login: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('login');
  const [emailInput, setEmailInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const processUserRef = async (user: any, userEmail: string | null) => {
    const userRef = doc(db, 'users', user.uid);
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      return;
    }
    
    if (!userSnap.exists()) {
      const isMaster = userEmail === 'jonny2005ster@gmail.com';
      
      // CHECK FOR PRE-REGISTRATION (by email ID)
      if (!userEmail) {
        await auth.signOut();
        setError('E-mail não fornecido pelo provedor.');
        return;
      }

      const emailRef = doc(db, 'users', userEmail);
      let emailSnap;
      try {
        emailSnap = await getDoc(emailRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${userEmail}`);
        return;
      }
      
      if (emailSnap.exists()) {
        const preData = emailSnap.data();
        
        if (preData.status === 'inactive') {
          await auth.signOut();
          setError('Sua conta está inativa. Entre em contato com o administrador.');
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password: _, ...dataToSave } = preData;

        try {
          await setDoc(userRef, {
            ...dataToSave,
            uid: user.uid,
            createdAt: preData.createdAt || serverTimestamp(),
          });
          await deleteDoc(emailRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
          return;
        }
      } else if (isMaster) {
        // Master user creates their own profile automatically
        try {
          await setDoc(userRef, {
            uid: user.uid,
            name: user.displayName || 'Master Admin',
            email: userEmail,
            role: 'admin',
            status: 'active',
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
          return;
        }
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
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await processUserRef(result.user, result.user.email);
    } catch (err: any) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !password) {
      setError('Por favor, preencha todos os campos.');
      return;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const email = emailInput.trim().toLowerCase();

      if (mode === 'login') {
        const result = await signInWithEmailAndPassword(auth, email, password);
        await processUserRef(result.user, result.user.email);
      } else {
        // Register mode: First check if email is pre-registered
        const emailRef = doc(db, 'users', email);
        let emailSnap;
        try {
          emailSnap = await getDoc(emailRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${email}`);
          return;
        }
        
        if (!emailSnap.exists() && email !== 'jonny2005ster@gmail.com') {
          setError('Este e-mail não possui pré-cadastro no sistema. Entre em contato com o administrador.');
          setLoading(false);
          return;
        }

        const preData = emailSnap.data();
        // If the admin set a password, it MUST match for activation
        if (preData?.password && preData.password !== password) {
          setError('A senha para ativação está incorreta. Verifique com seu administrador.');
          setLoading(false);
          return;
        }

        const result = await createUserWithEmailAndPassword(auth, email, password);
        await processUserRef(result.user, result.user.email);
      }
    } catch (err: any) {
      handleAuthError(err, emailInput);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthError = async (err: any, emailInput?: string) => {
    console.error("Auth Error:", err);
    if (err.code === 'auth/network-request-failed') {
      setError('Erro de rede: Verifique sua conexão.');
    } else if (err.code === 'auth/popup-closed-by-user') {
      setError('O login foi cancelado.');
    } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      // Check if this is a pre-registered user who hasn't activated yet
      if (mode === 'login' && emailInput) {
        try {
          const email = emailInput.trim().toLowerCase();
          const emailRef = doc(db, 'users', email);
          const emailSnap = await getDoc(emailRef);
          if (emailSnap.exists()) {
            setError('Sua conta ainda não foi ativada. Clique em "Ativar via E-mail" abaixo para definir sua senha e acessar o sistema.');
            return;
          }
        } catch (e) {
          console.error("Error checking pre-registration:", e);
        }
      }
      setError('E-mail ou senha incorretos. Verifique os dados e tente novamente.');
    } else if (err.code === 'auth/email-already-in-use') {
      setError('Este e-mail já possui uma conta ativa. Se você esqueceu sua senha, entre em contato com o administrador para redefinição ou use a opção de login.');
    } else if (err.code === 'auth/weak-password') {
      setError('A senha deve ter pelo menos 6 caracteres.');
    } else if (err.code === 'auth/too-many-requests') {
      setError('Muitas tentativas sem sucesso. Tente novamente mais tarde.');
    } else {
      setError('Falha na autenticação: ' + (err.message || 'Tente novamente.'));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 text-center border border-slate-100"
      >
        <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-50 rounded-3xl mb-6 shadow-sm">
          <Clock className="w-10 h-10 text-blue-600" />
        </div>
        
        <h1 className="text-3xl font-black text-slate-800 mb-1 tracking-tight">Ponto Conecta</h1>
        <p className="text-slate-400 text-sm mb-8 font-medium">Gestão de Ponto Inteligente</p>
        
        <AnimatePresence mode="wait">
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex flex-col items-center gap-3 text-red-600 text-xs overflow-hidden"
            >
              <div className="flex items-center gap-3 w-full font-bold">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleEmailAuth} className="space-y-4 text-left">
          {mode === 'register' && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 bg-amber-50 border border-amber-100 rounded-2xl text-[9px] text-amber-700 font-bold uppercase tracking-wider flex items-center gap-2 mb-2"
            >
              <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Use a senha definida pelo administrador no seu cadastro para ativar a conta.</span>
            </motion.div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-wider">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="email"
                required
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                placeholder="seu@email.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-wider">Senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="password"
                required
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {mode === 'register' && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-1.5"
            >
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-wider">Confirmar Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="password"
                  required
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                  placeholder="••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-2xl transition-all shadow-lg shadow-blue-100 disabled:opacity-50"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                <span>{mode === 'login' ? 'Acessar Sistema' : 'Ativar Conta'}</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-3">
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100" /></div>
            <div className="relative flex justify-center text-[10px] uppercase font-black text-slate-300">
              <span className="bg-white px-4 tracking-widest">Ou continue com</span>
            </div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-100 hover:bg-slate-50 text-slate-600 font-bold py-3 px-4 rounded-2xl transition-all shadow-sm disabled:opacity-50"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" />
            <span>Google Workspace</span>
          </button>
        </div>

        <div className="mt-8 flex items-center justify-center gap-2">
          <p className="text-[11px] text-slate-400 font-medium">
            {mode === 'login' ? 'Primeiro acesso?' : 'Já possui conta?'}
          </p>
          <button 
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            className="text-[11px] text-blue-600 font-black uppercase tracking-wider flex items-center gap-1 hover:underline"
          >
            {mode === 'login' ? (
              <>Ativar via E-mail <UserPlus className="w-3 h-3" /></>
            ) : (
              <>Fazer Login <ArrowRight className="w-3 h-3" /></>
            )}
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-50 text-[10px] text-slate-300 font-medium tracking-widest uppercase">
          Acesso Restrito Autorizado
        </div>
      </motion.div>
    </div>
  );
};
