import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, updateDoc, collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useAuth } from '../lib/AuthContext';
import { TimeEntry } from '../types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MapPin, Download, History, LogIn, LogOut, CheckCircle2, User, ChevronDown, ChevronUp, Save, AlertTriangle, XCircle, Info, RefreshCw, Compass, Navigation } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export const EmployeeDashboard: React.FC = () => {
  const { profile } = useAuth();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingLocation, setFetchingLocation] = useState(false);
  const [activePunchType, setActivePunchType] = useState<'in' | 'out' | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [locationHint, setLocationHint] = useState<string | null>(null);
  
  // Pre-loaded/Live Geolocation for Map & Fast Punch
  const [currentGeoLocation, setCurrentGeoLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geoAccuracy, setGeoAccuracy] = useState<number | null>(null);
  const [addressName, setAddressName] = useState<string | null>(null);
  const [loadingAddress, setLoadingAddress] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [isRefreshingGeo, setIsRefreshingGeo] = useState<boolean>(false);
  
  // Profile editing
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCpf, setEditCpf] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  const fetchAddress = async (lat: number, lng: number) => {
    try {
      setLoadingAddress(true);
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
        headers: {
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'User-Agent': 'Pontual-Applet-Location-Agent/1.0'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) {
          setAddressName(data.display_name);
        } else {
          setAddressName(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        }
      } else {
        setAddressName(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      }
    } catch (err) {
      console.error("Error fetching address:", err);
      setAddressName(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    } finally {
      setLoadingAddress(false);
    }
  };

  const loadAndWatchLocation = () => {
    if (!("geolocation" in navigator)) {
      setGeoError("Geolocalização não é suportada por este navegador.");
      return;
    }

    setIsRefreshingGeo(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        
        setCurrentGeoLocation({ lat, lng });
        setGeoAccuracy(accuracy);
        setGeoError(null);
        setIsRefreshingGeo(false);
        fetchAddress(lat, lng);
      },
      (err) => {
        console.warn("Initial geolocation fetch failed:", err);
        let errorMsg = "Módulo de GPS desligado ou sem permissão.";
        if (err.code === 1) errorMsg = "Permissão de localização negada pelo navegador.";
        else if (err.code === 2) errorMsg = "Sinal de GPS indisponível.";
        else if (err.code === 3) errorMsg = "Tempo limite para obter localização esgotado.";
        
        setGeoError(errorMsg);
        setIsRefreshingGeo(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  useEffect(() => {
    loadAndWatchLocation();
    
    // We can also set up watchPosition for live updates as the browser is active
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const accuracy = position.coords.accuracy;
          
          setCurrentGeoLocation({ lat, lng });
          setGeoAccuracy(accuracy);
          setGeoError(null);
        },
        (err) => {
          console.warn("Watch position error:", err);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 5000
        }
      );
      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, []);

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

  const calculateRates = () => {
    if (!profile || !profile.salary) return { daily: 0, hourly: 0 };
    const salary = profile.salary;
    const daily = salary / 30;
    const workload = profile.workload || 8;
    const weeklyHours = workload * 5.5;
    const divisor = weeklyHours * 5;
    const hourly = salary / divisor;
    return { daily, hourly };
  };

  const getDelayAndDiscount = (entry: TimeEntry) => {
    if (!entry.timestamp || !profile) return { minutes: 0, discount: 0 };
    
    const entryDate = entry.timestamp.toDate();
    const entryHours = entryDate.getHours();
    const entryMinutes = entryDate.getMinutes();
    const entrySeconds = entryDate.getSeconds();
    const actualMinutes = entryHours * 60 + entryMinutes;
    const actualTotalMinutes = entryHours * 60 + entryMinutes + entrySeconds / 60;
    
    if (entry.type === 'in') {
      let targetMinutes = 540; // 09:00
      let maxAllowedMinutes = 545; // 09:05
      
      if (actualMinutes >= 720) { // afternoon shift (from 12:00 onwards)
        targetMinutes = 810; // 13:30
        maxAllowedMinutes = 815; // 13:35
      }
      
      if (actualMinutes > maxAllowedMinutes) {
        // Late arrival. Calculate exact late duration from target scheduled time.
        const diffMinutes = actualTotalMinutes - targetMinutes;
        const salary = profile.salary || 0;
        if (salary > 0) {
          const { hourly } = calculateRates();
          const discount = (diffMinutes / 60) * hourly;
          return { minutes: diffMinutes, discount };
        }
        return { minutes: diffMinutes, discount: 0 };
      }
    }
    
    return { minutes: 0, discount: 0 };
  };

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
    setActivePunchType(type);
    setLoading(true);
    setFetchingLocation(true);

    let locationData = currentGeoLocation;
    
    // If we do not have locationData, let's try to fetch it now as fallback
    if (!locationData) {
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
          setCurrentGeoLocation(locationData);
          setGeoAccuracy(position.coords.accuracy);
          setGeoError(null);
          fetchAddress(locationData.lat, locationData.lng);
        }
      } catch (err: any) {
        console.warn("Could not get geolocation during punch fallbacks:", err);
        let errorMsg = "Não foi possível obter sua localização.";
        if (err.code === 1) errorMsg = "Permissão de localização negada pelo navegador.";
        else if (err.code === 2) errorMsg = "Localização indisponível no momento.";
        else if (err.code === 3) errorMsg = "Tempo esgotado ao obter localização.";
        
        setGeoError(errorMsg);
        setLocationHint(errorMsg + " Por favor, verifique as permissões de GPS e de privacidade de seu navegador.");
        setTimeout(() => setLocationHint(null), 8000);
      } finally {
        setFetchingLocation(false);
      }
    } else {
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
      setActivePunchType(null);
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Identificação</div>
              <div className="font-bold text-slate-800">{profile?.name}</div>
              {profile?.jobTitle && (
                <div className="text-xs text-slate-500 font-medium">
                  {profile.jobTitle}
                </div>
              )}
            </div>
          </div>
          {profile?.cpf && (
            <div className="text-right">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CPF</div>
              <div className="text-xs font-mono text-slate-600">{profile.cpf}</div>
            </div>
          )}
        </div>

        {/* Contract & Salary Info Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col justify-center">
          {profile?.salary ? (
            (() => {
              const { daily, hourly } = calculateRates();
              return (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Salário Mensal</div>
                    <div className="text-sm font-extrabold text-slate-800 mt-1">
                      {profile.salary.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Valor por Dia</div>
                    <div className="text-xs font-semibold text-slate-800 mt-1">
                      {daily.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Valor por Hora</div>
                    <div className="text-xs font-semibold text-slate-800 mt-1">
                      {hourly.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="text-center text-xs text-slate-400 italic">
              Nenhuma informação salarial cadastrada no sistema.
            </div>
          )}
        </div>
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
        <div className="text-6xl font-black text-slate-800 font-mono tracking-tighter mb-6">
          {format(currentTime, 'HH:mm:ss')}
        </div>

        {/* Mapa e Informações de Localização */}
        <div id="ponto-location-map" className="mb-6 max-w-xl mx-auto bg-slate-50 rounded-2xl overflow-hidden border border-slate-100 shadow-sm text-left">
          {/* Cabeçalho de Status GPS */}
          <div className="px-4 py-3 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="relative flex h-2 w-2">
                <span className={cn(
                  "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                  currentGeoLocation ? "bg-emerald-400" : (geoError ? "bg-red-400" : "bg-amber-400")
                )}></span>
                <span className={cn(
                  "relative inline-flex rounded-full h-2 w-2",
                  currentGeoLocation ? "bg-emerald-500" : (geoError ? "bg-red-500" : "bg-amber-500")
                )}></span>
              </div>
              <span className="text-xs font-bold text-slate-700 tracking-tight">
                {currentGeoLocation ? "Sinal GPS Ativo" : (geoError ? "GPS Indisponível" : "Buscando Sinal GPS...")}
              </span>
            </div>
            
            <button
              id="refresh-gps-button"
              onClick={loadAndWatchLocation}
              disabled={isRefreshingGeo}
              className={cn(
                "p-1 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors flex items-center gap-1",
                isRefreshingGeo && "opacity-60 cursor-not-allowed"
              )}
              title="Atualizar Localização"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isRefreshingGeo && "animate-spin")} />
              <span className="text-[10px] font-extrabold uppercase tracking-wider hidden sm:inline">Atualizar</span>
            </button>
          </div>

          {/* O Mapa (iframe Embed do Google Maps) */}
          <div className="relative bg-slate-100 h-80 flex flex-col items-center justify-center overflow-hidden">
            {currentGeoLocation ? (
              <iframe
                title="Ponto Geolocation Map"
                src={`https://maps.google.com/maps?q=${currentGeoLocation.lat},${currentGeoLocation.lng}&t=&z=16&ie=UTF8&iwloc=&output=embed`}
                className="w-full h-full border-0 rounded-b-none"
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer"
              ></iframe>
            ) : geoError ? (
              <div className="p-6 text-center space-y-3">
                <div className="mx-auto w-10 h-10 bg-red-50 rounded-full flex items-center justify-center text-red-500">
                  <Compass className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700 text-center">{geoError || "Erro de Georeferenciamento"}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed text-center">
                    Ative a localização do seu dispositivo e permita o acesso no navegador para bater seu ponto com precisão.
                  </p>
                </div>
                <button
                  id="reconnect-gps-button"
                  onClick={loadAndWatchLocation}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 mx-auto"
                >
                  <Navigation className="w-3 h-3" />
                  Conectar GPS
                </button>
              </div>
            ) : (
              <div className="p-6 text-center space-y-2">
                <RefreshCw className="w-6 h-6 text-blue-500 animate-spin mx-auto" />
                <p className="text-xs font-bold text-slate-600">Obtendo sua localização em tempo real...</p>
                <p className="text-[10px] text-slate-400">Por favor, conceda permissão de GPS caso solicitado.</p>
              </div>
            )}
          </div>

          {/* Dados descritivos da Localização */}
          {(currentGeoLocation || loadingAddress || addressName) ? (
            <div className="p-4 bg-white border-t border-slate-100 space-y-3">
              {/* Endereço por Extenso */}
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Endereço de Registro</p>
                  {loadingAddress ? (
                    <div className="mt-1 space-y-1 animate-pulse">
                      <div className="h-2.5 bg-slate-100 rounded w-full"></div>
                      <div className="h-2.5 bg-slate-100 rounded w-2/3"></div>
                    </div>
                  ) : addressName ? (
                    <p className="text-xs font-medium text-slate-700 mt-1 leading-snug break-words">
                      {addressName}
                    </p>
                  ) : (
                    <p className="text-xs font-bold text-slate-700 mt-1">Carregando endereço no GPS...</p>
                  )}
                </div>
              </div>

              {/* Coordenadas e Precisão detalhadas */}
              {currentGeoLocation && (
                <div className="pt-2 border-t border-slate-50 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="font-semibold text-slate-400">LAT:</span> {currentGeoLocation.lat.toFixed(6)}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-400">LNG:</span> {currentGeoLocation.lng.toFixed(6)}
                    </div>
                  </div>
                  {geoAccuracy !== null && (
                    <div className="bg-blue-50/70 border border-blue-100/50 px-2 py-0.5 rounded text-[10px] text-blue-700 font-bold tracking-tight">
                      Precisão: ~{Math.round(geoAccuracy)}m
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto">
          <motion.button
            onClick={() => handlePunch('in')}
            disabled={loading || !canPunchIn}
            whileHover={canPunchIn && !loading ? { scale: 1.02, y: -2, boxShadow: "0 10px 15px -3px rgba(16, 185, 129, 0.1), 0 4px 6px -4px rgba(16, 185, 129, 0.1)" } : {}}
            whileTap={canPunchIn && !loading ? { scale: 0.98 } : {}}
            animate={activePunchType === 'in' && fetchingLocation ? {
              boxShadow: ["0 0 0px rgba(16, 185, 129, 0)", "0 0 20px rgba(16, 185, 129, 0.4)", "0 0 0px rgba(16, 185, 129, 0)"],
              borderColor: ["#a7f3d0", "#10b981", "#a7f3d0"],
              transition: { repeat: Infinity, duration: 1.5 }
            } : {}}
            className={cn(
              "flex flex-col items-center justify-center p-6 rounded-2xl transition-all border-2 group relative overflow-hidden",
              canPunchIn 
                ? "bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-200" 
                : "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed opacity-50"
            )}
          >
            {activePunchType === 'in' && fetchingLocation && (
              <>
                <motion.div 
                  className="absolute inset-0 bg-emerald-500/5 pointer-events-none"
                  animate={{ opacity: [0.1, 0.3, 0.1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                />
                <motion.div 
                  className="absolute w-16 h-16 rounded-full border border-emerald-400/30 pointer-events-none"
                  initial={{ scale: 0.5, opacity: 1 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
                />
                <motion.div 
                  className="absolute w-16 h-16 rounded-full border border-emerald-500/20 pointer-events-none"
                  initial={{ scale: 0.5, opacity: 1 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeOut", delay: 0.7 }}
                />
              </>
            )}

            {activePunchType === 'in' && fetchingLocation ? (
              <div className="relative mb-2 w-10 h-10 flex items-center justify-center bg-emerald-100 rounded-full text-emerald-600">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                  className="absolute inset-0 rounded-full border-2 border-dashed border-emerald-400/40"
                />
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                >
                  <MapPin className="w-5 h-5 text-emerald-500" />
                </motion.div>
              </div>
            ) : (
              <LogIn className={cn("w-10 h-10 mb-2 transition-transform group-hover:scale-110", canPunchIn && "text-emerald-500")} />
            )}

            <span className="font-bold text-lg">
              {activePunchType === 'in' && fetchingLocation ? 'Localizando...' : 'Entrada'}
            </span>
            <span className="text-xs opacity-70">
              {activePunchType === 'in' && fetchingLocation ? 'Obtendo GPS...' : 'Marcar Início'}
            </span>
          </motion.button>

          <motion.button
            onClick={() => handlePunch('out')}
            disabled={loading || canPunchIn}
            whileHover={!canPunchIn && !loading ? { scale: 1.02, y: -2, boxShadow: "0 10px 15px -3px rgba(239, 68, 68, 0.1), 0 4px 6px -4px rgba(239, 68, 68, 0.1)" } : {}}
            whileTap={!canPunchIn && !loading ? { scale: 0.98 } : {}}
            animate={activePunchType === 'out' && fetchingLocation ? {
              boxShadow: ["0 0 0px rgba(239, 68, 68, 0)", "0 0 20px rgba(239, 68, 68, 0.4)", "0 0 0px rgba(239, 68, 68, 0)"],
              borderColor: ["#fecaca", "#ef4444", "#fecaca"],
              transition: { repeat: Infinity, duration: 1.5 }
            } : {}}
            className={cn(
              "flex flex-col items-center justify-center p-6 rounded-2xl transition-all border-2 group relative overflow-hidden",
              !canPunchIn 
                ? "bg-red-50 border-red-100 text-red-700 hover:bg-red-100 hover:border-red-200" 
                : "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed opacity-50"
            )}
          >
            {activePunchType === 'out' && fetchingLocation && (
              <>
                <motion.div 
                  className="absolute inset-0 bg-red-500/5 pointer-events-none"
                  animate={{ opacity: [0.1, 0.3, 0.1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                />
                <motion.div 
                  className="absolute w-16 h-16 rounded-full border border-red-400/30 pointer-events-none"
                  initial={{ scale: 0.5, opacity: 1 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
                />
                <motion.div 
                  className="absolute w-16 h-16 rounded-full border border-red-500/20 pointer-events-none"
                  initial={{ scale: 0.5, opacity: 1 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeOut", delay: 0.7 }}
                />
              </>
            )}

            {activePunchType === 'out' && fetchingLocation ? (
              <div className="relative mb-2 w-10 h-10 flex items-center justify-center bg-red-100 rounded-full text-red-600">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                  className="absolute inset-0 rounded-full border-2 border-dashed border-red-400/40"
                />
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                >
                  <MapPin className="w-5 h-5 text-red-500" />
                </motion.div>
              </div>
            ) : (
              <LogOut className={cn("w-10 h-10 mb-2 transition-transform group-hover:scale-110", !canPunchIn && "text-red-500")} />
            )}

            <span className="font-bold text-lg">
              {activePunchType === 'out' && fetchingLocation ? 'Localizando...' : 'Saída'}
            </span>
            <span className="text-xs opacity-70">
              {activePunchType === 'out' && fetchingLocation ? 'Obtendo GPS...' : 'Marcar Término'}
            </span>
          </motion.button>
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
                      {(() => {
                        const { minutes, discount } = getDelayAndDiscount(entry);
                        if (minutes > 0) {
                          const hours = Math.floor(minutes / 60);
                          const mins = Math.floor(minutes % 60);
                          const delayStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                          return (
                            <div className="flex items-center gap-1.5">
                              <span className="bg-red-50 text-red-600 border border-red-100 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                                Atraso: +{delayStr}
                              </span>
                              {discount > 0 && (
                                <span className="bg-amber-50 text-amber-600 border border-amber-100 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                                  Desconto: -{discount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </span>
                              )}
                            </div>
                          );
                        }
                        return null;
                      })()}
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
