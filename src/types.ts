import { Timestamp } from 'firebase/firestore';

export type UserRole = 'employee' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  cpf?: string;
  matricula?: string;
  department?: string;
  status: 'active' | 'inactive';
  workload?: number;
  contractIn?: string;
  contractOut?: string;
  bankOfHours?: number;
  photoURL?: string;
  password?: string;
  createdAt: Timestamp;
}

export type EntryType = 'in' | 'out';

export interface TimeEntry {
  id?: string;
  userId: string;
  userName: string; // Redundant but helpful for list viewing in Admin
  timestamp: Timestamp;
  type: EntryType;
  notes?: string;
  location?: {
    lat: number;
    lng: number;
  };
}
