import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { collection, getDocs, query, where, onSnapshot, doc, getDoc } from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { useAuth } from './AuthContext';

interface AssignedCompany {
  id: string;
  name: string;
  code: string;
}

interface CompanyContextType {
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string) => void;
  availableCompanies: AssignedCompany[];
  isCompanyRestricted: boolean;
  canAccessAllCompanies: boolean;
  isExecutiveWithCompanies: boolean;
  isLoading: boolean;
  effectiveCompanyId: string | null;
  selectedCompanyName: string | null;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

// Firestore caps `in` at 10 values, so split into chunked queries and merge.
const getDocsInBatches = async (collectionName: string, ids: string[]) => {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) batches.push(ids.slice(i, i + 10));
  if (batches.length === 0) return [] as any[];
  // Per-document getDoc: role-based rules call getUserData() (get()), which
  // Firestore cannot evaluate for list/query rules — that rejects a `__name__ in`
  // query with "Missing or insufficient permissions". Single-doc gets support get().
  const results = await Promise.all(
    batches.map((b) => Promise.all(b.map((id) => getDoc(doc(db, collectionName, id)))))
  );
  const map = new Map<string, any>();
  results.flat().forEach((s) => {
    if (s.exists()) map.set(s.id, { id: s.id, ...s.data() });
  });
  return Array.from(map.values());
};

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isReportingManager } = useAuth();
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null);
  const [availableCompanies, setAvailableCompanies] = useState<AssignedCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [companyName, setCompanyName] = useState<string | null>(null);

  // Team Leaders are SYSTEM-LEVEL (created by the Master Admin) — they are
  // NOT company-restricted: their scope is global, matching the backend
  // (scopedCompanyIds returns [] = unrestricted for team-leader).
  const isRestrictedRole = user?.role === 'executive' || isReportingManager;
  const isSingleCompanyRole = user?.role === 'company-admin' || user?.role === 'employee' || user?.role === 'hr';

  useEffect(() => {
    if (!user) {
      setAvailableCompanies([]);
      setSelectedCompanyIdState(null);
      setIsLoading(false);
      return;
    }

    const loadCompanies = async (forceUser: typeof user) => {
      setIsLoading(true);
      try {
        let targetIds: string[] = [];
        const fuRole = forceUser?.role;
        const fuCompanyId = forceUser?.companyId;
        const fuId = forceUser?.id;

        if (fuRole === 'executive') {
          targetIds = (forceUser as any).assignedCompanyIds || [];
          if (targetIds.length === 0 && fuId) {
            try {
              const userSnap = await getDoc(doc(db, 'users', fuId));
              if (userSnap.exists()) {
                targetIds = (userSnap.data() as any).assignedCompanyIds || [];
              }
            } catch {}
          }
        } 
        // team-leader: no linked-executive derivation — system-level TLs fall
        // through to the unrestricted branch below and load ALL companies.

        if (targetIds.length > 0) {
          const compDocs = await getDocsInBatches('companies', targetIds);
          const comps: AssignedCompany[] = compDocs.map((d) => ({
            id: d.id,
            name: (d as any).name || '',
            code: (d as any).code || '',
          }));
          setAvailableCompanies(comps);

          if (comps.length === 1) {
            // Single company: auto-select so CRUD flows are ready immediately
            setSelectedCompanyIdState(comps[0].id);
          } else {
            // Multiple companies: default to "All Companies" combined view
            setSelectedCompanyIdState(null);
          }
        } else if (isRestrictedRole) {
          setAvailableCompanies([]);
          setSelectedCompanyIdState(null);
        } else if (isSingleCompanyRole && fuCompanyId) {
          try {
            const snap = await getDoc(doc(db, 'companies', fuCompanyId));
            if (snap.exists()) {
              const data = snap.data();
              setAvailableCompanies([{ id: fuCompanyId, name: data.name || '', code: data.code || '' }]);
            } else {
              setAvailableCompanies([{ id: fuCompanyId, name: fuCompanyId, code: '' }]);
            }
          } catch {
            setAvailableCompanies([{ id: fuCompanyId, name: fuCompanyId, code: '' }]);
          }
          setSelectedCompanyIdState(fuCompanyId);
        } else {
          // Master-admin or unrestricted: load all companies
          try {
            const allSnap = await getDocs(collection(db, 'companies'));
            const allComps: AssignedCompany[] = allSnap.docs.map((d) => ({
              id: d.id,
              name: (d.data() as any).name || '',
              code: (d.data() as any).code || '',
            }));
            setAvailableCompanies(allComps);
          } catch {
            setAvailableCompanies([]);
          }
          // Never persist the role-sentinel companyId ('master-admin') as the
          // user's *selection* — it poisoned scopedCompanyIdsForRole (scope became
          // ['master-admin'], matching no real company → empty MA panel/queues).
          // Team-leader defaults to the aggregated "All Companies" view (global
          // system-level scope) rather than pinning to their own company.
          const pinForRole = fuRole === 'team-leader' ? null : (fuCompanyId && fuCompanyId !== 'master-admin' ? fuCompanyId : null);
          setSelectedCompanyIdState(pinForRole);
        }
      } catch (err) {
        console.error('Error loading assigned companies:', err);
        setAvailableCompanies([]);
        const fallbackCid = forceUser?.companyId || null;
        setSelectedCompanyIdState(fallbackCid && fallbackCid !== 'master-admin' ? fallbackCid : null);
      } finally {
        setIsLoading(false);
      }
    };

    loadCompanies(user);

    // Real-time permission sync for executives. (Team leaders are system-level
    // global — their scope does not change with linked-executive edits.)

    const applyScope = async (targetIds: string[]) => {
      if (targetIds.length > 0) {
        const compDocs = await getDocsInBatches('companies', targetIds);
        const comps = compDocs.map((d) => ({
          id: d.id,
          name: (d as any).name || '',
          code: (d as any).code || '',
        }));
        setAvailableCompanies(comps);
        setSelectedCompanyIdState((prev) => {
          if (prev && !comps.find((c) => c.id === prev)) {
            return comps.length === 1 ? comps[0].id : null;
          }
          return prev;
        });
      } else {
        setAvailableCompanies([]);
        setSelectedCompanyIdState(null);
      }
    };

    if (user.role === 'executive') {
      const unsub = onSnapshot(doc(db, 'users', user.id), (snap) => {
        if (!snap.exists()) return;
        const snapData = snap.data() as any;
        const newIds: string[] = snapData.assignedCompanyIds || [];
        applyScope(newIds);
      }, () => {});
      return () => unsub();
    }
    // team-leader: system-level GLOBAL scope (all companies) — constant, no
    // linked-executive recompute (links no longer drive visibility).
  }, [user?.id, user?.role, user?.companyId]);

  const setSelectedCompanyId = useCallback(
    (id: string) => {
      if (user?.role === 'employee') return; // Employee hard-lock
      setSelectedCompanyIdState(id);
    },
    [user?.role]
  );

  const isCompanyRestricted = useMemo(
    () => isRestrictedRole && availableCompanies.length > 0,
    [isRestrictedRole, availableCompanies]
  );

  const canAccessAllCompanies = useMemo(
    () => !isRestrictedRole && !isSingleCompanyRole,
    [isRestrictedRole, isSingleCompanyRole]
  );

  const isExecutiveWithCompanies = useMemo(
    () => user?.role === 'executive' && availableCompanies.length > 0,
    [user?.role, availableCompanies]
  );

  const effectiveCompanyId = useMemo(() => {
    if (user?.role === 'employee') return user.companyId || null;
    if (isRestrictedRole) return selectedCompanyId;
    if (selectedCompanyId) return selectedCompanyId;
    return user?.companyId || null;
  }, [user?.role, user?.companyId, isRestrictedRole, selectedCompanyId]);

  useEffect(() => {
    if (!user) {
      setCompanyName(null);
      return;
    }
    const cid = effectiveCompanyId || user?.companyId;
    if (!cid) {
      setCompanyName(null);
      return;
    }
    const found = availableCompanies.find((c) => c.id === cid);
    if (found) {
      setCompanyName(found.name);
      return;
    }
    getDoc(doc(db, 'companies', cid))
      .then((snap) => {
        if (snap.exists()) setCompanyName(snap.data()?.name || null);
      })
      .catch(() => {});
  }, [user, effectiveCompanyId, isRestrictedRole, availableCompanies]);

  const selectedCompanyName = useMemo(() => {
    const comp = availableCompanies.find((c) => c.id === selectedCompanyId);
    return comp?.name || companyName || null;
  }, [availableCompanies, selectedCompanyId, companyName]);

  const value = useMemo(
    () => ({
      selectedCompanyId,
      setSelectedCompanyId,
      availableCompanies,
      isCompanyRestricted,
      canAccessAllCompanies,
      isExecutiveWithCompanies,
      isLoading,
      effectiveCompanyId,
      selectedCompanyName,
    }),
    [
      selectedCompanyId,
      setSelectedCompanyId,
      availableCompanies,
      isCompanyRestricted,
      canAccessAllCompanies,
      isExecutiveWithCompanies,
      isLoading,
      effectiveCompanyId,
      selectedCompanyName,
    ]
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
};

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};
