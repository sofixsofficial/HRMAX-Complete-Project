import { doc, getDoc } from '../aws/firestore-compat';
import { db } from '../aws/clients';

export interface PayslipOptions {
  companyName?: string;
  companyAddress?: string;
  companyCity?: string;
  companyState?: string;
  companyCountry?: string;
  companyLogo?: string;
  companyCurrency?: string;
}

export const getCompanyPayslipOptions = async (companyId?: string): Promise<PayslipOptions> => {
  if (!companyId) return {};
  try {
    const snap = await getDoc(doc(db, 'companies', companyId));
    if (!snap.exists()) return {};
    const company = snap.data();
    return {
      companyName: company.name || '',
      companyAddress: company.address || '',
      companyCity: company.city || '',
      companyState: company.state || '',
      companyCountry: company.country || '',
      companyLogo: company.logoUrl || '',
      companyCurrency: company.currency || 'INR',
    };
  } catch (err) {
    console.error('Failed to fetch company for payslip:', err);
    return {};
  }
};
