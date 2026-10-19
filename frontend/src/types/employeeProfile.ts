export interface BankAccount {
  id: string
  employeeId: string
  accountHolderName: string
  bankName: string
  accountNumber: string
  ifscCode: string
  panNumber: string
  upiId?: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

export interface EmployeeDocument {
  id: string
  employeeId: string
  name: string
  category: 'Identity' | 'Education' | 'Experience' | 'Bank' | 'Other'
  fileUrl: string
  fileSize: number
  mimeType: string
  uploadedAt: Date
  uploadedBy: string
}

export interface EmployeeContract {
  id: string
  employeeId: string
  type: 'Full-time' | 'Part-time' | 'Contract' | 'Intern'
  startDate: Date
  endDate?: Date
  status: 'Active' | 'Expired' | 'Terminated'
  documentUrl?: string
  salary?: number
  notes?: string
  createdAt: Date
  updatedAt: Date
}
