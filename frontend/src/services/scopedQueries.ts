import { collection, query, where, Query, CollectionReference, QueryConstraint, orderBy, limit } from 'firebase/firestore'
import { db } from '../config/firebase'
import type { User } from '../types/user'

export interface ScopedQueryConfig {
  collectionName: string
  user: User | null
  companyIds?: string[]
  executiveId?: string
  reportingManagerId?: string
  userId?: string
  departmentId?: string
  statusFilter?: string
  dateField?: string
  limitCount?: number
}

/**
 * Builds a Firestore query with automatic role-based constraints.
 * Every role gets exactly the data they are allowed to see — nothing more.
 *
 * Role scoping rules:
 * - master-admin: no constraints (global access)
 * - company-admin: companyId === user.companyId
 * - executive: companyId in user.assignedCompanyIds (or provided companyIds)
 * - team-leader: companyId in provided companyIds (from TLFilterContext cascade)
 * - reporting-manager: same-company portfolio (companyId === user.companyId)
 * - employee: userId === auth.uid
 */
export const buildScopedQuery = (config: ScopedQueryConfig): Query => {
  const { collectionName, user, companyIds, reportingManagerId, userId, limitCount } = config
  const constraints: QueryConstraint[] = []

  const col = collection(db, collectionName) as CollectionReference

  if (!user) {
    // Unauthenticated — return empty-safe query (no results)
    return query(col, where('__name__', '==', 'scope-empty'))
  }

  switch (user.role) {
    case 'master-admin':
      // Global access — no constraints
      break

    case 'company-admin':
      if (user.companyId) {
        constraints.push(where('companyId', '==', user.companyId))
      } else {
        return query(col, where('__name__', '==', 'scope-empty'))
      }
      break

    case 'executive': {
      // Executives are constrained to the requested active scope: the company
      // selected in the top-nav header, or their full assigned set in
      // "All Companies" mode (the header passes the full list; callers chunk
      // to 10 for Firestore's `in` limit). No ids → full global scope (like
      // master-admin), so no constraint is added.
      const ids = [...new Set((companyIds || []).filter(Boolean))]
      if (ids.length === 1) {
        constraints.push(where('companyId', '==', ids[0]))
      } else if (ids.length > 1) {
        constraints.push(where('companyId', 'in', ids.slice(0, 10)))
      }
      break
    }

    case 'team-leader': {
      const ids = [...new Set((companyIds || []).filter(Boolean))]
      if (ids.length === 0) {
        return query(col, where('__name__', '==', 'scope-empty'))
      }
      const chunk = ids.slice(0, 10)
      constraints.push(chunk.length === 1 ? where('companyId', '==', chunk[0]) : where('companyId', 'in', chunk))
      break
    }

    case 'reporting-manager':
      // Same-company portfolio scope for every data module: a Reporting Manager
      // sees requests from all employees of their company, not only requests
      // where the (often unbound / employee-doc-id) approverIds.reportingManager
      // happens to equal their auth uid.
      if (collectionName === 'employees') {
        constraints.push(where('reportingManagerId', '==', user.id))
      } else if (collectionName === 'users') {
        constraints.push(where('id', '==', user.id))
      } else if (user.companyId) {
        constraints.push(where('companyId', '==', user.companyId))
      } else {
        return query(col, where('__name__', '==', 'scope-empty'))
      }
      break

    case 'employee': {
      if (!user.companyId) {
        return query(col, where('__name__', '==', 'scope-empty'))
      }
      // Personal data: filter by userId + companyId
      if (collectionName === 'leaveRequests') {
        constraints.push(where('userId', '==', user.id))
        constraints.push(where('companyId', '==', user.companyId))
      } else if (collectionName === 'attendance') {
        constraints.push(where('userId', '==', user.id))
        constraints.push(where('companyId', '==', user.companyId))
      } else if (collectionName === 'salarySlips') {
        constraints.push(where('userId', '==', user.id))
        constraints.push(where('companyId', '==', user.companyId))
      } else if (collectionName === 'employees') {
        constraints.push(where('userId', '==', user.id))
        constraints.push(where('companyId', '==', user.companyId))
      } else if (collectionName === 'tasks') {
        constraints.push(where('assignedToId', '==', user.id))
        constraints.push(where('companyId', '==', user.companyId))
      } else if (collectionName === 'holidays') {
        constraints.push(where('companyId', '==', user.companyId))
      } else if (collectionName === 'announcements') {
        constraints.push(where('companyId', '==', user.companyId))
      } else if (collectionName === 'departments') {
        constraints.push(where('companyId', '==', user.companyId))
      } else {
        // Fallback: scope to companyId for any collection with that field
        constraints.push(where('companyId', '==', user.companyId))
      }
      break
    }

    default:
      return query(col, where('__name__', '==', 'scope-empty'))
  }

  return query(col, ...constraints)
}

/**
 * Build a real-time onSnapshot query with role scoping.
 * Returns null when the user has no access (caller should skip listener).
 */
export const getScopedRealtimeQuery = (config: ScopedQueryConfig): Query | null => {
  const q = buildScopedQuery(config)
  // Check for the sentinel — if it contains our sentinel where clause, return null
  const qStr = JSON.stringify(q)
  if (qStr.includes('scope-empty')) return null
  return q
}

/**
 * Get the list of company IDs a user is allowed to access.
 */
export const getAccessibleCompanyIds = (user: User | null, companyIds?: string[]): string[] => {
  if (!user) return []

  switch (user.role) {
    case 'master-admin':
      return [] // empty = all companies
    case 'company-admin':
      return user.companyId ? [user.companyId] : []
    case 'executive':
      return [] // empty = all companies
    case 'team-leader':
      return [...new Set((companyIds || []).filter(Boolean))]
    case 'reporting-manager':
      return user.companyId ? [user.companyId] : []
    case 'employee':
      return user.companyId ? [user.companyId] : []
    default:
      return []
  }
}

/**
 * Get the appropriate 'where' field for a user's scope in a given collection.
 */
export const getScopeFilter = (
  user: User | null,
  collectionName: string
): { field: string; operator: '==' | 'in'; value: string | string[] } | null => {
  if (!user) return null

  switch (user.role) {
    case 'master-admin':
      return null // no filter
    case 'company-admin':
      return user.companyId ? { field: 'companyId', operator: '==', value: user.companyId } : null
    case 'executive':
      return null // no filter (all companies)
    case 'reporting-manager':
      if (collectionName === 'employees') {
        return { field: 'reportingManagerId', operator: '==', value: user.id }
      }
      return user.companyId ? { field: 'companyId', operator: '==', value: user.companyId } : null
    case 'employee':
      if (['leaveRequests', 'attendance', 'salarySlips'].includes(collectionName)) {
        return { field: 'userId', operator: '==', value: user.id }
      }
      return null
    default:
      return null
  }
}
