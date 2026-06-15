import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, setDoc, serverTimestamp, getDocs, where, Timestamp } from 'firebase/firestore';
import { UserProfile, TimeEntry, UserRole, Justification, JustificationType } from '../types';
import { format } from 'date-fns';
import { Users, ClipboardList, Trash2, Edit2, ShieldCheck, User as UserIcon, Search, UserPlus, X, Save, Download, MapPin, Filter, Calendar, History, BarChart3, Camera, Upload, Lock, Eye, EyeOff, Wallet, CalendarDays, AlertCircle, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { startOfDay, endOfDay, isWithinInterval, parseISO, subDays } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const AdminDashboard: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);
  const [justifications, setJustifications] = useState<Justification[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'logs' | 'bank' | 'payroll'>('logs');
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
  
  // Leaves / Justification states
  const [isJustificationModalOpen, setIsJustificationModalOpen] = useState(false);
  const [editingJustification, setEditingJustification] = useState<Partial<Justification> | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [selectedPayrollUser, setSelectedPayrollUser] = useState<UserProfile | null>(null);
  
  const [isSaving, setIsSaving] = useState(false);

  const [showModalPassword, setShowModalPassword] = useState(false);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: (() => void) | (() => Promise<void>);
    isDanger?: boolean;
    confirmText?: string;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const requestConfirm = (
    title: string,
    message: string,
    onConfirm: (() => void) | (() => Promise<void>),
    isDanger = true,
    confirmText = 'Continuar'
  ) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm,
      isDanger,
      confirmText
    });
  };

  const isAfterContractualTime = (entry: TimeEntry) => {
    if (!entry.timestamp) return false;
    
    // Get entry time
    const entryDate = entry.timestamp.toDate();
    const entryHours = entryDate.getHours();
    const entryMinutes = entryDate.getMinutes();
    const actualMinutes = entryHours * 60 + entryMinutes;
    
    if (entry.type === 'in') {
      // 5-minute tolerance on morning (09:00 -> 09:05) or afternoon (13:30 -> 13:35) entry
      if (actualMinutes < 720) {
        // Morning Shift: target is 09:00 (540m), late if > 09:05 (545m)
        return actualMinutes > 545;
      } else {
        // Afternoon Shift: target is 13:30 (810m), late if > 13:35 (815m)
        return actualMinutes > 815;
      }
    } else if (entry.type === 'out') {
      // Exits are expected at 12:30 (750m) and 18:00 (1080m)
      // Highlight if they punch after contract out (excess overtime) or if it's general out of range
      if (actualMinutes < 900) {
        // Morning exit target is 12:30
        return actualMinutes > 750;
      } else {
        // Afternoon exit target is 18:00
        return actualMinutes > 1080;
      }
    }
    
    return false;
  };

  const calculateRates = (user: UserProfile) => {
    const salary = user.salary || 0;
    if (!salary) return { daily: 0, hourly: 0 };
    const daily = salary / 30;
    const workload = user.workload || 8;
    const weeklyHours = workload * 5.5;
    const divisor = weeklyHours * 5;
    const hourly = salary / divisor;
    return { daily, hourly };
  };

  const getDelayAndDiscount = (entry: TimeEntry) => {
    if (!entry.timestamp) return { minutes: 0, discount: 0 };
    const user = users.find(u => u.uid === entry.userId || (u as any).docId === entry.userId);
    if (!user) return { minutes: 0, discount: 0 };
    
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
        const salary = user.salary || 0;
        if (salary > 0) {
          const { hourly } = calculateRates(user);
          const discount = (diffMinutes / 60) * hourly;
          return { minutes: diffMinutes, discount };
        }
        return { minutes: diffMinutes, discount: 0 };
      }
    }
    
    return { minutes: 0, discount: 0 };
  };

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

    const justificationsUnsubscribe = onSnapshot(collection(db, 'justifications'), (snapshot) => {
      setJustifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Justification));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'justifications'));

    return () => {
      usersUnsubscribe();
      entriesUnsubscribe();
      justificationsUnsubscribe();
    };
  }, []);

  const handleOpenUserModal = (user?: UserProfile) => {
    setEditingUser(user ? {
      ...user,
      contractIn: user.contractIn || '09:00',
      contractOut: user.contractOut || '18:00',
      jobTitle: user.jobTitle || '',
      salary: user.salary || undefined
    } : { 
      name: '', 
      email: '', 
      role: 'employee', 
      cpf: '', 
      matricula: '', 
      department: '', 
      status: 'active',
      workload: 8,
      contractIn: '09:00',
      contractOut: '18:00',
      jobTitle: '',
      salary: undefined,
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

  const handleCreateNewEntry = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now.getTime() - offset).toISOString().slice(0, 16);
    setEditingEntry({
      userId: '',
      userName: '',
      type: 'in',
      notes: ''
    });
    setEntryDateTime(localISOTime);
    setIsEntryModalOpen(true);
  };

  const handleSaveEntry = async () => {
    if (!editingEntry || !entryDateTime) return;
    
    // Non-null checks for new entries
    if (!editingEntry.id && (!editingEntry.userId || !editingEntry.type)) {
      alert('Por favor, selecione um colaborador.');
      return;
    }

    setIsSaving(true);
    try {
      const newTimestamp = Timestamp.fromDate(new Date(entryDateTime));
      
      if (editingEntry.id) {
        // Update existing entry
        await updateDoc(doc(db, 'timeEntries', editingEntry.id), {
          timestamp: newTimestamp,
          type: editingEntry.type,
          notes: editingEntry.notes || ''
        });
      } else {
        // Create new entry
        const selectedUser = users.find(u => u.uid === editingEntry.userId || (u as any).docId === editingEntry.userId);
        const resolvedUserName = selectedUser ? selectedUser.name : 'Colaborador';
        const newDocRef = doc(collection(db, "timeEntries"));
        await setDoc(newDocRef, {
          userId: editingEntry.userId,
          userName: resolvedUserName,
          timestamp: newTimestamp,
          type: editingEntry.type,
          notes: editingEntry.notes || 'Inserção Manual'
        });
      }
      setIsEntryModalOpen(false);
    } catch (error) {
      const path = editingEntry.id ? `timeEntries/${editingEntry.id}` : 'timeEntries';
      handleFirestoreError(error, OperationType.WRITE, path);
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
        contractIn: editingUser.contractIn || '09:00',
        contractOut: editingUser.contractOut || '18:00',
        jobTitle: editingUser.jobTitle || '',
        salary: editingUser.salary !== undefined ? Number(editingUser.salary) : 0,
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

  const deleteUser = (uidOrEmail: string) => {
    requestConfirm(
      'Remover Funcionário',
      'Tem certeza que deseja remover este funcionário? Isso não apagará o histórico de pontos, mas impedirá o acesso definitivo do mesmo ao sistema.',
      async () => {
        try {
          await deleteDoc(doc(db, 'users', uidOrEmail));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `users/${uidOrEmail}`);
        }
      },
      true,
      'Excluir'
    );
  };

  const deleteEntry = (id: string) => {
    requestConfirm(
      'Excluir Registro de Ponto',
      'Tem certeza que deseja excluir permanentemente este registro de ponto? Esta ação não pode ser desfeita.',
      async () => {
        try {
          await deleteDoc(doc(db, 'timeEntries', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `timeEntries/${id}`);
        }
      },
      true,
      'Excluir'
    );
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

  const handleOpenJustificationModal = (just?: Justification) => {
    setEditingJustification(just ? {
      ...just
    } : {
      userId: '',
      userName: '',
      type: 'abono',
      startDate: format(new Date(), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
      minutesAbono: undefined,
      description: ''
    });
    setIsJustificationModalOpen(true);
  };

  const handleSaveJustification = async () => {
    if (!editingJustification || !editingJustification.userId || !editingJustification.type || !editingJustification.startDate || !editingJustification.endDate || !editingJustification.description) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }
    
    setIsSaving(true);
    try {
      const targetUser = users.find(u => u.uid === editingJustification.userId);
      const userName = targetUser ? targetUser.name : 'Funcionário';
      
      const payload = {
        userId: editingJustification.userId,
        userName,
        type: editingJustification.type,
        startDate: editingJustification.startDate,
        endDate: editingJustification.endDate,
        description: editingJustification.description,
        minutesAbono: editingJustification.minutesAbono ? Number(editingJustification.minutesAbono) : null,
      };

      if (editingJustification.id) {
        await updateDoc(doc(db, 'justifications', editingJustification.id), payload);
      } else {
        const newDocRef = doc(collection(db, 'justifications'));
        await setDoc(newDocRef, {
          ...payload,
          createdAt: serverTimestamp()
        });
      }
      setIsJustificationModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'justifications');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteJustification = (id: string) => {
    requestConfirm(
      'Excluir Justificativa',
      'Tem certeza que deseja excluir esta justificativa? Esta ação não pode ser desfeita.',
      async () => {
        try {
          await deleteDoc(doc(db, 'justifications', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `justifications/${id}`);
        }
      },
      true,
      'Excluir'
    );
  };

  const handleResetAllPointData = () => {
    requestConfirm(
      '🚨 ATENÇÃO - EXCLUSÃO TOTAL',
      'Você está prestes a EXCLUIR PERMANENTEMENTE todos os registros de batida de ponto e justificativas (abonos, faltas, férias) de TODOS os colaboradores. Esta ação é irreversível.\n\nDeseja prosseguir com a exclusão total?',
      () => {
        // Encadeamento da segunda confirmação após um pequeno timeout para suavizar a transição
        setTimeout(() => {
          requestConfirm(
            '⚠️ CONFIRMAÇÃO CRÍTICA FINAL',
            'Tem certeza ABSOLUTA? Todos os cálculos de folha de pagamento e banco de horas serão redefinidos para os valores bases padrão. Pressione o botão abaixo para realizar a limpeza definitiva do sistema.',
            async () => {
              setIsSaving(true);
              try {
                const timeEntriesSnap = await getDocs(collection(db, 'timeEntries'));
                const justificationsSnap = await getDocs(collection(db, 'justifications'));

                const deletePromises = [
                  ...timeEntriesSnap.docs.map(docSnap => deleteDoc(doc(db, 'timeEntries', docSnap.id))),
                  ...justificationsSnap.docs.map(docSnap => deleteDoc(doc(db, 'justifications', docSnap.id)))
                ];

                await Promise.all(deletePromises);
                alert('✅ Sucesso! Todos os dados de batidas de ponto e justificativas foram apagados com êxito.');
              } catch (error) {
                console.error('Error resetting point data:', error);
                alert('Ocorreu um erro ao excluir as coleções do banco de dados.');
              } finally {
                setIsSaving(false);
              }
            },
            true,
            'APAGAR TUDO DEFINITIVAMENTE'
          );
        }, 300);
      },
      true,
      'Sim, Prosseguir'
    );
  };

  const calculatePayrollForUser = (user: UserProfile, monthYearStr: string) => {
    const [yearStr, monthStr] = monthYearStr.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    
    const lastDay = new Date(year, month + 1, 0).getDate();
    const baseSalary = user.salary || 0;
    
    if (baseSalary === 0) {
      return {
        baseSalary: 0,
        delayMinutes: 0,
        delayDiscount: 0,
        abonoMinutes: 0,
        abonoDiscountRecovered: 0,
        justifiedAbsenceDays: 0,
        vacationDays: 0,
        unexcusedAbsenceDays: 0,
        unexcusedAbsenceDiscount: 0,
        vacationBonus13: 0,
        netSalary: 0,
        daysBreakdown: [] as any[]
      };
    }

    const { daily, hourly } = calculateRates(user);
    
    let totalDelayMinutes = 0;
    let totalDelayDiscount = 0;
    
    let justifiedAbsenceCount = 0;
    let vacationCount = 0;
    let unexcusedAbsenceCount = 0;
    let workedDaysCount = 0;

    const userJusts = justifications.filter(j => j.userId === user.uid);
    
    const monthEntries = allEntries.filter(e => {
      if (e.userId !== user.uid || !e.timestamp) return false;
      const d = e.timestamp.toDate();
      return d.getFullYear() === year && d.getMonth() === month;
    });

    const daysBreakdown = [];

    for (let day = 1; day <= lastDay; day++) {
      const currentDate = new Date(year, month, day);
      const isSunday = currentDate.getDay() === 0;
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      
      const justForDay = userJusts.find(j => dateStr >= j.startDate && dateStr <= j.endDate);
      const dayEntries = monthEntries.filter(e => format(e.timestamp.toDate(), 'yyyy-MM-dd') === dateStr);
      const hasEntries = dayEntries.length > 0;
      
      let dayType: 'workday' | 'sunday' | 'ferias' | 'falta_justificada' | 'falta_injustificada' = 'workday';
      let dayDelayMinutes = 0;
      let dayDelayDiscount = 0;
      let dayAbonoMinutes = 0;
      let dayAbonoDiscount = 0;

      if (isSunday) {
        dayType = 'sunday';
      } else if (justForDay) {
        if (justForDay.type === 'ferias') {
          dayType = 'ferias';
          vacationCount++;
        } else if (justForDay.type === 'falta_justificada') {
          dayType = 'falta_justificada';
          justifiedAbsenceCount++;
        } else if (justForDay.type === 'abono') {
          if (justForDay.minutesAbono) {
            dayAbonoMinutes = justForDay.minutesAbono;
          } else {
            dayType = 'falta_justificada';
            justifiedAbsenceCount++;
          }
        }
      } else if (!hasEntries) {
        dayType = 'falta_injustificada';
        unexcusedAbsenceCount++;
      } else {
        workedDaysCount++;
        
        dayEntries.forEach(entry => {
          if (entry.type === 'in') {
            const { minutes, discount } = getDelayAndDiscount(entry);
            if (minutes > 0) {
              dayDelayMinutes += minutes;
              dayDelayDiscount += discount;
            }
          }
        });
        
        const abonosForDay = userJusts.filter(j => j.type === 'abono' && dateStr >= j.startDate && dateStr <= j.endDate);
        abonosForDay.forEach(ab => {
          if (ab.minutesAbono) {
            dayAbonoMinutes += ab.minutesAbono;
          } else {
            dayAbonoMinutes = dayDelayMinutes;
          }
        });

        const cappedAbonoMinutes = Math.min(dayAbonoMinutes, dayDelayMinutes);
        dayAbonoDiscount = (cappedAbonoMinutes / 60) * hourly;
        
        totalDelayMinutes += dayDelayMinutes;
        totalDelayDiscount += dayDelayDiscount;
      }

      daysBreakdown.push({
        day,
        dateStr,
        dayOfWeek: currentDate.getDay(),
        type: dayType,
        hasEntries,
        delayMinutes: dayDelayMinutes,
        delayDiscount: dayDelayDiscount,
        abonoMinutes: dayAbonoMinutes,
        abonoDiscount: dayAbonoDiscount,
        justification: justForDay
      });
    }

    const unexcusedAbsenceDiscount = unexcusedAbsenceCount * daily;
    
    let totalAbonoMinutes = 0;
    let totalAbonoDiscount = 0;
    daysBreakdown.forEach(d => {
      totalAbonoMinutes += Math.min(d.abonoMinutes, d.delayMinutes);
      totalAbonoDiscount += d.abonoDiscount;
    });

    const netDelayDiscount = Math.max(0, totalDelayDiscount - totalAbonoDiscount);
    
    const vacationPay = vacationCount * daily;
    const vacationBonus13 = vacationCount > 0 ? (vacationPay / 3) : 0;

    const netSalary = Math.max(0, baseSalary - netDelayDiscount - unexcusedAbsenceDiscount + vacationBonus13);

    return {
      baseSalary,
      delayMinutes: totalDelayMinutes,
      delayDiscount: totalDelayDiscount,
      abonoMinutes: totalAbonoMinutes,
      abonoDiscountRecovered: totalAbonoDiscount,
      justifiedAbsenceDays: justifiedAbsenceCount,
      vacationDays: vacationCount,
      unexcusedAbsenceDays: unexcusedAbsenceCount,
      unexcusedAbsenceDiscount,
      vacationBonus13,
      netSalary,
      daysBreakdown
    };
  };

  const exportReceiptToPDF = (user: UserProfile, data: any) => {
    const doc = new jsPDF();
    
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("RECIBO DE PAGAMENTO DE SALARIO (HOLERITE)", 14, 20);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("PONTO CONECTA LAN HOUSE", 14, 27);
    doc.text(`Matricula: ${user.matricula || '---'} | CPF: ${user.cpf || '---'}`, 14, 32);
    doc.text(`Colaborador: ${user.name}`, 14, 37);
    doc.text(`Referente ao Mes: ${selectedMonth}`, 14, 42);
    
    doc.line(14, 46, 196, 46);
    
    const columns = ["Cod", "Descricao", "Referencia", "Proventos (+)", "Descontos (-)"];
    const rows = [];
    
    rows.push([
      "001",
      "Salario Base",
      "30 dias",
      data.baseSalary.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      ""
    ]);
    
    if (data.vacationDays > 0) {
      rows.push([
        "102",
        "Ferias Gozadas no Periodo",
        `${data.vacationDays} dias`,
        "",
        ""
      ]);
      rows.push([
        "103",
        "Adicional de Ferias 1/3",
        "1/3 Const.",
        data.vacationBonus13.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        ""
      ]);
    }
    
    if (data.justifiedAbsenceDays > 0) {
      rows.push([
        "201",
        "Faltas Justificadas (Abonadas)",
        `${data.justifiedAbsenceDays} dias`,
        "---",
        ""
      ]);
    }
    
    if (data.unexcusedAbsenceDays > 0) {
      rows.push([
        "501",
        "Faltas injustificadas",
        `${data.unexcusedAbsenceDays} dias`,
        "",
        data.unexcusedAbsenceDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      ]);
    }
    
    if (data.delayMinutes > 0) {
      const hours = Math.floor(data.delayMinutes / 60);
      const mins = Math.round(data.delayMinutes % 60);
      const delayTimeStr = `${hours}h ${mins}m`;
      
      rows.push([
        "505",
        "Atrasos / Estouro de Horario",
        delayTimeStr,
        "",
        data.delayDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      ]);
      
      if (data.abonoMinutes > 0) {
        const abHours = Math.floor(data.abonoMinutes / 60);
        const abMins = Math.round(data.abonoMinutes % 60);
        const abonoTimeStr = `${abHours}h ${abMins}m`;
        rows.push([
          "008",
          "Abono de Atrasos Registrados",
          abonoTimeStr,
          data.abonoDiscountRecovered.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
          ""
        ]);
      }
    }

    autoTable(doc, {
      head: [columns],
      body: rows,
      startY: 50,
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 9 }
    });
    
    const totalEarnings = data.baseSalary + data.vacationBonus13 + (data.delayMinutes > 0 ? data.abonoDiscountRecovered : 0);
    const totalDeductions = data.unexcusedAbsenceDiscount + (data.delayMinutes > 0 ? data.delayDiscount : 0);
    const netSalary = data.netSalary;
    
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Total Proventos: ${totalEarnings.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 14, finalY);
    doc.text(`Total Descontos: ${totalDeductions.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 14, finalY + 6);
    
    doc.setFont("helvetica", "bold");
    doc.text(`SALARIO LIQUIDO A RECEBER: ${netSalary.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 14, finalY + 14);
    
    doc.line(14, finalY + 35, 100, finalY + 35);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Ponto Conecta Lan House (Assinatura)", 14, finalY + 39);
    
    doc.line(110, finalY + 35, 196, finalY + 35);
    doc.text(`Fui cientificado do pagamento, ${user.name}`, 110, finalY + 39);
    
    doc.save(`holerite_${user.name.toLowerCase().replace(/\s+/g, '_')}_${selectedMonth}.pdf`);
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
        <div className="flex border-b border-slate-100 flex-wrap items-center justify-between">
          <div className="flex flex-wrap flex-1">
            <button 
              onClick={() => { setActiveTab('logs'); setSearchTerm(''); }}
              className={cn(
                "flex-1 min-w-[120px] py-4 px-4 font-bold transition-colors border-b-2 text-sm md:text-base",
                activeTab === 'logs' ? "text-blue-600 border-blue-600 bg-blue-50/30" : "text-slate-400 border-transparent hover:text-slate-600"
              )}
            >
              Log de Pontos
            </button>
            <button 
              onClick={() => { setActiveTab('users'); setSearchTerm(''); }}
              className={cn(
                "flex-1 min-w-[120px] py-4 px-4 font-bold transition-colors border-b-2 text-sm md:text-base",
                activeTab === 'users' ? "text-blue-600 border-blue-600 bg-blue-50/30" : "text-slate-400 border-transparent hover:text-slate-600"
              )}
            >
              Gestão de Funcionários
            </button>
            <button 
              onClick={() => { setActiveTab('bank'); setSearchTerm(''); }}
              className={cn(
                "flex-1 min-w-[120px] py-4 px-4 font-bold transition-colors border-b-2 text-sm md:text-base",
                activeTab === 'bank' ? "text-blue-600 border-blue-600 bg-blue-50/30" : "text-slate-400 border-transparent hover:text-slate-600"
              )}
            >
              Banco de Horas
            </button>
            <button 
              onClick={() => { setActiveTab('payroll'); setSearchTerm(''); }}
              className={cn(
                "flex-1 min-w-[120px] py-4 px-4 font-bold transition-colors border-b-2 text-sm md:text-base",
                activeTab === 'payroll' ? "text-blue-600 border-blue-600 bg-blue-50/30" : "text-slate-400 border-transparent hover:text-slate-600"
              )}
            >
              Folha de Pagamento
            </button>
          </div>
          <div className="p-3 pr-4 flex justify-end w-full sm:w-auto">
            <button 
              onClick={handleResetAllPointData}
              className="w-full sm:w-auto text-xs px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-600 font-extrabold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-red-100/60 shadow-sm"
              title="Excluir permanentemente todos os registros de ponto e justificativas de todos os funcionários"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Zerar Histórico de Pontos
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'logs' && (
            <div className="space-y-6">
              {/* Header and Add Button */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                <div>
                  <h3 className="text-lg font-bold text-slate-850">Histórico de Registros de Ponto</h3>
                  <p className="text-xs text-slate-400">Consulte, altere, delete ou insira novos registros de ponto manualmente.</p>
                </div>
                <button
                  onClick={handleCreateNewEntry}
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-md hover:shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Plus className="w-4.5 h-4.5" />
                  Inserir Ponto Manual
                </button>
              </div>

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
                      <th className="px-6 py-4 font-bold text-center">Atraso / Desconto</th>
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
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-700">{entry.userName}</span>
                              {entry.notes && (
                                <span className="text-[10px] text-slate-400 italic font-medium max-w-[180px] truncate animate-fade-in" title={entry.notes}>
                                  Obs: {entry.notes}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-slate-500 text-sm text-center">
                          {entry.timestamp ? format(entry.timestamp.toDate(), 'dd/MM/yyyy') : '---'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap font-mono font-bold text-center">
                          {entry.timestamp ? (
                            (() => {
                              const isAfter = isAfterContractualTime(entry);
                              const formattedTime = format(entry.timestamp.toDate(), 'HH:mm:ss');
                              if (isAfter) {
                                const entryDate = entry.timestamp.toDate();
                                const actualMin = entryDate.getHours() * 60 + entryDate.getMinutes();
                                let limit = '09:00';
                                if (entry.type === 'in') {
                                  limit = actualMin < 720 ? '09:00' : '13:30';
                                } else {
                                  limit = actualMin < 900 ? '12:30' : '18:00';
                                }
                                return (
                                  <span 
                                    className="px-2.5 py-1 rounded-xl bg-red-50 text-red-600 border border-red-100 font-extrabold text-xs inline-flex items-center gap-1.5 shadow-sm shadow-red-50/50"
                                    title={`Após o horário contratual! Esperado anterior ou igual a: ${limit}`}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                                    {formattedTime}
                                  </span>
                                );
                              }
                              return <span className="text-slate-800 font-bold">{formattedTime}</span>;
                            })()
                          ) : '...'}
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
                          {(() => {
                            const { minutes, discount } = getDelayAndDiscount(entry);
                            if (minutes > 0) {
                              const hours = Math.floor(minutes / 60);
                              const mins = Math.floor(minutes % 60);
                              const delayStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                              return (
                                <div className="inline-flex flex-col items-center justify-center">
                                  <span className="px-2.5 py-1 rounded-xl bg-red-50 text-red-600 border border-red-100 font-extrabold text-xs inline-flex items-center gap-1">
                                    +{delayStr}
                                  </span>
                                  {discount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 font-extrabold text-[10px] inline-flex items-center gap-1 mt-1">
                                      -{discount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            return <span className="text-slate-350 font-medium text-xs">---</span>;
                          })()}
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
                        <td className="px-6 py-4 whitespace-nowrap text-right transition-all">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => handleOpenEntryModal(entry)}
                              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50/50 rounded-lg transition-colors cursor-pointer"
                              title="Editar registro"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => deleteEntry(entry.id!)}
                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50/50 rounded-lg transition-colors cursor-pointer"
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
                          {user.jobTitle && (
                            <div className="mt-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded w-fit capitalize">
                              {user.jobTitle}
                            </div>
                          )}
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
                    
                    {/* Salary & Rate metrics */}
                    <div className="mt-4 pt-3 border-t border-dashed border-slate-150 space-y-1.5">
                      {user.salary ? (
                        (() => {
                          const { daily, hourly } = calculateRates(user);
                          return (
                            <div className="bg-slate-50/80 p-2.5 rounded-2xl border border-slate-100 text-[10px] space-y-1">
                              <div className="flex justify-between">
                                <span className="text-slate-400">Salário:</span>
                                <span className="font-extrabold text-slate-700">
                                  {user.salary.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400">Por Dia:</span>
                                <span className="font-bold text-slate-700">
                                  {daily.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-450">Por Hora:</span>
                                <span className="font-bold text-slate-700">
                                  {hourly.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </span>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="bg-slate-50/50 p-2 rounded-2xl text-[10px] text-slate-400 text-center border border-dashed border-slate-200">
                          Sem dados salariais
                        </div>
                      )}
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

          {activeTab === 'payroll' && (
            <div className="space-y-8">
              {/* Top Banner and Period Selector */}
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1">
                  <h4 className="text-base font-bold text-slate-800">Folha de Pagamento & Controle de Justificativas</h4>
                  <p className="text-xs text-slate-500">Apure salários líquidos, registre férias, abonos e faltas abonadas com impacto proporcional automático.</p>
                </div>
                <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-450 uppercase tracking-wider">Mês de Apuração:</span>
                  <input 
                    type="month"
                    className="bg-transparent border-none text-sm font-bold text-slate-700 focus:outline-none focus:ring-0 focus:border-none p-0 cursor-pointer"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                  />
                </div>
              </div>

              {/* Bento Grid layout */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                
                {/* Left Section: Payroll Table (8 columns) */}
                <div className="xl:col-span-8 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                    <h5 className="font-bold text-slate-800 text-sm md:text-base flex items-center gap-2">
                      <Wallet className="w-5 h-5 text-blue-600" />
                      Calculadoras de Salários Proporcionais
                    </h5>
                    <span className="text-xs px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full font-bold uppercase tracking-wider">CLT Proporcional</span>
                  </div>

                  <div className="p-4 overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold tracking-wider border-b border-slate-100">
                          <th className="px-4 py-3">Funcionário</th>
                          <th className="px-4 py-3 text-center">Salário Base</th>
                          <th className="px-4 py-3 text-center">Faltas Injust.</th>
                          <th className="px-4 py-3 text-center">Férias/Justif.</th>
                          <th className="px-4 py-3 text-center">Atrasos (Líquido)</th>
                          <th className="px-4 py-3 text-right">Líquido a Pagar</th>
                          <th className="px-4 py-3 text-center">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs text-slate-600">
                        {users.map(user => {
                          const calculations = calculatePayrollForUser(user, selectedMonth);
                          return (
                            <tr key={user.uid} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                                {user.name}
                                <span className="block text-[10px] text-slate-400 font-mono italic">{user.jobTitle || 'Sem cargo'}</span>
                              </td>
                              <td className="px-4 py-3 text-center font-bold">
                                {calculations.baseSalary.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {calculations.unexcusedAbsenceDays > 0 ? (
                                  <span className="px-2 py-0.5 bg-red-55 text-red-600 rounded font-bold">
                                    {calculations.unexcusedAbsenceDays}d (-{(calculations.unexcusedAbsenceDiscount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})
                                  </span>
                                ) : (
                                  <span className="text-slate-400">---</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center whitespace-nowrap">
                                <div className="space-y-1">
                                  {calculations.vacationDays > 0 && (
                                    <span className="block px-2 py-0.5 bg-sky-50 text-sky-700 rounded font-bold text-[9px] uppercase">
                                      {calculations.vacationDays}d Férias (+1/3)
                                    </span>
                                  )}
                                  {calculations.justifiedAbsenceDays > 0 && (
                                    <span className="block px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded font-bold text-[9px] uppercase">
                                      {calculations.justifiedAbsenceDays}d Justificadas
                                    </span>
                                  )}
                                  {calculations.vacationDays === 0 && calculations.justifiedAbsenceDays === 0 && (
                                    <span className="text-slate-400">---</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                {calculations.delayMinutes > 0 ? (
                                  <div className="space-y-0.5">
                                    <span className="block font-medium text-red-500 font-mono">
                                      {Math.floor(calculations.delayMinutes / 60)}h {Math.round(calculations.delayMinutes % 60)}m
                                    </span>
                                    {calculations.abonoMinutes > 0 ? (
                                      <span className="block text-[9px] px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded font-semibold italic">
                                        Abonado: {Math.floor(calculations.abonoMinutes / 60)}h {Math.round(calculations.abonoMinutes % 60)}m
                                      </span>
                                    ) : (
                                      <span className="text-[9px] text-slate-400">Sem abono</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-400">---</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-black text-slate-850 text-sm whitespace-nowrap">
                                {calculations.netSalary.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </td>
                              <td className="px-4 py-3 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button 
                                    onClick={() => setSelectedPayrollUser(user)}
                                    className="p-1.5 hover:bg-slate-100 rounded text-slate-600 duration-150 cursor-pointer"
                                    title="Ver Demonstrativo"
                                  >
                                    <AlertCircle className="w-4 h-4 text-slate-500" />
                                  </button>
                                  <button 
                                    onClick={() => exportReceiptToPDF(user, calculations)}
                                    className="p-1.5 hover:bg-red-50 rounded text-red-600 duration-150 cursor-pointer"
                                    title="Emitir PDF do Holerite"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {users.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slate-400 italic">Nenhum funcionário cadastrado.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right Section: Ausências & Justificativas (4 columns) */}
                <div className="xl:col-span-4 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-slate-50/30">
                    <div>
                      <h5 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                        <CalendarDays className="w-4 h-4 text-emerald-600" />
                        Abonos & Férias
                      </h5>
                      <span className="text-[10px] text-slate-400">Insira ocorrências e isenções</span>
                    </div>
                    <button 
                      onClick={() => handleOpenJustificationModal()}
                      className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg flex items-center gap-1 cursor-pointer transition-all focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Registrar
                    </button>
                  </div>

                  <div className="p-4 space-y-3">
                    <div className="flex flex-col gap-2 max-h-[450px] overflow-y-auto pr-1">
                      {justifications.map(just => {
                        return (
                          <div key={just.id} className="relative group bg-slate-50/80 hover:bg-white hover:shadow p-3.5 rounded-xl border border-slate-100 transition-all space-y-2">
                            <button 
                              onClick={() => deleteJustification(just.id!)}
                              className="absolute top-2 right-2 p-1 hover:bg-red-50 hover:text-red-600 text-slate-400 rounded transition-all focus:outline-none cursor-pointer"
                              title="Excluir Registro"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-[9px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider block w-fit whitespace-nowrap",
                                just.type === 'ferias' ? "bg-sky-100 text-sky-700" :
                                just.type === 'falta_justificada' ? "bg-emerald-100 text-emerald-700" :
                                "bg-amber-100 text-amber-700"
                              )}>
                                {just.type === 'ferias' ? 'Férias' : just.type === 'falta_justificada' ? 'Falta Justificada' : 'Abono'}
                              </span>
                              {just.minutesAbono && (
                                <span className="text-[10px] font-bold text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                                  {just.minutesAbono} min
                                </span>
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-slate-700 text-xs">{just.userName}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                Período: {format(parseISO(just.startDate), 'dd/MM/yyyy')} - {format(parseISO(just.endDate), 'dd/MM/yyyy')}
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed font-medium bg-white p-2 rounded-lg border border-slate-100 shadow-sm">{just.description}</p>
                          </div>
                        );
                      })}
                      {justifications.length === 0 && (
                        <div className="text-center py-12 text-slate-400 italic text-xs space-y-1">
                          <AlertCircle className="w-8 h-8 text-slate-350 mx-auto opacity-70 mb-2 animate-pulse" />
                          <p>Nenhum abono, ausência autorizada ou período de férias registrado ainda.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

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
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Função / Cargo</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700"
                      placeholder="Ex: Desenv. Pleno"
                      value={editingUser.jobTitle || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, jobTitle: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Salário Mensal (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700"
                      placeholder="Ex: 3500.00"
                      value={editingUser.salary !== undefined ? editingUser.salary : ''}
                      onChange={(e) => setEditingUser({ ...editingUser, salary: e.target.value ? Number(e.target.value) : undefined })}
                    />
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Horário de Entrada Contratual</label>
                    <input 
                      type="time" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700 font-bold"
                      value={editingUser.contractIn || '09:00'}
                      onChange={(e) => setEditingUser({ ...editingUser, contractIn: e.target.value })}
                    />
                    <p className="text-[9px] text-slate-400 ml-1">Entradas registradas após este horário serão destacadas em vermelho.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Horário de Saída Contratual</label>
                    <input 
                      type="time" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700 font-bold"
                      value={editingUser.contractOut || '18:00'}
                      onChange={(e) => setEditingUser({ ...editingUser, contractOut: e.target.value })}
                    />
                    <p className="text-[9px] text-slate-400 ml-1">Saídas registradas após este horário serão destacadas em vermelho.</p>
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
                <h3 className="text-xl font-bold text-slate-800">
                  {editingEntry.id ? 'Editar Registro de Ponto' : 'Inserir Novo Registro'}
                </h3>
                <button onClick={() => setIsEntryModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {!editingEntry.id ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Colaborador *</label>
                    <select
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 font-bold"
                      value={editingEntry.userId || ''}
                      onChange={(e) => {
                        const selectedUser = users.find(u => u.uid === e.target.value || (u as any).docId === e.target.value);
                        setEditingEntry({
                          ...editingEntry,
                          userId: e.target.value,
                          userName: selectedUser ? selectedUser.name : ''
                        });
                      }}
                    >
                      <option value="">Selecione o Colaborador...</option>
                      {users.map(u => (
                        <option key={u.uid || (u as any).docId} value={u.uid || (u as any).docId}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-blue-600 shadow-sm">
                      <UserIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">{editingEntry.userName}</p>
                      <p className="text-xs text-slate-500 uppercase font-black tracking-widest">
                        {editingEntry.type === 'in' ? 'Entrada' : 'Saída'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Data e Hora *</label>
                    <input 
                      type="datetime-local" 
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 font-bold"
                      value={entryDateTime}
                      onChange={(e) => setEntryDateTime(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Tipo de Registro *</label>
                    <div className="flex gap-2">
                      <button 
                        type="button"
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
                        type="button"
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

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Observações / Motivo</label>
                    <textarea 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700 text-xs h-20 min-h-[80px]"
                      placeholder="Ex: Esquecimento, ajuste solicitado pelo colaborador, etc."
                      value={editingEntry.notes || ''}
                      onChange={(e) => setEditingEntry({ ...editingEntry, notes: e.target.value })}
                    />
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
                  {editingEntry.id ? 'Salvar Alterações' : 'Inserir Registro'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Justification Modal */}
      <AnimatePresence>
        {isJustificationModalOpen && editingJustification && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="text-xl font-bold text-slate-800">
                  {editingJustification.id ? 'Alterar Justificativa' : 'Nova Ocorrência / Justificativa'}
                </h3>
                <button onClick={() => setIsJustificationModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {/* Employee Selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Colaborador</label>
                  <select 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700 font-medium"
                    value={editingJustification.userId || ''}
                    disabled={!!editingJustification.id}
                    onChange={(e) => setEditingJustification({ ...editingJustification, userId: e.target.value })}
                  >
                    <option value="">Selecione o Funcionário...</option>
                    {users.map(u => (
                      <option key={u.uid} value={u.uid}>{u.name} ({u.jobTitle || 'Sem cargo'})</option>
                    ))}
                  </select>
                </div>

                {/* Absence Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Tipo de Ocorrência</label>
                  <select 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700 font-medium"
                    value={editingJustification.type || 'abono'}
                    onChange={(e) => setEditingJustification({ 
                      ...editingJustification, 
                      type: e.target.value as JustificationType,
                      minutesAbono: e.target.value === 'abono' ? editingJustification.minutesAbono : undefined 
                    })}
                  >
                    <option value="abono">Abono de Atrasos / Horas</option>
                    <option value="falta_justificada">Falta Justificada (Abonada)</option>
                    <option value="ferias">Período de Férias</option>
                  </select>
                </div>

                {/* Period Range */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Data Início</label>
                    <input 
                      type="date" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-750 font-bold"
                      value={editingJustification.startDate || ''}
                      onChange={(e) => setEditingJustification({ ...editingJustification, startDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Data Termino</label>
                    <input 
                      type="date" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-750 font-bold"
                      value={editingJustification.endDate || ''}
                      onChange={(e) => setEditingJustification({ ...editingJustification, endDate: e.target.value })}
                    />
                  </div>
                </div>

                {/* Abono minutes specification (only if type is Abono) */}
                {editingJustification.type === 'abono' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Minutos Abondados (Opcional)</label>
                    <input 
                      type="number" 
                      placeholder="Ex: 60 (para abonar 1 hora de atraso)"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-700"
                      value={editingJustification.minutesAbono || ''}
                      onChange={(e) => setEditingJustification({ ...editingJustification, minutesAbono: e.target.value ? Number(e.target.value) : undefined })}
                    />
                    <p className="text-[10px] text-slate-400">Deixe em branco para abonar o dia inteiro de atrasos.</p>
                  </div>
                )}

                {/* Description details */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">Descrição / Motivo</label>
                  <textarea 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-705 text-xs h-24"
                    placeholder="Ex: Apresentou atestado médico CID H10, ou férias regulamentares autorizadas."
                    value={editingJustification.description || ''}
                    onChange={(e) => setEditingJustification({ ...editingJustification, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setIsJustificationModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSaveJustification}
                  disabled={isSaving}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 flex items-center justify-center gap-2 shadow-lg shadow-emerald-100 disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? <X className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  Salvar Registro
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Paystub / Demonstrativo de Pagamento Modal */}
      <AnimatePresence>
        {selectedPayrollUser && (
          (() => {
            const calculations = calculatePayrollForUser(selectedPayrollUser, selectedMonth);
            const totalEarnings = calculations.baseSalary + calculations.vacationBonus13 + (calculations.delayMinutes > 0 ? calculations.abonoDiscountRecovered : 0);
            const totalDeductions = calculations.unexcusedAbsenceDiscount + (calculations.delayMinutes > 0 ? calculations.delayDiscount : 0);
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden my-8"
                >
                  {/* Header Paystub */}
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-900 text-white">
                    <div>
                      <h3 className="text-lg font-black tracking-tight uppercase">Demonstrativo de Pagamento</h3>
                      <p className="text-xs text-slate-400 font-mono">Ponto Conecta Lan House | Apuração de CLT Proporcional</p>
                    </div>
                    <button 
                      onClick={() => setSelectedPayrollUser(null)} 
                      className="p-2 hover:bg-slate-800 rounded-full text-slate-400 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Body Paystub */}
                  <div className="p-6 space-y-6">
                    {/* Identification */}
                    <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs">
                      <div>
                        <span className="block text-[9px] text-slate-400 uppercase font-bold">Colaborador</span>
                        <span className="font-extrabold text-slate-800 text-sm">{selectedPayrollUser.name}</span>
                        <span className="block text-[10px] text-slate-500 italic mt-0.5">{selectedPayrollUser.jobTitle || 'Sem cargo definido'}</span>
                      </div>
                      <div className="text-right space-y-1">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Mês:</span>
                          <span className="font-mono font-bold text-slate-700">{selectedMonth}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Matrícula:</span>
                          <span className="font-mono font-bold text-slate-700">{selectedPayrollUser.matricula || '---'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">CPF:</span>
                          <span className="font-mono font-bold text-slate-700">{selectedPayrollUser.cpf || '---'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Ledger lines */}
                    <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-600 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
                            <th className="px-4 py-2.5">Cod</th>
                            <th className="px-4 py-2.5">Instrução / Evento</th>
                            <th className="px-4 py-2.5 text-center">Referência</th>
                            <th className="px-4 py-2.5 text-right">Proventos (+)</th>
                            <th className="px-4 py-2.5 text-right">Descontos (-)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 text-slate-700 font-medium font-mono">
                          {/* Salário Base */}
                          <tr>
                            <td className="px-4 py-2.5 text-slate-400">001</td>
                            <td className="px-4 py-2.5 font-sans font-semibold">Salário Contratual Base</td>
                            <td className="px-4 py-2.5 text-center">30 dias</td>
                            <td className="px-4 py-2.5 text-right text-emerald-600">
                              {calculations.baseSalary.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-350">---</td>
                          </tr>

                          {/* Vacation Gozadas */}
                          {calculations.vacationDays > 0 && (
                            <>
                              <tr>
                                <td className="px-4 py-2.5 text-slate-400">102</td>
                                <td className="px-4 py-2.5 font-sans font-semibold">Dias de Férias Gozados</td>
                                <td className="px-4 py-2.5 text-center">{calculations.vacationDays} dias</td>
                                <td className="px-4 py-2.5 text-right text-slate-400">Prog. Normal</td>
                                <td className="px-4 py-2.5 text-right text-slate-350">---</td>
                              </tr>
                              <tr>
                                <td className="px-4 py-2.5 text-slate-400">103</td>
                                <td className="px-4 py-2.5 font-sans font-semibold">Adicional de Férias 1/3 CF</td>
                                <td className="px-4 py-2.5 text-center">1/3 Const.</td>
                                <td className="px-4 py-2.5 text-right text-emerald-600">
                                  {calculations.vacationBonus13.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </td>
                                <td className="px-4 py-2.5 text-right text-slate-350">---</td>
                              </tr>
                            </>
                          )}

                          {/* Justified Absence */}
                          {calculations.justifiedAbsenceDays > 0 && (
                            <tr>
                              <td className="px-4 py-2.5 text-slate-400">201</td>
                              <td className="px-4 py-2.5 font-sans font-semibold">Ausências Abonadas / Justificadas</td>
                              <td className="px-4 py-2.5 text-center">{calculations.justifiedAbsenceDays} dias</td>
                              <td className="px-4 py-2.5 text-right text-emerald-600">---</td>
                              <td className="px-4 py-2.5 text-right text-slate-350">---</td>
                            </tr>
                          )}

                          {/* Unexcused Absence */}
                          {calculations.unexcusedAbsenceDays > 0 && (
                            <tr>
                              <td className="px-4 py-2.5 text-slate-400">501</td>
                              <td className="px-4 py-2.5 font-sans font-semibold text-red-655">Faltas Injustificadas</td>
                              <td className="px-4 py-2.5 text-center">{calculations.unexcusedAbsenceDays} dias</td>
                              <td className="px-4 py-2.5 text-right text-slate-350">---</td>
                              <td className="px-4 py-2.5 text-right text-red-600">
                                {calculations.unexcusedAbsenceDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </td>
                            </tr>
                          )}

                          {/* Delay minutes and abonos */}
                          {calculations.delayMinutes > 0 && (
                            <>
                              <tr>
                                <td className="px-4 py-2.5 text-slate-400">505</td>
                                <td className="px-4 py-2.5 font-sans font-semibold">Delongas / Estouros de Ponto</td>
                                <td className="px-4 py-2.5 text-center">
                                  {Math.floor(calculations.delayMinutes / 60)}h {Math.round(calculations.delayMinutes % 60)}m
                                </td>
                                <td className="px-4 py-2.5 text-right text-slate-350">---</td>
                                <td className="px-4 py-2.5 text-right text-red-600 border-none">
                                  {calculations.delayDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </td>
                              </tr>
                              {calculations.abonoMinutes > 0 && (
                                <tr>
                                  <td className="px-4 py-2.5 text-slate-400">008</td>
                                  <td className="px-4 py-2.5 font-sans font-semibold text-emerald-600">Abono Administrativo de Atraso</td>
                                  <td className="px-4 py-2.5 text-center">
                                    {Math.floor(calculations.abonoMinutes / 60)}h {Math.round(calculations.abonoMinutes % 60)}m
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-emerald-600">
                                    {calculations.abonoDiscountRecovered.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-slate-350">---</td>
                                </tr>
                              )}
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Paystub Footer / Signature blocks */}
                    <div className="grid grid-cols-3 gap-4 border border-slate-200 rounded-2xl p-4 bg-slate-50/50 text-xs text-slate-700 font-semibold font-mono">
                      <div>
                        <span className="block text-[9px] text-slate-400 uppercase font-black font-sans">Total Vencimento</span>
                        <span className="text-sm font-extrabold text-slate-800">
                          {totalEarnings.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-400 uppercase font-black font-sans">Total Deduções</span>
                        <span className="text-sm font-extrabold text-red-600">
                          {totalDeductions.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </div>
                      <div className="bg-slate-900 text-white p-3.5 rounded-xl border border-slate-950 flex flex-col justify-center">
                        <span className="block text-[8px] text-slate-400 uppercase font-black font-sans">Valor Líquido</span>
                        <span className="text-base font-black tracking-tight text-emerald-400 whitespace-nowrap">
                          {calculations.netSalary.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Paystub Foot */}
                  <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                    <button 
                      onClick={() => setSelectedPayrollUser(null)}
                      className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-100 cursor-pointer"
                    >
                      Fechar Demonstrativo
                    </button>
                    <button 
                      onClick={() => exportReceiptToPDF(selectedPayrollUser, calculations)}
                      className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-950 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-slate-200"
                    >
                      <Download className="w-5 h-5 text-emerald-400" />
                      Emitir PDF Recibo
                    </button>
                  </div>
                </motion.div>
              </div>
            );
          })()
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2 text-amber-500">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <h3 className="text-base font-bold text-slate-800">{confirmModal.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="p-1.5 hover:bg-slate-105 rounded-full transition-colors text-slate-400 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6">
                <p className="text-slate-600 text-xs leading-relaxed whitespace-pre-wrap">{confirmModal.message}</p>
              </div>

              <div className="p-6 bg-slate-50/40 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 text-xs transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const callback = confirmModal.onConfirm;
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    await callback();
                  }}
                  className={cn(
                    "flex-1 px-4 py-2 text-white rounded-xl font-bold text-xs transition-all shadow-md cursor-pointer flex items-center justify-center",
                    confirmModal.isDanger 
                      ? "bg-red-600 hover:bg-red-700 shadow-red-100" 
                      : "bg-blue-600 hover:bg-blue-700 shadow-blue-100"
                  )}
                >
                  {confirmModal.confirmText || 'Confirmar'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

