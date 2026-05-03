import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, updateDoc, collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useAuth } from '../lib/AuthContext';
import { TimeEntry } from '../types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MapPin, Download, History, LogIn, LogOut, CheckCircle2, User, ChevronDown, ChevronUp, Save, AlertTriangle, XCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export const EmployeeDashboard: React.FC = () => {
  const { profile } = useAuth();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingLocation, setFetchingLocation] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [locationHint, setLocationHint] = useState<string | null>(null);
  
  // Profile editing
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCpf, setEditCpf] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  useEffect(() => {
    if (profile) {
      setEditName(profile.name);
      setEditCpf(profile.cpf || '');
    }
  }, [profile]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!profile) return;

    const q = query(
      collection(db, 'timeEntries'),
      where('userId', '==', profile.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as TimeEntry[];
      setEntries(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'timeEntries');
    });

    return () => unsubscribe();
  }, [profile]);

  const handlePunch = async (type: 'in' | 'out') => {
    if (!profile) return;
    setLoading(true);
    setFetchingLocation(true);

    let locationData = null;
    
    try {
      if ("geolocation" in navigator) {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 8000,
            maximumAge: 0
          });
        });
        locationData = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
      }
    } catch (err: any) {
      console.warn("Could not get geolocation:", err);
      let errorMsg = "Não foi possível obter sua localização.";
      if (err.code === 1) errorMsg = "Permissão de localização negada pelo navegador.";
      else if (err.code === 2) errorMsg = "Localização indisponível no momento.";
      else if (err.code === 3) errorMsg = "Tempo esgotado ao obter localização.";
      
      setLocationHint(errorMsg + " Por favor, verifique as permissões de GPS e tente novamente para maior precisão.");
      setTimeout(() => setLocationHint(null), 8000);
    } finally {
      setFetchingLocation(false);
    }

    try {
      await addDoc(collection(db, 'timeEntries'), {
        userId: profile.uid,
        userName: profile.name,
        timestamp: serverTimestamp(),
        type,
        location: locationData,
        notes: ''
      });
      const locationInfo = locationData ? ' (Localização capturada)' : ' (Sem GPS)';
      setSuccessMsg(`Ponto de ${type === 'in' ? 'entrada' : 'saída'} registrado${locationInfo}!`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'timeEntries');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setIsUpdatingProfile(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        name: editName,
        cpf: editCpf,
      });
      setSuccessMsg('Perfil atualizado com sucesso!');
      setIsProfileOpen(false);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const lastEntry = entries[0];
  const canPunchIn = !lastEntry || lastEntry.type === 'out';

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Employee Info Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
            <User className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Identificação</div>
            <div className="font-bold text-slate-800">{profile?.name}</div>
          </div>
        </div>
        {profile?.cpf && (
          <div className="text-right">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CPF</div>
            <div className="text-xs font-mono text-slate-600">{profile.cpf}</div>
          </div>
        )}
      </div>

      {/* Clock Section */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-xl p-8 text-center border border-slate-100"
      >
        <div className="text-sm font-medium text-blue-600 mb-2 uppercase tracking-widest">
          {format(currentTime, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </div>
        <div className="text-6xl font-black text-slate-800 font-mono tracking-tighter mb-8">
          {format(currentTime, 'HH:mm:ss')}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
          <button
            onClick={() => handlePunch('in')}
            disabled={loading || !canPunchIn}
            className={cn(
              "flex flex-col items-center justify-center p-6 rounded-2xl transition-all border-2 group",
              canPunchIn 
                ? "bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-200" 
                : "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed opacity-50"
            )}
          >
            <LogIn className={cn("w-10 h-10 mb-2 transition-transform group-hover:scale-110", canPunchIn && "text-emerald-500")} />
            <span className="font-bold text-lg">Entrada</span>
            <span className="text-xs opacity-70">Marcar Início</span>
          </button>

          <button
            onClick={() => handlePunch('out')}
            disabled={loading || canPunchIn}
            className={cn(
              "flex flex-col items-center justify-center p-6 rounded-2xl transition-all border-2 group",
              !canPunchIn 
                ? "bg-red-50 border-red-100 text-red-700 hover:bg-red-100 hover:border-red-200" 
                : "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed opacity-50"
            )}
          >
            <LogOut className={cn("w-10 h-10 mb-2 transition-transform group-hover:scale-110", !canPunchIn && "text-red-500")} />
            <span className="font-bold text-lg">Saída</span>
            <span className="text-xs opacity-70">Marcar Término</span>
          </button>
        </div>
        
        <AnimatePresence>
          {fetchingLocation && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-4 flex items-center justify-center gap-2 text-blue-500 text-xs font-bold uppercase tracking-wider animate-pulse"
            >
              <MapPin className="w-3 h-3" />
              Obtendo Localização GPS...
            </motion.div>
          )}
          {successMsg && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-6 flex items-center justify-center gap-2 text-emerald-600 font-medium bg-emerald-50 py-2 px-4 rounded-full w-fit mx-auto shadow-sm"
            >
              <CheckCircle2 className="w-5 h-5" />
              {successMsg}
            </motion.div>
          )}

          {locationHint && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="mt-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-left"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 bg-amber-100 p-1.5 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-amber-800">Atenção com a Localização</div>
                  <div className="text-xs text-amber-700 leading-relaxed mt-1">
                    {locationHint}
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                    <Info className="w-3 h-3" />
                    Dica: Verifique o cadeado na barra de endereços do navegador
                  </div>
                </div>
                <button 
                  onClick={() => setLocationHint(null)}
                  className="text-amber-400 hover:text-amber-600 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* History Section */}
      <div className="bg-white rounded-3xl shadow-lg overflow-hidden border border-slate-100">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <History className="w-5 h-5 text-blue-500" />
            Meus Registros Recentes
          </div>
        </div>
        
        <div className="divide-y divide-slate-50">
          {entries.length === 0 ? (
            <div className="p-12 text-center text-slate-400 italic">
              Nenhum registro de ponto encontrado
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    entry.type === 'in' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                  )}>
                    {entry.type === 'in' ? <LogIn className="w-5 h-5" /> : <LogOut className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">
                      {entry.type === 'in' ? 'Entrada' : 'Saída'}
                    </div>
                    <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                      {entry.timestamp ? format(entry.timestamp.toDate(), "dd/MM/yyyy") : 'Sincronizando...'}
                      {entry.location && (
                        <a 
                          href={`https://www.google.com/maps?q=${entry.location.lat},${entry.location.lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-0.5 text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase hover:bg-blue-100 transition-colors"
                        >
                          <MapPin className="w-2.5 h-2.5" />
                          Ver Localização
                        </a>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-slate-800 tabular-nums">
                    {entry.timestamp ? format(entry.timestamp.toDate(), 'HH:mm') : '--:--'}
                  </div>
                  <div className="text-[10px] text-slate-300 uppercase tracking-tighter">
                    Horário de Brasília
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
