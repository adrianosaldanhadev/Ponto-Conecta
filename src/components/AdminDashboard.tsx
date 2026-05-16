import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, setDoc, serverTimestamp, getDocs, where, Timestamp } from 'firebase/firestore';
import { UserProfile, TimeEntry, UserRole } from '../types';
import { format } from 'date-fns';
import { Users, ClipboardList, Trash2, Edit2, ShieldCheck, User as UserIcon, Search, UserPlus, X, Save, Download, MapPin, Filter, Calendar, History, BarChart3, Camera, Upload, Lock, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { startOfDay, endOfDay, isWithinInterval, parseISO, subDays } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const AdminDashboard: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'logs' | 'bank'>('logs');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filter states
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'in' | 'out'>('all');
  const [userFilter, setUserFilter] = useState('all');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  
  // Modal states
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<UserProfile> | null>(null);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Partial<TimeEntry> | null>(null);
  const [entryDateTime, setEntryDateTime] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [showModalPassword, setShowModalPassword] = useState(false);

  useEffect(() => {
    const usersUnsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const allDocs = snapshot.docs.map(doc => ({ ...doc.data(), docId: doc.id }) as UserProfile & { docId: string });
      
      // De-duplicate by email: prefer doc with uid (activated) over pre-registered one (id is email)
      const uniqueUsersMap = new Map<string, UserProfile & { docId: string }>();
      allDocs.forEach(u => {
        const email = u.email.toLowerCase();
        const existing = uniqueUsersMap.get(email);
        if (!existing || (u.uid && !existing.uid)) {
          uniqueUsersMap.set(email, u);
        }
      });
      
      setUsers(Array.from(uniqueUsersMap.values()));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    const entriesQuery = query(collection(db, 'timeEntries'), orderBy('timestamp', 'desc'));
    const entriesUnsubscribe = onSnapshot(entriesQuery, (snapshot) => {
      setAllEntries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TimeEntry));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'timeEntries'));

    return () => {
      usersUnsubscribe();
      entriesUnsubscribe();
    };
  }, []);

  const handleOpenUserModal = (user?: UserProfile) => {
    setEditingUser(user || { 
      name: '', 
      email: '', 
      role: 'employee', 
      cpf: '', 
      matricula: '', 
      department: '', 
      status: 'active',
      workload: 8,
      password: ''
    });
    setIsUserModalOpen(true);
  };

  const handleOpenEntryModal = (entry: TimeEntry) => {
    setEditingEntry(entry);
    if (entry.timestamp) {
      // Format as YYYY-MM-DDThh:mm for datetime-local input
      const date = entry.timestamp.toDate();
      const offset = date.getTimezoneOffset() * 60000;
      const localISOTime = new Date(date.getTime() - offset).toISOString().slice(0, 16);
      setEntryDateTime(localISOTime);
    }
    setIsEntryModalOpen(true);
  };

  const handleSaveEntry = async () => {
    if (!editingEntry || !editingEntry.id || !entryDateTime) return;
    setIsSaving(true);
    try {
      const newTimestamp = Timestamp.fromDate(new Date(entryDateTime));
      await updateDoc(doc(db, 'timeEntries', editingEntry.id), {
        timestamp: newTimestamp,
        type: editingEntry.type
      });
      setIsEntryModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `timeEntries/${editingEntry.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveUser = async () => {
    if (!editingUser?.email || !editingUser?.name) return;
    setIsSaving(true);
    try {
      const userData = {
        name: editingUser.name,
        role: editingUser.role as UserRole,
        cpf: editingUser.cpf || '',
        matricula: editingUser.matricula || '',
        department: editingUser.department || '',
        status: editingUser.status || 'active',
        workload: Number(editingUser.workload) || 8,
        photoURL: editingUser.photoURL || '',
        password: editingUser.password || '',
      };

      if (editingUser.uid) {
        // Update existing
        await updateDoc(doc(db, 'users', editingUser.uid), userData);
      } else {
        // Create new (Pre-registration)
        const cleanEmail = editingUser.email.trim().toLowerCase();
        const docId = cleanEmail;
        await setDoc(doc(db, 'users', docId), {
          ...userData,
          uid: '',
          email: cleanEmail,
          createdAt: serverTimestamp(),
        });
      }
      setIsUserModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteUser = async (uidOrEmail: string) => {
    if (!window.confirm('Tem certeza que deseja remover este funcionário? Isso não apagará o histórico de pontos, mas impedirá o acesso.')) return;
    try {
      // Find the document ID. Usually it's uid, but if pre-registered it might be email.
      // Firebase doesn't allow querying by list of IDs effectively here easily, 
      // but in our app the `users` collection has one doc per user.
      await deleteDoc(doc(db, 'users', uidOrEmail));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${uidOrEmail}`);
    }
  };

  const deleteEntry = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este registro?')) return;
    try {
      await deleteDoc(doc(db, 'timeEntries', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `timeEntries/${id}`);
    }
  };

  const filteredEntries = allEntries.filter(e => {
    // Search by name
    const matchesSearch = e.userName.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Filter by type
    const matchesType = typeFilter === 'all' || e.type === typeFilter;
    
    // Filter by user
    const matchesUser = userFilter === 'all' || e.userId === userFilter;
    
    // Filter by date range
    let matchesDate = true;
    if (e.timestamp && (startDate || endDate)) {
      const entryDate = e.timestamp.toDate();
      const start = startDate ? startOfDay(parseISO(startDate)) : null;
      const end = endDate ? endOfDay(parseISO(endDate)) : null;
      
      if (start && end) {
        matchesDate = isWithinInterval(entryDate, { start, end });
      } else if (start) {
        matchesDate = entryDate >= start;
      } else if (end) {
        matchesDate = entryDate <= end;
      }
    }
    
    return matchesSearch && matchesType && matchesUser && matchesDate;
  });

  const exportToCSV = () => {
    if (filteredEntries.length === 0) return;

    const headers = ["Funcionario", "Data", "Hora", "Tipo", "Latitude", "Longitude", "URL Mapa"];
    const rows = filteredEntries.map(e => [
      e.userName,
      e.timestamp ? format(e.timestamp.toDate(), 'dd/MM/yyyy') : '',
      e.timestamp ? format(e.timestamp.toDate(), 'HH:mm:ss') : '',
      e.type === 'in' ? 'Entrada' : 'Saida',
      e.location?.lat || '',
      e.location?.lng || '',
      e.location ? `https://www.google.com/maps?q=${e.location.lat},${e.location.lng}` : ''
    ]);

    const csvContent = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `relatorio_pontos_${format(new Date(), 'dd_MM_yyyy')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToPDF = () => {
    if (filteredEntries.length === 0) return;

    const doc = new jsPDF();
    const title = "Relatorio de Pontos - Ponto Conecta Lan House";
    const dateRange = (startDate || endDate) 
      ? `Periodo: ${startDate || 'Inicio'} ate ${endDate || 'Fim'}`
      : `Data: ${format(new Date(), 'dd/MM/yyyy')}`;

    doc.setFontSize(18);
    doc.text(title, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(dateRange, 14, 30);

    const tableColumn = ["Funcionario", "Data", "Hora", "Tipo", "Localizacao"];
    const tableRows = filteredEntries.map(e => [
      e.userName,
      e.timestamp ? format(e.timestamp.toDate(), 'dd/MM/yyyy') : '',
      e.timestamp ? format(e.timestamp.toDate(), 'HH:mm:ss') : '',
      e.type === 'in' ? 'Entrada' : 'Saida',
      e.location ? `${e.location.lat.toFixed(4)}, ${e.location.lng.toFixed(4)}` : 'N/A'
    ]);

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 35,
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 9 }
    });

    const fileName = `relatorio_pontos_${format(new Date(), 'dd_MM_yyyy')}.pdf`;
    doc.save(fileName);
  };

  const usersWithBank = users.map(user => {
    if (!user.uid || !user.workload) return { ...user, totalWorked: 0, totalExpected: 0, bankOfHours: 0 };
    
    // Filter entries by current range if activeTab is 'bank'
    const userEntries = allEntries
      .filter(e => e.userId === user.uid && e.timestamp)
      .filter(e => {
        if (activeTab === 'bank' && (startDate || endDate)) {
          const entryDate = e.timestamp!.toDate();
          const start = startDate ? startOfDay(parseISO(startDate)) : null;
          const end = endDate ? endOfDay(parseISO(endDate)) : null;
          if (start && end) return isWithinInterval(entryDate, { start, end });
          if (start) return entryDate >= start;
          if (end) return entryDate <= end;
        }
        return true;
      })
      .sort((a, b) => a.timestamp!.toMillis() - b.timestamp!.toMillis());
    
    // Group by day
    const days: { [key: string]: TimeEntry[] } = {};
    userEntries.forEach(e => {
      const date = format(e.timestamp!.toDate(), 'yyyy-MM-dd');
      if (!days[date]) days[date] = [];
      days[date].push(e);
    });

    let totalWorkedMinutes = 0;
    let totalExpectedMinutes = 0;

    Object.entries(days).forEach(([dateStr, dayEntries]) => {
      let dailyMinutes = 0;
      for (let i = 0; i < dayEntries.length - 1; i += 2) {
        if (dayEntries[i].type === 'in' && dayEntries[i+1]?.type === 'out') {
          const diff = (dayEntries[i+1].timestamp!.toMillis() - dayEntries[i].timestamp!.toMillis()) / (1000 * 60);
          dailyMinutes += diff;
        }
      }
      
      // Calculate workload based on day of week
      // Get day of week from first entry of the day
      const dayDate = dayEntries[0].timestamp!.toDate();
      const dayOfWeek = dayDate.getDay(); // 0: Sun, 1: Mon, ..., 6: Sat
      
      let workloadMinutes = 0;
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        // Mon-Fri: Use workload or 8h default
        workloadMinutes = (user.workload || 8) * 60;
      } else if (dayOfWeek === 6) {
        // Saturday: Half of workload or 4h default
        workloadMinutes = ((user.workload || 8) / 2) * 60;
      }
      // Sunday: 0 workload
      
      totalWorkedMinutes += dailyMinutes;
      totalExpectedMinutes += workloadMinutes;
    });

    return { 
      ...user, 
      totalWorked: Math.round(totalWorkedMinutes), 
      totalExpected: Math.round(totalExpectedMinutes),
      bankOfHours: Math.round(totalWorkedMinutes - totalExpectedMinutes) 
    };
  });

  const filteredUsers = usersWithBank.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (u.matricula && u.matricula.includes(searchTerm));
    const matchesStatus = userStatusFilter === 'all' || u.status === userStatusFilter;
    const matchesDept = departmentFilter === 'all' || u.department === departmentFilter;
    
    return matchesSearch && matchesStatus && matchesDept;
  });

  const departments = Array.from(new Set(users.map(u => u.department).filter(Boolean))) as string[];

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Simple compression using canvas
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 400;
        const MAX_HEIGHT = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        setEditingUser(prev => prev ? { ...prev, photoURL: dataUrl } : null);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const exportBankToCSV = () => {
    const headers = ["Funcionario", "Matricula", "Horas Trabalhadas", "Horas Esperadas", "Saldo (Minutos)", "Saldo Formatado"];
    const rows = filteredUsers.map(u => [
      u.name,
      u.matricula || '---',
      (u.totalWorked / 60).toFixed(2),
      (u.totalExpected / 60).toFixed(2),
      u.bankOfHours,
      `${Math.floor(Math.abs(u.bankOfHours) / 60)}h ${Math.abs(u.bankOfHours) % 60}m ${u.bankOfHours >= 0 ? '(+)' : '(-)'}`
    ]);

    const csvContent = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `banco_horas_${format(new Date(), 'dd_MM_yyyy')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportBankToPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Relatorio de Banco de Horas", 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    const dateRange = (startDate || endDate) 
      ? `Periodo: ${startDate || 'Inicio'} ate ${endDate || 'Fim'}`
      : `Relatorio Geral ate ${format(new Date(), 'dd/MM/yyyy')}`;
    doc.text(dateRange, 14, 30);

    const tableColumn = ["Funcionario", "Matricula", "Trabalhadas", "Esperadas", "Saldo"];
    const tableRows = filteredUsers.map(u => [
      u.name,
      u.matricula || '---',
      `${Math.floor(u.totalWorked / 60)}h ${u.totalWorked % 60}m`,
      `${Math.floor(u.totalExpected / 60)}h ${u.totalExpected % 60}m`,
      `${Math.floor(Math.abs(u.bankOfHours) / 60)}h ${Math.abs(u.bankOfHours) % 60}m ${u.bankOfHours >= 0 ? '(+)' : '(-)'}`
    ]);

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 35,
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 9 }
    });

    doc.save(`banco_horas_${format(new Date(), 'dd_MM_yyyy')}.pdf`);
  };

  const viewUserHistory = (userId: string) => {
    setUserFilter(userId);
    setActiveTab('logs');
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setTypeFilter('all');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Chart data calculation for the last 7 days
  const chartData = Array.from({ length: 7 }).map((_, i) => {
    const d = subDays(new Date(), 6 - i);
    const dateStr = format(d, 'yyyy-MM-dd');
    const dayLabel = format(d, 'dd/MM');
    
    const dayEntries = allEntries.filter(e => e.timestamp && format(e.timestamp.toDate(), 'yyyy-MM-dd') === dateStr);
    
    return {
      name: dayLabel,
      Entradas: dayEntries.filter(e => e.type === 'in').length,
      Saídas: dayEntries.filter(e => e.type === 'out').length,
    };
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="text-slate-500 text-sm">Funcionários</div>
              <div className="text-2xl font-bold text-slate-800">{users.length}</div>
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <ClipboardList className="w-6 h-6" />
            </div>
            <div>
              <div className="text-slate-500 text-sm">Pontos hoje</div>
              <div className="text-2xl font-bold text-slate-800">
                {allEntries.filter(e => e.timestamp && format(e.timestamp.toDate(), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')).length}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="text-slate-500 text-sm">Administradores</div>
              <div className="text-2xl font-bold text-slate-800">
                {users.filter(u => u.role === 'admin').length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Visual Summary Chart */}
      <div className="bg-white p-6 rounded-3xl shadow-lg border border-slate-100">
        <div className="flex items-center gap-2 mb-6">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-bold text-slate-800">Fluxo de Pontos (Últimos 7 dias)</h2>
        </div>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#94a3b8', fontSize: 12 }}
              />
              <Tooltip 
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Legend iconType="circle" />
              <Bar dataKey="Entradas" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar dataKey="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabs & Content */}
      <div className="bg-white rounded-3xl shadow-lg border border-slate-100 overflow-hidden">
        <div className="flex border-b border-slate-100">
          <button 
            onClick={() => { setActiveTab('logs'); setSearchTerm(''); }}
            className={cn(
              "flex-1 py-4 px-6 font-bold transition-colors border-b-2",
              activeTab === 'logs' ? "text-blue-600 border-blue-600 bg-blue-50/30" : "text-slate-400 border-transparent hover:text-slate-600"
            )}
          >
            Log de Pontos
          </button>
          <button 
            onClick={() => { setActiveTab('users'); setSearchTerm(''); }}
            className={cn(
              "flex-1 py-4 px-6 font-bold transition-colors border-b-2",
              activeTab === 'users' ? "text-blue-600 border-blue-600 bg-blue-50/30" : "text-slate-400 border-transparent hover:text-slate-600"
            )}
          >
            Gestão de Funcionários
          </button>
          <button 
            onClick={() => { setActiveTab('bank'); setSearchTerm(''); }}
            className={cn(
              "flex-1 py-4 px-6 font-bold transition-colors border-b-2",
              activeTab === 'bank' ? "text-blue-600 border-blue-600 bg-blue-50/30" : "text-slate-400 border-transparent hover:text-slate-600"
            )}
          >
            Banco de Horas
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'logs' && (
            <div className="space-y-6">
              {/* Filter Bar */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
                <div className="space-y-1.5 lg:col-span-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Buscar por Nome</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Nome..."
                      className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Funcionário</label>
                  <select 
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer"
                    value={userFilter}
                    onChange={(e) => setUserFilter(e.target.value)}
                  >
                    <option value="all">Todos</option>
                    {users.map(u => (
                      <option key={(u as any).docId || u.email} value={u.uid}>{u.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Tipo</label>
                  <select 
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as any)}
                  >
                    <option value="all">Todos</option>
                    <option value="in">Entradas</option>
                    <option value="out">Saídas</option>
                  </select>
                </div>

                <div className="space-y-1.5 text-center">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 flex items-center justify-center gap-1">
                    <Calendar className="w-3 h-3" /> De
                  </label>
                  <input 
                    type="date"
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 flex items-center justify-center gap-1">
                    <Calendar className="w-3 h-3" /> Até
                  </label>
                  <input 
                    type="date"
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={exportToCSV}
                    className="flex-1 px-3 py-2 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all shadow-lg shadow-slate-200 text-xs flex items-center justify-center gap-1.5 h-10"
                  >
                    <Download className="w-4 h-4" />
                    CSV
                  </button>
                  <button 
                    onClick={exportToPDF}
                    className="flex-1 px-3 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 text-xs flex items-center justify-center gap-1.5 h-10"
                  >
                    <Download className="w-4 h-4" />
                    PDF
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-xs uppercase tracking-wider">
                      <th className="px-6 py-4 font-bold">Funcionário</th>
                      <th className="px-6 py-4 font-bold text-center">Data</th>
                      <th className="px-6 py-4 font-bold text-center">Hora</th>
                      <th className="px-6 py-4 font-bold text-center">Tipo</th>
                      <th className="px-6 py-4 font-bold text-center">Local</th>
                      <th className="px-6 py-4 font-bold text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEntries.map(entry => (
                      <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                              <UserIcon className="w-4 h-4" />
                            </div>
                            <span className="font-semibold text-slate-700">{entry.userName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-slate-500 text-sm text-center">
                          {entry.timestamp ? format(entry.timestamp.toDate(), 'dd/MM/yyyy') : '---'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap font-mono font-bold text-slate-800 text-center">
                          {entry.timestamp ? format(entry.timestamp.toDate(), 'HH:mm:ss') : '...'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide",
                            entry.type === 'in' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                          )}>
                            {entry.type === 'in' ? 'Entrada' : 'Saída'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          {entry.location ? (
                            <a 
                              href={`https://www.google.com/maps?q=${entry.location.lat},${entry.location.lng}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 transition-colors"
                              title={`${entry.location.lat}, ${entry.location.lng}`}
                            >
                              <MapPin className="w-4 h-4" />
                              <span className="text-[10px] font-bold uppercase">Ver</span>
                            </a>
                          ) : (
                            <span className="text-slate-300">---</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => handleOpenEntryModal(entry)}
                              className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Editar registro"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => deleteEntry(entry.id!)}
                              className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Excluir registro"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredEntries.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                          Nenhum registro encontrado
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 mb-6">
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                  <div className="relative w-full sm:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Buscar por nome, e-mail ou matrícula..."
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <button 
                    onClick={() => handleOpenUserModal()}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
                  >
                    <UserPlus className="w-5 h-5" />
                    Novo Funcionário
                  </button>
                </div>

                <div className="flex flex-wrap gap-3">
                  <div className="flex-1 min-w-[150px]">
                    <select 
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer font-medium text-slate-600"
                      value={userStatusFilter}
                      onChange={(e) => setUserStatusFilter(e.target.value as any)}
                    >
                      <option value="all">Todos os Status</option>
                      <option value="active">Ativos</option>
                      <option value="inactive">Inativos</option>
                    </select>
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <select 
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer font-medium text-slate-600"
                      value={departmentFilter}
                      onChange={(e) => setDepartmentFilter(e.target.value)}
                    >
                      <option value="all">Todos os Departamentos</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <AnimatePresence>
                  {filteredUsers.map(user => (
                    <motion.div 
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      key={(user as any).docId || user.email} 
                      className={cn(
                        "bg-white p-5 rounded-3xl border transition-all relative group flex flex-col justify-between h-full",
                        user.status === 'inactive' ? "border-slate-100 opacity-60 bg-slate-50/50" : "border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1"
                      )}
                    >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100 flex items-center justify-center overflow-hidden",
                          user.status === 'inactive' ? "text-slate-300" : "text-slate-400"
                        )}>
                          {user.photoURL ? (
                            <img src={user.photoURL} alt={user.name} className="w-full h-full object-cover" />
                          ) : (
                            <UserIcon className="w-6 h-6" />
                          )}
                        </div>
                        <div className="overflow-hidden">
                          <div className="font-bold text-slate-800 truncate flex items-center gap-2">
                            {user.name}
                            {user.status === 'inactive' && (
                              <span className="text-[8px] px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded uppercase tracking-wider">Inativo</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 truncate">{user.email}</div>
                          {user.password && (
                            <div className="mt-1 flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 border border-amber-100 rounded-lg text-[9px] text-amber-700 font-bold uppercase w-fit">
                              <Lock className="w-2.5 h-2.5" />
                              Senha: {user.password}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                            {user.matricula && <div className="text-[10px] text-slate-400 font-mono">Matrícula: {user.matricula}</div>}
                            {user.department && <div className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">{user.department}</div>}
                            {typeof user.bankOfHours === 'number' && (
                              <div className={cn(
                                "text-[10px] font-bold",
                                user.bankOfHours >= 0 ? "text-emerald-600" : "text-red-500"
                              )}>
                                Banco: {Math.floor(Math.abs(user.bankOfHours) / 60)}h {Math.abs(user.bankOfHours) % 60}m {user.bankOfHours >= 0 ? '(+)' : '(-)'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                      <div className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase",
                        user.role === 'admin' ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                      )}>
                        {user.role === 'admin' && <ShieldCheck className="w-3 h-3" />}
                        {user.role}
                      </div>
                      {!user.uid ? (
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded italic">
                            Email Pendente
                          </span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-400 font-medium">Ativo</div>
                      )}
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleOpenUserModal(user)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-50 text-slate-600 font-bold text-[10px] uppercase hover:bg-blue-50 hover:text-blue-600 transition-all border border-transparent hover:border-blue-100 shadow-sm"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          Alterar
                        </button>
                        <button 
                          onClick={() => deleteUser((user as any).docId || user.uid || user.email)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-50 text-slate-600 font-bold text-[10px] uppercase hover:bg-red-50 hover:text-red-600 transition-all border border-transparent hover:border-red-100 shadow-sm"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Excluir
                        </button>
                      </div>
                      <button 
                        onClick={() => viewUserHistory(user.uid)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-50 text-emerald-600 font-bold text-[10px] uppercase hover:bg-emerald-100 transition-all border border-emerald-100 shadow-sm"
                      >
                        <History className="w-3.5 h-3.5" />
                        Histórico de Pontos
                      </button>
                    </div>
                  </motion.div>
                ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {activeTab === 'bank' && (
            <div className="space-y-6">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-col md:flex-row gap-4 items-end">
                <div className="space-y-1.5 flex-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Filtrar Período</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="date"
                      className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                    <span className="text-slate-400">até</span>
                    <input 
                      type="date"
                      className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                  <button 
                    onClick={exportBankToCSV}
                    className="flex-1 px-4 py-2 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all shadow-lg shadow-slate-200 text-sm flex items-center justify-center gap-2 h-10"
                  >
                    <Download className="w-4 h-4" />
                    CSV
                  </button>
                  <button 
                    onClick={exportBankToPDF}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 text-sm flex items-center justify-center gap-2 h-10"
                  >
                    <Download className="w-4 h-4" />
                    PDF
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-xs uppercase tracking-wider">
                      <th className="px-6 py-4 font-bold">Funcionário</th>
                      <th className="px-6 py-4 font-bold text-center">Horas Trabalhadas</th>
                      <th className="px-6 py-4 font-bold text-center">Horas Esperadas</th>
                      <th className="px-6 py-4 font-bold text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map(user => (
                      <tr key={(user as any).docId || user.email} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 overflow-hidden border border-slate-200 shadow-sm">
                              {user.photoURL ? (
                                <img src={user.photoURL} alt={user.name} className="w-full h-full object-cover" />
                              ) : (
                                <UserIcon className="w-5 h-5" />
                              )}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-700">{user.name}</div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400">{user.matricula || 'Sem matrícula'}</span>
                                {user.password && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded font-bold uppercase flex items-center gap-1">
                                    <Lock className="w-2 h-2" /> {user.password}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-slate-600 font-medium">
                          {Math.floor(user.totalWorked / 60)}h {user.totalWorked % 60}m
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-slate-500">
                          {Math.floor(user.totalExpected / 60)}h {user.totalExpected % 60}m
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wide",
                            user.bankOfHours >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                          )}>
                            {Math.floor(Math.abs(user.bankOfHours) / 60)}h {Math.abs(user.bankOfHours) % 60}m {user.bankOfHours >= 0 ? '(+)' : '(-)'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                          Nenhum dado disponível para o período selecionado
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User Modal */}
      <AnimatePresence>
        {isUserModalOpen && editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="text-xl font-bold text-slate-800">
                  {editingUser.uid ? 'Editar Cadastro' : 'Novo Funcionário'}
                </h3>
                <button onClick={() => setIsUserModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                <div className="flex flex-col items-center gap-4 mb-2">
                  <div className="relative group">
                    <div className="w-24 h-24 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center overflow-hidden shadow-inner">
                      {editingUser.photoURL ? (
                        <img src={editingUser.photoURL} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <UserIcon className="w-10 h-10 text-slate-300" />
                      )}
                    </div>
                    <label className="absolute bottom-0 right-0 p-2 bg-blue-600 text-white rounded-full shadow-lg cursor-pointer hover:bg-blue-700 transition-all border-2 border-white">
                      <Camera className="w-4 h-4" />
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handlePhotoUpload} 
                        className="hidden" 
                        capture="user"
                      />
                    </label>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Foto do Funcionário</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">Toque no ícone para capturar da câmera ou escolher da galeria</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Nome Completo</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700"
                    placeholder="Ex: João da Silva"
                    value={editingUser.name || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">E-mail Corporativo (Google)</label>
                  <input 
                    type="email" 
                    readOnly={!!editingUser.uid}
                    className={cn(
                      "w-full px-4 py-2.5 border rounded-xl outline-none text-slate-700",
                      editingUser.uid ? "bg-slate-100 border-slate-200 cursor-not-allowed" : "bg-slate-50 border-slate-200 focus:ring-2 focus:ring-blue-500/20"
                    )}
                    placeholder="funcionario@empresa.com"
                    value={editingUser.email || ''}
                    onChange={(e) => !editingUser.uid && setEditingUser({ ...editingUser, email: e.target.value })}
                  />
                  {!editingUser.uid && <p className="text-[10px] text-slate-400">O funcionário deve usar este e-mail para logar.</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">CPF</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700"
                      placeholder="000.000.000-00"
                      value={editingUser.cpf || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, cpf: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Matrícula</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700"
                      placeholder="Ex: 12345"
                      value={editingUser.matricula || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, matricula: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Departamento</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700"
                      placeholder="Ex: Vendas"
                      value={editingUser.department || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Perfil/Cargo</label>
                    <select 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700 appearance-none"
                      value={editingUser.role || 'employee'}
                      onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as UserRole })}
                    >
                      <option value="employee">Funcionário</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Carga Horária (Seg-Sex - Horas/Dia)</label>
                    <input 
                      type="number" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700"
                      placeholder="Ex: 8"
                      value={editingUser.workload || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, workload: Number(e.target.value) })}
                    />
                    <p className="text-[9px] text-slate-400 ml-1">Sábados serão calculados automaticamente com metade desta carga.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Senha de Acesso</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                      <button 
                        type="button"
                        onClick={() => setShowModalPassword(!showModalPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showModalPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <input 
                        type={showModalPassword ? "text" : "password"} 
                        className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700 font-mono"
                        placeholder="Senha inicial"
                        value={editingUser.password || ''}
                        onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Status da Conta</label>
                  <div className="flex gap-2">
                      <button 
                        onClick={() => setEditingUser({...editingUser, status: 'active'})}
                        className={cn(
                          "flex-1 py-2 px-2 rounded-xl border font-bold text-[10px] uppercase transition-all",
                          editingUser.status === 'active' 
                            ? "bg-emerald-50 border-emerald-200 text-emerald-600 shadow-sm" 
                            : "bg-white border-slate-100 text-slate-400 hover:border-slate-200"
                        )}
                      >
                        Ativo
                      </button>
                      <button 
                        onClick={() => setEditingUser({...editingUser, status: 'inactive'})}
                        className={cn(
                          "flex-1 py-2 px-2 rounded-xl border font-bold text-[10px] uppercase transition-all",
                          editingUser.status === 'inactive' 
                            ? "bg-red-50 border-red-200 text-red-600 shadow-sm" 
                            : "bg-white border-slate-100 text-slate-400 hover:border-slate-200"
                        )}
                      >
                        Inativo
                      </button>
                    </div>
                  </div>
                </div>

              <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setIsUserModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSaveUser}
                  disabled={isSaving}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-100 disabled:opacity-50"
                >
                  {isSaving ? <X className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  {editingUser.uid ? 'Atualizar' : 'Cadastrar'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Entry Editing Modal */}
      <AnimatePresence>
        {isEntryModalOpen && editingEntry && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="text-xl font-bold text-slate-800">Editar Registro de Ponto</h3>
                <button onClick={() => setIsEntryModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-blue-600 shadow-sm">
                    <UserIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{editingEntry.userName}</p>
                    <p className="text-xs text-slate-500 uppercase font-black tracking-widest">{editingEntry.type === 'in' ? 'Entrada' : 'Saída'}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Data e Hora</label>
                    <input 
                      type="datetime-local" 
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 font-bold"
                      value={entryDateTime}
                      onChange={(e) => setEntryDateTime(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Tipo de Registro</label>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setEditingEntry({...editingEntry, type: 'in'})}
                        className={cn(
                          "flex-1 py-3 rounded-xl border font-bold text-xs uppercase transition-all",
                          editingEntry.type === 'in' 
                            ? "bg-emerald-50 border-emerald-200 text-emerald-600 shadow-sm" 
                            : "bg-white border-slate-100 text-slate-400"
                        )}
                      >
                        Entrada
                      </button>
                      <button 
                        onClick={() => setEditingEntry({...editingEntry, type: 'out'})}
                        className={cn(
                          "flex-1 py-3 rounded-xl border font-bold text-xs uppercase transition-all",
                          editingEntry.type === 'out' 
                            ? "bg-red-50 border-red-200 text-red-600 shadow-sm" 
                            : "bg-white border-slate-100 text-slate-400"
                        )}
                      >
                        Saída
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setIsEntryModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSaveEntry}
                  disabled={isSaving}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-100 disabled:opacity-50"
                >
                  {isSaving ? <X className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  Salvar Alterações
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

