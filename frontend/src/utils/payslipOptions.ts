import { doc, getDoc } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { isPlatformCompanyId } from './companyScope'
import type { Company } from '../types/user'

export interface PayslipOptions {
  companyName?: string
  companyAddress?: string
  companyCity?: string
  companyState?: string
  companyZip?: string
  companyCountry?: string
  companyPhone?: string
  companyEmail?: string
  companyWebsite?: string
  companyLogo?: string
  companyCurrency?: string
  companyPan?: string
  companyRegNo?: string
  generatedBy?: string
  authorizedBy?: string
}

export const getCompanyPayslipOptions = async (companyId?: string): Promise<PayslipOptions> => {
  // 'global'/'master-admin' are platform scope sentinels, not company documents.
  if (!companyId || isPlatformCompanyId(companyId)) return {}
  try {
    const snap = await getDoc(doc(db, 'companies', companyId))
    if (!snap.exists()) return {}
    const company = { id: snap.id, ...snap.data() } as Company
    return {
      companyName: company.name,
      companyAddress: company.address,
      companyCity: company.city,
      companyState: company.state,
      companyZip: company.zipCode,
      companyCountry: company.country,
      companyPhone: company.phone,
      companyEmail: company.adminEmail,
      companyWebsite: company.website,
      companyLogo: company.logoUrl,
      companyCurrency: company.currency,
      companyPan: company.adminPhone ? '' : '',
      companyRegNo: '',
      generatedBy: company.name || 'HRMS',
    }
  } catch (err) {
    console.error('Failed to fetch company for payslip:', err)
    return {}
  }
}
