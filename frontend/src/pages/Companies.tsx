import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import {
  Building2, Users, AlertCircle, Download, Plus,
  Eye, Pencil, Loader2, Trash2, X, CheckCircle,
  ChevronLeft, ChevronRight, Upload, Search, Crown,
  Crosshair, Wifi, Camera, Smartphone, Mail, MapPin, DollarSign,
  UserX
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import type { Resolver } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { httpsCallable } from '../aws/functions-compat'
import { doc, onSnapshot } from '../aws/firestore-compat'
import { functions, db } from '../aws/clients'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { scopedCompanyIds } from '../utils/companyScope'
import { 
  subscribeToCompanies, 
  createCompany, 
  updateCompany, 
  deleteCompanyData,
  deleteAllCompanyStaff,
  onboardCompany,
} from '../services/companyService'
import { getAllEmployees } from '../services/employeeService'
import { getAllUsers } from '../services/authService'
import type { Company, User } from '../types/user'
import { logAudit } from '../services/auditLogService'
import './Companies.css'

const STATUS_OPTIONS = ['Active', 'Inactive'] as const

const companySchema = z.object({
  name: z.string().min(2, 'Company name must be at least 2 characters'),
  code: z.string().optional(),
  domain: z.string().email('Invalid email').or(z.literal('')),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  zipCode: z.string().optional(),
  establishmentDate: z.string().optional(),
  timezone: z.string().default('Asia/Kolkata'),
  currency: z.string().default('INR'),
  dateFormat: z.string().default('DD/MM/YYYY'),
  language: z.string().default('English'),
  adminName: z.string().min(2, 'Admin name must be at least 2 characters'),
  adminEmail: z.string().email('Invalid admin email'),
  adminUsername: z.string().min(3, 'Username must be at least 3 characters').optional(),
  adminPassword: z.string().min(6, 'Password must be at least 6 characters').optional(),
  adminPhone: z.string().optional(),
  panNumber: z.string().optional(),
  gstNumber: z.string().optional(),
  agreementDoc: z.string().optional(),
  employeeLimit: z.number().min(1, 'Limit must be at least 1').default(50),
  employees: z.number().default(0),
  status: z.enum(STATUS_OPTIONS).default('Active'),
  logoColor: z.string().default('#f97316'),
  logoUrl: z.string().optional(),
  description: z.string().optional(),
  adminId: z.string().optional(),
  adminAvatar: z.string().optional(),
  averageSalary: z.number().min(0).default(0).optional(),
  mandatoryAttendanceDays: z.number().min(1).max(31).default(22).optional(),
  // Attendance Configuration
  officeAddress: z.string().min(1, 'Office address is required'),
  latitude: z.number().default(0),
  longitude: z.number().default(0),
  radiusInMeters: z.number().min(50).max(500).default(100),
  allowMobileData: z.boolean().default(true),
  requireWifi: z.boolean().default(false),
  wifiSSID: z.string().optional(),
  requireSelfie: z.boolean().default(false),
})

const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
  'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic',
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
  'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia',
  'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
  'Haiti', 'Honduras', 'Hungary',
  'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
  'Jamaica', 'Japan', 'Jordan',
  'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
  'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman',
  'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar',
  'Romania', 'Russia', 'Rwanda',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria',
  'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
  'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
  'Yemen',
  'Zambia', 'Zimbabwe',
]

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Delhi', 'Puducherry',
]

const INDIA_CITIES_MAP: Record<string, string[]> = {
  'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati', 'Rajahmundry', 'Kakinada', 'Anantapur', 'Kadapa', 'Chittoor', 'Machilipatnam', 'Tenali', 'Proddatur', 'Hindupur'],
  'Arunachal Pradesh': ['Itanagar', 'Naharlagun', 'Pasighat', 'Tawang', 'Ziro', 'Bomdila', 'Along', 'Roing', 'Tezu', 'Namsai'],
  'Assam': ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia', 'Tezpur', 'Bongaigaon', 'Barpeta', 'Goalpara', 'Diphu', 'Kokrajhar', 'Sivasagar', 'Lakhimpur', 'Dhemaji'],
  'Bihar': ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Purnia', 'Darbhanga', 'Hajipur', 'Bihar Sharif', 'Arrah', 'Begusarai', 'Katihar', 'Munger', 'Chapra', 'Sasaram', 'Saharsa'],
  'Chhattisgarh': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon', 'Raigarh', 'Jagdalpur', 'Ambikapur', 'Mahasamund', 'Dhamtari', 'Kawardha', 'Balod', 'Surajpur', 'Mungeli'],
  'Goa': ['Panaji', 'Vasco da Gama', 'Margao', 'Mapusa', 'Ponda', 'Bicholim', 'Curchorem', 'Cuncolim', 'Sanquelim', 'Valpoi'],
  'Gujarat': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Gandhinagar', 'Anand', 'Nadiad', 'Morbi', 'Bharuch', 'Mehsana', 'Navsari', 'Bhuj', 'Junagadh'],
  'Haryana': ['Chandigarh', 'Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Karnal', 'Sonipat', 'Rohtak', 'Hisar', 'Bhiwani', 'Rewari', 'Sirsa', 'Kaithal', 'Jind', 'Yamunanagar'],
  'Himachal Pradesh': ['Shimla', 'Dharamshala', 'Mandi', 'Solan', 'Kullu', 'Manali', 'Hamirpur', 'Bilaspur', 'Palampur', 'Nahan', 'Kangra', 'Una', 'Chamba', 'Keylong', 'Dalhousie'],
  'Jharkhand': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar', 'Hazaribagh', 'Giridih', 'Ramgarh', 'Dumka', 'Phusro', 'Pakur', 'Garhwa', 'Koderma', 'Lohardaga', 'Sahibganj'],
  'Karnataka': ['Bangalore', 'Mysuru', 'Hubli', 'Mangalore', 'Belgaum', 'Davangere', 'Shivamogga', 'Tumkur', 'Udupi', 'Hospet', 'Gulbarga', 'Bijapur', 'Hassan', 'Bellary', 'Raichur'],
  'Kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Alappuzha', 'Kollam', 'Palakkad', 'Kannur', 'Kottayam', 'Malappuram', 'Kasaragod', 'Pathanamthitta', 'Idukki', 'Wayanad', 'Munnar'],
  'Madhya Pradesh': ['Indore', 'Bhopal', 'Jabalpur', 'Ujjain', 'Gwalior', 'Sagar', 'Dewas', 'Satna', 'Ratlam', 'Rewa', 'Murwara', 'Singrauli', 'Burhanpur', 'Chhindwara', 'Morena'],
  'Maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Amravati', 'Navi Mumbai', 'Sangli', 'Malegaon', 'Jalgaon', 'Akola', 'Latur'],
  'Manipur': ['Imphal', 'Bishnupur', 'Churachandpur', 'Thoubal', 'Senapati', 'Ukhrul', 'Kakching', 'Mayang Imphal', 'Nambol', 'Moirang'],
  'Meghalaya': ['Shillong', 'Tura', 'Nongstoin', 'Jowai', 'Mawlai', 'Williamnagar', 'Baghmara', 'Cherrapunji', 'Resubelpara', 'Mairang'],
  'Mizoram': ['Aizawl', 'Lunglei', 'Champhai', 'Serchhip', 'Kolasib', 'Saiha', 'Lawngtlai', 'Hnahthial', 'Mamit', 'Khawzawl'],
  'Nagaland': ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang', 'Wokha', 'Zunheboto', 'Mon', 'Phek', 'Longleng', 'Kiphire'],
  'Odisha': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore', 'Brahmapur', 'Jharsuguda', 'Barbil', 'Jajpur', 'Bhadrak', 'Baripada', 'Paradip', 'Kendrapara'],
  'Punjab': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Pathankot', 'Hoshiarpur', 'Phagwara', 'Moga', 'Firozpur', 'Kapurthala', 'Barnala', 'Malerkotla', 'Rajpura'],
  'Rajasthan': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Bikaner', 'Ajmer', 'Bhilwara', 'Alwar', 'Sikar', 'Bharatpur', 'Sri Ganganagar', 'Pali', 'Tonk', 'Kishangarh', 'Beawar'],
  'Sikkim': ['Gangtok', 'Namchi', 'Mangan', 'Gyalshing', 'Rangpo', 'Singtam', 'Jorethang', 'Pakyong', 'Rhenock', 'Ravangla'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore', 'Thoothukudi', 'Dindigul', 'Thanjavur', 'Nagercoil', 'Kanchipuram', 'Tiruppur', 'Karur'],
  'Telangana': ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Ramagundam', 'Mahbubnagar', 'Adilabad', 'Suryapet', 'Siddipet', 'Miryalaguda', 'Jagtial', 'Mancherial', 'Wanaparthy', 'Bhadrachalam'],
  'Tripura': ['Agartala', 'Udaipur', 'Dharmanagar', 'Kailashahar', 'Belonia', 'Khowai', 'Ambassa', 'Teliamura', 'Sabroom', 'Sonamura'],
  'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Prayagraj', 'Ghaziabad', 'Noida', 'Meerut', 'Bareilly', 'Aligarh', 'Moradabad', 'Gorakhpur', 'Jhansi', 'Mathura', 'Saharanpur'],
  'Uttarakhand': ['Dehradun', 'Haridwar', 'Rishikesh', 'Haldwani', 'Roorkee', 'Nainital', 'Mussoorie', 'Kashipur', 'Rudrapur', 'Kotdwar', 'Pithoragarh', 'Almora', 'Chamoli', 'Srinagar', 'Tehri'],
  'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Siliguri', 'Asansol', 'Bardhaman', 'Malda', 'Krishnanagar', 'Haldia', 'Kharagpur', 'Darjeeling', 'Jalpaiguri', 'Baharampur', 'Balurghat', 'Cooch Behar'],
  'Andaman and Nicobar Islands': ['Port Blair', 'Diglipur', 'Mayabunder', 'Rangat', 'Havelock', 'Neil Island', 'Little Andaman', 'Car Nicobar', 'Campbell Bay', 'Hut Bay'],
  'Chandigarh': ['Chandigarh', 'Manimajra', 'Sector 17', 'Sector 22', 'Sector 35', 'Industrial Area', 'Kaimbwala', 'Daria', 'Behlana', 'Sarangpur'],
  'Dadra and Nagar Haveli and Daman and Diu': ['Silvassa', 'Daman', 'Diu', 'Amli', 'Dadra', 'Nagar Haveli', 'Kachigam', 'Bhimpore', 'Dabhel', 'Moti Daman'],
  'Jammu and Kashmir': ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Sopore', 'Kathua', 'Udhampur', 'Rajouri', 'Pulwama', 'Kupwara', 'Poonch', 'Bandipora', 'Ganderbal', 'Kulgam', 'Budgam'],
  'Ladakh': ['Leh', 'Kargil', 'Nubra', 'Zanskar', 'Diskit', 'Padum', 'Khalatse', 'Thiksey', 'Shey', 'Alchi'],
  'Lakshadweep': ['Kavaratti', 'Agatti', 'Andrott', 'Minicoy', 'Kalpeni', 'Amini', 'Kadmat', 'Kiltan', 'Chetlat', 'Bitra'],
  'Delhi': ['New Delhi', 'Dwarka', 'Rohini', 'Saket', 'Karol Bagh', 'Connaught Place', 'Lajpat Nagar', 'Hauz Khas', 'Pitampura', 'Janakpuri', 'Shahdara', 'South Extension', 'Khan Market', 'Chandni Chowk', 'Saraswati Vihar'],
  'Puducherry': ['Puducherry', 'Karaikal', 'Yanam', 'Mahe', 'Ozhukarai', 'Ariyankuppam', 'Villianur', 'Bahour', 'Kottucherry', 'Nettapakkam'],
}

type CompanyFormValues = z.infer<typeof companySchema>

interface CompanyFormProps {
  onSubmit: (values: CompanyFormValues) => void;
  submitLabel: string;
  onCancel: () => void;
  isSubmitting: boolean;
  defaultValues?: Partial<CompanyFormValues>;
  showCredentials?: boolean;
}

interface SearchableSelectProps {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

const SearchableSelect = ({ label, options, value, onChange, placeholder, disabled, required }: SearchableSelectProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState(value || '')
  const wrapperRef = useRef<HTMLDivElement>(null)

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    setSearch(value || '')
  }, [value])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="form-group" ref={wrapperRef}>
      <label>{label}{required && ' *'}</label>
      <div className={`searchable-select ${isOpen ? 'open' : ''}`}>
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setIsOpen(true) }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder || `Search ${label.toLowerCase()}...`}
          disabled={disabled}
          className="searchable-select-input"
        />
        {isOpen && !disabled && (
          <div className="searchable-select-dropdown">
            {filtered.length === 0 ? (
              <div className="searchable-select-no-results">No results found</div>
            ) : (
              filtered.map(opt => (
                <div
                  key={opt}
                  className={`searchable-select-option ${opt === value ? 'selected' : ''}`}
                  onClick={() => { onChange(opt); setSearch(opt); setIsOpen(false) }}
                >
                  {opt}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const CompanyForm = ({ onSubmit, submitLabel, onCancel, isSubmitting, defaultValues, showCredentials }: CompanyFormProps) => {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<CompanyFormValues>({
    // Cast: @hookform/resolvers' zod inference doesn't line up with z.infer
    // for this schema (known ecosystem typing limitation — runtime identical).
    resolver: zodResolver(companySchema) as Resolver<CompanyFormValues>,
    defaultValues: defaultValues || {
      name: '',
      code: '',
      domain: '',
      phone: '',
      website: '',
      address: '',
      country: '',
      state: '',
      city: '',
      zipCode: '',
      establishmentDate: '',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      dateFormat: 'DD/MM/YYYY',
      language: 'English',
      adminName: '',
      adminEmail: '',
      adminUsername: '',
      adminPassword: '',
      adminPhone: '',
      panNumber: '',
      gstNumber: '',
      agreementDoc: '',
      employeeLimit: 50,
      employees: 0,
      status: 'Active',
      logoColor: '#f97316',
      logoUrl: '',
      description: '',
      averageSalary: 0,
      mandatoryAttendanceDays: 22,
      officeAddress: '',
      latitude: 0,
      longitude: 0,
      radiusInMeters: 100,
      allowMobileData: true,
      requireWifi: false,
      wifiSSID: '',
      requireSelfie: false,
    }
  })

  const countryVal = watch('country')
  const stateVal = watch('state')
  const cityVal = watch('city')
  const requireWifi = watch('requireWifi')
  const isIndia = countryVal === 'India'
  const availableCities = isIndia && stateVal ? (INDIA_CITIES_MAP[stateVal] || []) : []

  const [panFileName, setPanFileName] = useState('')
  const [gstFileName, setGstFileName] = useState('')
  const [agreementFileName, setAgreementFileName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)

  const getLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValue('latitude', pos.coords.latitude)
        setValue('longitude', pos.coords.longitude)
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleFileUpload = (field: 'panNumber' | 'gstNumber' | 'agreementDoc', setFileName: (name: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setFileError('File size exceeds 5MB limit. Please choose a smaller file.')
      e.target.value = ''
      return
    }
    setFileError(null)
    const reader = new FileReader()
    reader.onloadend = () => {
      setValue(field, reader.result as string)
    }
    reader.readAsDataURL(file)
    setFileName(file.name)
  }

  return (
  <form onSubmit={handleSubmit(onSubmit)} className="modal-form">
    <h4 className="form-section-header">Company Information</h4>
    <div className="form-row">
      <div className="form-group">
        <label>Company Name *</label>
        <input 
          type="text" 
          {...register('name')}
          placeholder="Enter company name"
        />
        {errors.name && <span className="field-error">{errors.name.message}</span>}
      </div>
      <div className="form-group">
        <label>Company Code *</label>
        <input 
          type="text" 
          {...register('code')}
          placeholder="Auto-generated if empty"
        />
      </div>
    </div>

    <div className="form-row">
      <div className="form-group">
        <label>Company Email</label>
        <input 
          type="email" 
          {...register('domain')}
          placeholder="info@company.com"
        />
        {errors.domain && <span className="field-error">{errors.domain.message}</span>}
      </div>
      <div className="form-group">
        <label>Company Phone</label>
        <input 
          type="text" 
          {...register('phone')}
          placeholder="+1 234 567 890"
        />
      </div>
    </div>
    
    <div className="form-row">
      <div className="form-group">
        <label>Company Website</label>
        <input 
          type="text" 
          {...register('website')}
          placeholder="www.company.com"
        />
      </div>
      <div className="form-group">
        <label>Company Address</label>
        <input 
          type="text" 
          {...register('address')}
          placeholder="Company address"
        />
      </div>
    </div>

    <h4 className="form-section-header">Location</h4>
    <div className="form-row">
      <SearchableSelect
        label="Country"
        options={COUNTRIES}
        value={countryVal ?? ''}
        onChange={v => { setValue('country', v); if (v !== 'India') { setValue('state', ''); setValue('city', '') } }}
        placeholder="Search country..."
        required
      />
      <SearchableSelect
        label="State"
        options={isIndia ? INDIAN_STATES : []}
        value={stateVal ?? ''}
        onChange={v => { setValue('state', v); setValue('city', '') }}
        placeholder={isIndia ? 'Search state...' : 'Select India first'}
        disabled={!isIndia}
        required
      />
    </div>

    <div className="form-row">
      <SearchableSelect
        label="City"
        options={availableCities}
        value={cityVal ?? ''}
        onChange={v => setValue('city', v)}
        placeholder={isIndia && stateVal ? 'Search city...' : 'Select a state first'}
        disabled={!isIndia || !stateVal}
        required
      />
      <div className="form-group">
        <label>ZIP Code</label>
        <input 
          type="text" 
          {...register('zipCode')}
          placeholder="ZIP Code"
        />
      </div>
    </div>

    <h4 className="form-section-header">Company Settings</h4>
    <div className="form-row">
      <div className="form-group">
        <label>Status</label>
        <select {...register('status')}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>

    <div className="form-row">
      <div className="form-group">
        <label>Timezone</label>
        <select {...register('timezone')} disabled>
          <option value="Asia/Kolkata">Indian Standard Time (IST)</option>
        </select>
      </div>
      <div className="form-group">
        <label>Currency</label>
        <select {...register('currency')} disabled>
          <option value="INR">INR (₹)</option>
        </select>
      </div>
    </div>

    <div className="form-row">
      <div className="form-group">
        <label>Language</label>
        <select {...register('language')} disabled>
          <option value="English">English</option>
        </select>
      </div>
    </div>

    <h4 className="form-section-header">Company Administrator</h4>
    <div className="form-row">
      <div className="form-group">
        <label>Admin Full Name *</label>
        <input 
          type="text" 
          {...register('adminName')}
          placeholder="Admin full name"
        />
        {errors.adminName && <span className="field-error">{errors.adminName.message}</span>}
      </div>
      <div className="form-group">
        <label>Admin Email *</label>
        <input 
          type="email" 
          {...register('adminEmail')}
          placeholder="admin@company.com"
        />
        {errors.adminEmail && <span className="field-error">{errors.adminEmail.message}</span>}
      </div>
    </div>

    <div className="form-row">
      <div className="form-group">
        <label>Admin Phone</label>
        <input
          type="text"
          {...register('adminPhone')}
          placeholder="+91 98765 43210"
        />
      </div>
    </div>

    {showCredentials && (
      <>
        <h4 className="form-section-header">Account Credentials</h4>
        <div className="form-row">
          <div className="form-group">
            <label>System Username *</label>
            <input
              type="text"
              {...register('adminUsername')}
              placeholder="e.g. admin_johndoe"
            />
            {errors.adminUsername && <span className="field-error">{errors.adminUsername.message}</span>}
          </div>
          <div className="form-group">
            <label>Temporary Password *</label>
            <input
              type="text"
              {...register('adminPassword')}
              placeholder="Min 6 characters"
            />
            {errors.adminPassword && <span className="field-error">{errors.adminPassword.message}</span>}
          </div>
        </div>
      </>
    )}

    <h4 className="form-section-header">Company Details & Documentation</h4>
    <div className="form-row">
      <div className="form-group">
        <label>Company Establishment Date</label>
        <input 
          type="date"
          {...register('establishmentDate')}
        />
      </div>
    </div>

    {fileError && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12, color: '#b91c1c', fontSize: 13 }}>
        <AlertCircle size={15} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{fileError}</span>
        <button type="button" onClick={() => setFileError(null)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', padding: 0, display: 'inline-flex' }}><X size={15} /></button>
      </div>
    )}

    <div className="form-row">
      <div className="form-group">
        <label>PAN Number</label>
        <input 
          type="text" 
          {...register('panNumber')}
          placeholder="ABCDE1234F"
        />
      </div>
      <div className="form-group">
        <label>PAN Card Document</label>
        <div className="file-upload-wrapper">
          <input 
            type="file" 
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={handleFileUpload('panNumber', setPanFileName)}
            style={{ display: 'none' }}
            id="pan-upload"
          />
          <label htmlFor="pan-upload" className="file-upload-label">
            <Upload size={18} />
            <span>{panFileName || 'Upload PAN card'}</span>
          </label>
          <p className="file-upload-hint">JPG, PNG, PDF &bull; Max 5MB</p>
        </div>
      </div>
    </div>

    <div className="form-row">
      <div className="form-group">
        <label>GST Number</label>
        <input 
          type="text" 
          {...register('gstNumber')}
          placeholder="22AAAAA0000A1Z5"
        />
      </div>
      <div className="form-group">
        <label>GST Certificate Document</label>
        <div className="file-upload-wrapper">
          <input 
            type="file" 
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={handleFileUpload('gstNumber', setGstFileName)}
            style={{ display: 'none' }}
            id="gst-upload"
          />
          <label htmlFor="gst-upload" className="file-upload-label">
            <Upload size={18} />
            <span>{gstFileName || 'Upload GST certificate'}</span>
          </label>
          <p className="file-upload-hint">JPG, PNG, PDF &bull; Max 5MB</p>
        </div>
      </div>
    </div>

    <div className="form-row">
      <div className="form-group">
        <label>Company Agreement Documents</label>
        <div className="file-upload-wrapper">
          <input 
            type="file" 
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={handleFileUpload('agreementDoc', setAgreementFileName)}
            style={{ display: 'none' }}
            id="agreement-upload"
          />
          <label htmlFor="agreement-upload" className="file-upload-label">
            <Upload size={18} />
            <span>{agreementFileName || 'Choose agreement document'}</span>
          </label>
          <p className="file-upload-hint">Supports JPG, PNG, PDF &bull; Max 5MB</p>
        </div>
      </div>
    </div>

    <h4 className="form-section-header">Operational Policies</h4>
    <div className="form-row">
      <div className="form-group">
        <label>Average Salary (Monthly)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          {...register('averageSalary', { valueAsNumber: true })}
          placeholder="0.00"
        />
      </div>
      <div className="form-group">
        <label>Mandatory Monthly Attendance (Days)</label>
        <input
          type="number"
          min="1"
          max="31"
          {...register('mandatoryAttendanceDays', { valueAsNumber: true })}
          placeholder="22"
        />
      </div>
    </div>

    <h4 className="form-section-header">Employee Count</h4>
    <div className="form-row">
      <div className="form-group">
        <label>Employee Limit</label>
        <input 
          type="number" 
          {...register('employeeLimit', { valueAsNumber: true })}
          placeholder="50"
        />
        {errors.employeeLimit && <span className="field-error">{errors.employeeLimit.message}</span>}
      </div>
      <div className="form-group">
        <label>Employee Count</label>
        <input 
          type="number" 
          {...register('employees', { valueAsNumber: true })}
          placeholder="0"
        />
      </div>
    </div>

    <div className="form-group">
      <label>Description</label>
      <textarea 
        {...register('description')}
        placeholder="Company description..."
        rows={3}
      />
    </div>

    <hr className="form-divider" />

    <h4 className="form-section-header">Attendance Configuration</h4>

    <div className="form-group">
      <label>Office Full Address *</label>
      <input type="text" {...register('officeAddress')} placeholder="e.g. Bardibas, Madhesh Province, Nepal" />
      {errors.officeAddress && <span className="field-error">{errors.officeAddress.message}</span>}
    </div>

    <div className="form-row">
      <div className="form-group">
        <label>Latitude</label>
        <input type="number" step="any" {...register('latitude', { valueAsNumber: true })} placeholder="27.0" />
      </div>
      <div className="form-group">
        <label>Longitude</label>
        <input type="number" step="any" {...register('longitude', { valueAsNumber: true })} placeholder="85.0" />
      </div>
    </div>

    <button type="button" className="btn-outline location-btn" onClick={getLocation} disabled={locating}>
      <Crosshair size={16} className={locating ? 'spinning' : ''} />
      {locating ? 'Detecting...' : 'Get Current Location'}
    </button>

    <div className="form-group">
      <label>Attendance Radius (meters)</label>
      <input type="number" min={50} max={500} {...register('radiusInMeters', { valueAsNumber: true })} />
    </div>

    <div className="toggle-card">
      <div className="toggle-card-left">
        <Smartphone size={20} />
        <div>
          <strong>Allow Mobile Data</strong>
          <p>Employees can check in using mobile data</p>
        </div>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" {...register('allowMobileData')} />
        <span className="toggle-slider" />
      </label>
    </div>

    <div className="toggle-card">
      <div className="toggle-card-left">
        <Wifi size={20} />
        <div>
          <strong>Require Office Wi-Fi</strong>
          <p>Employees must be connected to office Wi-Fi</p>
        </div>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" {...register('requireWifi')} />
        <span className="toggle-slider" />
      </label>
    </div>

    {requireWifi && (
      <div className="form-group conditional-field">
        <label>Office Wi-Fi SSID</label>
        <input type="text" {...register('wifiSSID')} placeholder="e.g. Sofixs_Office_5G" />
      </div>
    )}

    <div className="toggle-card">
      <div className="toggle-card-left">
        <Camera size={20} />
        <div>
          <strong>Require Selfie</strong>
          <p>Employees must take a selfie at check-in</p>
        </div>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" {...register('requireSelfie')} />
        <span className="toggle-slider" />
      </label>
    </div>

    <div className="modal-footer">
      <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={isSubmitting}>
        {isSubmitting ? <><Loader2 size={16} className="spinning" /> Saving...</> : submitLabel}
      </button>
    </div>
  </form>
  )
}

export function Companies() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [companyStatusFilter, setCompanyStatusFilter] = useState('All')
  const [companies, setCompanies] = useState<Company[]>([])
  const [employeeCounts, setEmployeeCounts] = useState<Record<string, number>>({})
  const [executives, setExecutives] = useState<User[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [isDeleteStaffModalOpen, setIsDeleteStaffModalOpen] = useState(false)
  const [deletingStaff, setDeletingStaff] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [editDefaultValues, setEditDefaultValues] = useState<Partial<CompanyFormValues> | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const { user, hasPermission } = useAuth()
  const { selectedCompanyName } = useCompany()
  const { availableCompanies } = usePermissionScope('companies')
  // Masters manage every company; restricted roles still navigate here from
  // their "Total Companies" card and must only see their assigned companies
  // (no global leakage).
  const isMaster = ['master-admin'].includes(user?.role || '')
  const scopeCompanyIds = useMemo(() => scopedCompanyIds(null, availableCompanies), [availableCompanies])
  const inScopeCompanies = useCallback((c: any) => isMaster || scopeCompanyIds.length === 0 || scopeCompanyIds.includes(c.id), [isMaster, scopeCompanyIds])
  const canViewAllStats = ['master-admin', 'company-admin', 'team-leader', 'executive'].includes(user?.role || '')
  const pageTitle = selectedCompanyName || 'Companies'

  // Guard against setState after unmount (prevents the "succeeded then flips to
  // error" race where a late setLoading/setError callback lands after teardown).
  const isMounted = useRef(true)
  // Latest scope values, read through a ref so the subscription effect can run
  // with stable deps (no stale-closure re-subscribes / re-fetch churn).
  const scopeRef = useRef({ scopeCompanyIds, inScopeCompanies })
  scopeRef.current = { scopeCompanyIds, inScopeCompanies }
  // Tracks whether any company data has been loaded this session; a transient
  // permission error (token refresh / rule re-evaluation) must not wipe an
  // already-visible list.
  const hasDataRef = useRef(false)
  // Incrementing this re-runs the load effect for an in-place "Retry" without a
  // full page reload (which used to create an infinite reload loop).
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  const safe = <T,>(fn: () => T): T | undefined => {
    if (!isMounted.current) return undefined
    return fn()
  }

  useEffect(() => {
    // Master admin (unrestricted) loads all companies via a full collection
    // subscription. Restricted roles (team-leader/executive/company-admin) are
    // NOT granted the `companies` list rule — the rules only allow per-document
    // reads for scoped roles — so subscribe per-document over their allowed ids.
    const { scopeCompanyIds, inScopeCompanies } = scopeRef.current

    const markError = () => {
      // Keep any data already shown; only surface the error screen when we have
      // nothing at all (transient rule re-evaluation / token refresh during the
      // initial subscription should not blow away a successful first load).
      if (!isMounted.current) return
      setError(hasDataRef.current ? null : 'Failed to load companies. Please try again.')
      setLoading(false)
    }

    if (isMaster) {
      const unsub = subscribeToCompanies(
        (data) => {
          if (!isMounted.current) return
          const list = Array.isArray(data) ? data.filter(inScopeCompanies) : data
          if (Array.isArray(list) && list.length > 0) hasDataRef.current = true
          setCompanies(list)
          setError(null)
          setLoading(false)
        },
        () => markError()
      )
      return () => unsub()
    }

    const uniqueIds = [...new Set(scopeCompanyIds)]
    if (uniqueIds.length === 0) {
      if (isMounted.current) {
        setCompanies([])
        setError(null)
        setLoading(false)
      }
      return
    }

    const docMap: Record<string, any> = {}
    const cache: Record<string, boolean> = {}
    // If a single per-doc listener errors transiently (token refresh / rule
    // re-evaluation), don't fail the whole page — retry that one doc in place
    // with a short backoff so the UI doesn't flip between data and error.
    const failed: Record<string, number> = {}
    let reported = false
    const report = () => {
      if (!isMounted.current) return
      if (uniqueIds.every(id => cache[id])) {
        if (!reported) { reported = true; setLoading(false) }
        const list = Object.values(docMap).filter(inScopeCompanies)
        if (list.length > 0) hasDataRef.current = true
        setCompanies(list)
        setError(list.length === 0 && !hasDataRef.current ? 'Failed to load companies. Please try again.' : null)
      }
    }
    const subscribeOne = (id: string) => {
      const unsub = onSnapshot(
        doc(db, 'companies', id),
        (snap) => {
          cache[id] = true
          if (snap.exists()) docMap[id] = { id, ...snap.data() }
          report()
        },
        () => {
          cache[id] = true
          const tries = (failed[id] = (failed[id] || 0) + 1)
          if (isMounted.current && tries <= 3) {
            // re-subscribe in place after a short backoff; snapshot listeners
            // auto-reconnect anyway, this just guards the initial-subscribe race
            setTimeout(() => { if (isMounted.current) subscribeOne(id) }, 400 * tries)
          }
          report()
        }
      )
      return unsub
    }
    const unsubs = uniqueIds.map(subscribeOne)
    return () => unsubs.forEach(unsub => { try { unsub() } catch {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeCompanyIds.join('|'), isMaster, retryNonce])

  useEffect(() => {
    getAllEmployees().then(emps => {
      const counts: Record<string, number> = {}
      for (const emp of emps) {
        const cid = emp.companyId
        if (cid && inScopeCompanies(cid)) counts[cid] = (counts[cid] || 0) + 1
      }
      setEmployeeCounts(counts)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies.length, scopeCompanyIds.join('|'), isMaster])

  useEffect(() => {
    getAllUsers().then(all => {
      const inScopeUsers = isMaster || scopeCompanyIds.length === 0
        ? all
        : all.filter((u: any) => (u.assignedCompanyIds || []).some((cid: string) => scopeCompanyIds.includes(cid)))
      setAllUsers(inScopeUsers)
      setExecutives(inScopeUsers.filter(u => u.role === 'executive' && u.isActive !== false))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeCompanyIds.join('|'), isMaster])

  const stats = {
    total: companies.length,
    active: companies.filter(c => c.status === 'Active').length,
    totalEmployees: companies.reduce((sum, c) => sum + (employeeCounts[c.id] || 0), 0)
  }

  const getAssignedExecutiveId = (cid: string) => {
    const c = companies.find(c => c.id === cid)
    return c ? (c as any).assignedExecutiveId || '' : ''
  }

  const getExecutiveName = (cid: string) => {
    const eid = getAssignedExecutiveId(cid)
    if (!eid) return ''
    const exec = executives.find(u => u.id === eid)
    return exec?.name || ''
  }

  const getTLsForCompany = (cid: string) => {
    const eid = getAssignedExecutiveId(cid)
    if (!eid) return []
    const exec = allUsers.find(u => u.id === eid)
    const tlIds: string[] = (exec as any)?.assignedTeamLeaderIds || []
    return tlIds.map((tid: string) => allUsers.find(u => u.id === tid)?.name || '').filter(Boolean)
  }

  const filteredCompanies = (() => {
    try {
      return companies.filter(company => {
        if (searchTerm) {
          const search = searchTerm.toLowerCase()
          const matchesSearch = 
            (company.name || '').toLowerCase().includes(search) ||
            (company.domain || '').toLowerCase().includes(search) ||
            (company.code || '').toLowerCase().includes(search) ||
            (company.adminName || '').toLowerCase().includes(search)
          if (!matchesSearch) return false
        }
        
        if (companyStatusFilter !== 'All' && company.status !== companyStatusFilter) return false
        
        if (user?.role === 'master-admin') return true
        if (user?.role === 'company-admin') return company.id === user.companyId
        return true
      })
    } catch {
      return []
    }
  })()

  const totalPages = Math.max(1, Math.ceil(filteredCompanies.length / pageSize))
  const paginatedCompanies = filteredCompanies.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page)
  }

  const handleExport = () => {
    const csv = [
      ['Company', 'Code', 'Admin', 'Email', 'Assigned Executive', 'Reporting TL', 'Employees', 'Status'].join(','),
      ...filteredCompanies.map(c =>
        [c.name, c.code, c.adminName, c.adminEmail, getExecutiveName(c.id), getTLsForCompany(c.id).join('; '), employeeCounts[c.id] || 0, c.status].join(',')
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'companies.csv'; a.click()
  }

  const getStatsCards = () => {
    if (user?.role === 'executive') {
      const myCompany = companies.find(c => c.id === user.companyId)
      return [
        { 
          icon: Building2, 
          label: 'My Company', 
          filterKey: 'All',
          value: '1', 
          subtext: myCompany?.name || 'Not Assigned',
          color: '#f97316',
          bgColor: '#fff7ed'
        },
        { 
          icon: Users, 
          label: 'Colleagues', 
          filterKey: 'All',
          value: String(myCompany ? (employeeCounts[myCompany.id] || 0) : 0), 
          subtext: 'In my company',
          color: '#10b981',
          bgColor: '#ecfdf5'
        },
      ]
    }
    
    return [
      { 
        icon: Building2, 
        label: 'Total Companies', 
        filterKey: 'All',
        value: String(stats.total), 
        subtext: `${stats.active} active`,
        color: '#f97316',
        bgColor: '#fff7ed'
      },
      { 
        icon: Users, 
        label: 'Employees', 
        filterKey: 'All',
        value: stats.totalEmployees.toLocaleString(), 
        subtext: 'All companies',
        color: '#10b981',
        bgColor: '#ecfdf5'
      },
    ]
  }

  const showToast = (message: string) => {
    setToast({ visible: true, message })
    setTimeout(() => {
      setToast(prev => prev.visible ? { visible: false, message: '' } : prev)
    }, 4000)
  }

  const handleAddCompany = async (values: CompanyFormValues) => {
    setFormError(null)
    if (!values.adminUsername || values.adminUsername.trim().length < 3) {
      setFormError('System Username is required (min 3 characters)')
      return
    }
    if (!values.adminPassword || values.adminPassword.length < 6) {
      setFormError('Temporary Password is required (min 6 characters)')
      return
    }
    setIsSubmitting(true)
    try {
      const creatorName = user?.name || ''
      const creatorRole = user?.role === 'team-leader' ? 'Team Leader'
        : user?.role === 'executive' ? 'Executive'
        : user?.role === 'master-admin' ? 'Master Admin'
        : user?.role === 'company-admin' ? 'Company Admin'
        : 'Admin'
      const company = await onboardCompany({
        name: values.name,
        domain: values.domain,
        phone: values.phone || undefined,
        address: values.address || undefined,
        createdBy: (user as any)?.id || (user as any)?.uid || '',
        createdByName: creatorName,
        createdByRole: creatorRole,
        parentCompanyId: ((user as any)?.parentCompanyId || (user as any)?.companyId || '') as string,
        parentCompanyName: ((user as any)?.parentCompanyName || '') as string,
        adminName: values.adminName,
        adminEmail: values.adminEmail,
        attendanceSettings: {
          officeAddress: values.officeAddress,
          latitude: values.latitude,
          longitude: values.longitude,
          radiusInMeters: values.radiusInMeters,
          allowMobileData: values.allowMobileData,
          requireWifi: values.requireWifi,
          wifiSSID: values.requireWifi ? (values.wifiSSID || '') : '',
          requireSelfie: values.requireSelfie,
        },
      })

      // Create the Company Admin login account with the provided credentials
      const createStaffUser = httpsCallable(functions, 'createStaffUser')
      const { data: staffResult } = await createStaffUser({
        name: values.adminName,
        email: values.adminEmail,
        username: values.adminUsername.trim(),
        password: values.adminPassword,
        tempPassword: values.adminPassword,
        role: 'company-admin',
        companyId: company.id,
      }) as { data: { success?: boolean; uid?: string; error?: string } }
      if (!staffResult?.uid && !staffResult?.success) {
        throw new Error(staffResult?.error || 'Failed to create admin account')
      }

      // Link the created admin onto the company document
      await updateCompany(company.id, { adminId: staffResult.uid } as any)

      setIsAddModalOpen(false)
      showToast(`Company added! Admin login — Username: ${values.adminUsername}, Password: ${values.adminPassword}`)
    } catch (err: any) {
      const msg = err?.message
        ? (err.message.includes('already-exists') || err.message.includes('already registered')
          ? 'This email is already registered. Please use a different email.'
          : err.message)
        : 'Failed to add company. Please try again.'
      setFormError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditCompany = async (values: CompanyFormValues) => {
    if (!selectedCompany) return
    setFormError(null)
    setIsSubmitting(true)
    try {
      await updateCompany(selectedCompany.id, values as any)
      setIsEditModalOpen(false)
      setSelectedCompany(null)
      showToast('Company updated successfully!')
    } catch (err) {
      setFormError('Failed to update company')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedCompany) return
    setDeleting(true)
    setFormError(null)
    try {
      const result = await deleteCompanyData(selectedCompany.id)
      setIsDeleteModalOpen(false)
      setSelectedCompany(null)
      showToast(`Deleted ${result?.companyName || selectedCompany.name} and its data`)
    } catch (err: any) {
      setFormError(err?.message && !err?.message.includes('permission')
        ? `Failed to delete company data (${err.message})`
        : 'Only Master Admin can delete company data')
      setIsDeleteModalOpen(false)
      setSelectedCompany(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteAllStaff = async () => {
    if (!selectedCompany) return
    setDeletingStaff(true)
    setFormError(null)
    try {
      const result = await deleteAllCompanyStaff(selectedCompany.id)
      setIsDeleteStaffModalOpen(false)
      setSelectedCompany(null)
      showToast(`Deleted ${result?.usersDeleted ?? 0} user(s), ${result?.employeesDeleted ?? 0} employee(s) from ${selectedCompany.name}`)
    } catch (err: any) {
      setIsDeleteStaffModalOpen(false)
      setSelectedCompany(null)
      showToast(err?.message && !err?.message.includes('permission')
        ? `Failed to delete staff (${err.message})`
        : 'Only Master Admin can delete company staff')
    } finally {
      setDeletingStaff(false)
    }
  }

  const openEditModal = (company: Company) => {
    setSelectedCompany(company)
    setFormError(null)
    setEditDefaultValues({
      name: company.name,
      code: company.code,
      domain: company.domain,
      phone: company.phone || '',
      website: company.website || '',
      address: company.address || '',
      country: company.country || '',
      state: company.state || '',
      city: company.city || '',
      zipCode: company.zipCode || '',
      timezone: company.timezone || 'UTC',
      currency: company.currency || 'INR',
      dateFormat: company.dateFormat || 'MM/DD/YYYY',
      language: company.language || 'English',
      adminName: company.adminName,
      adminEmail: company.adminEmail,
      adminPhone: company.adminPhone || '',
      employeeLimit: company.employeeLimit || 50,
      employees: employeeCounts[company.id] || 0,
      status: company.status,
      logoColor: company.logoColor,
      logoUrl: company.logoUrl || '',
      description: company.description || '',
      averageSalary: company.averageSalary || 0,
      mandatoryAttendanceDays: company.mandatoryAttendanceDays || 22,
    })
    setIsEditModalOpen(true)
  }

  const openViewModal = (company: Company) => {
    setSelectedCompany(company)
    setIsViewModalOpen(true)
  }

  const openDeleteModal = (company: Company) => {
    setSelectedCompany(company)
    setIsDeleteModalOpen(true)
  }

  // Deep links from CompanyDetailsView (?edit=<id> / ?delete=<id>) auto-open
  // the corresponding modal once companies have loaded.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (loading || companies.length === 0) return
    const editId = searchParams.get('edit')
    const deleteId = searchParams.get('delete')
    const targetId = editId || deleteId
    if (!targetId) return
    const target = companies.find(c => c.id === targetId)
    if (!target) return
    if (editId && hasPermission('companies.edit')) {
      openEditModal(target)
    } else if (deleteId && hasPermission('companies.delete')) {
      setSelectedCompany(target)
      setIsDeleteModalOpen(true)
    }
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, companies, loading])

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'Active': return { bg: '#dcfce7', text: '#16a34a' }
      case 'Pending': return { bg: '#fef3c7', text: '#f59e0b' }
      case 'Suspended': return { bg: '#fee2e2', text: '#ef4444' }
      case 'Inactive': return { bg: '#f3f4f6', text: '#6b7280' }
      default: return { bg: '#f3f4f6', text: '#6b7280' }
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>Loading companies...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
        <div className="error-container">
          <p>{error}</p>
          <button
            onClick={() => {
              // In-place retry: clear error and re-run the subscription effect
              // (via retryNonce) instead of a full page reload, which previously
              // re-triggered the same transient failure into an infinite loop.
              setError(null)
              setLoading(true)
              hasDataRef.current = false
              setRetryNonce(n => n + 1)
            }}
            className="btn-primary">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title={pageTitle} breadcrumbs={['Dashboard', pageTitle]} />
      
      <div className="page-content">
        {/* Toast Notification */}
        {toast.visible && (
          <div className="toast-notification visible">
            <div className="toast-icon">
              <CheckCircle size={20} />
            </div>
            <div className="toast-content">
              <div className="toast-title">Success</div>
              <div className="toast-message">{toast.message}</div>
            </div>
            <button className="toast-close" onClick={() => setToast({ visible: false, message: '' })}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="stats-row">
          {getStatsCards().map((stat, idx) => {
            const isActive = companyStatusFilter === stat.filterKey && stat.filterKey !== 'All' ? true : stat.filterKey === 'All' && companyStatusFilter === 'All'
            return (
            <div key={idx}
              className={`stat-card-companies ${isActive ? 'active' : ''}`}
              onClick={() => { setCompanyStatusFilter(stat.filterKey); setStatusFilter(stat.filterKey); setCurrentPage(1) }}
              tabIndex={0}
              role="button"
              aria-pressed={isActive}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCompanyStatusFilter(stat.filterKey); setStatusFilter(stat.filterKey); setCurrentPage(1) }}}
            >
              <div className="stat-card-content">
                <div className="stat-icon-wrapper" style={{ background: stat.bgColor, color: stat.color }}>
                  <stat.icon size={24} />
                </div>
                <div className="stat-details">
                  <span className="stat-label">{stat.label}</span>
                  <span className="stat-value">{stat.value}</span>
                  <div className="stat-subtext">
                    <span>{stat.subtext}</span>
                  </div>
                </div>
              </div>
            </div>
          )})}
        </div>

        {/* Error Banner */}
        {formError && (
          <div className="error-banner" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 16 }}>
            <AlertCircle size={16} color="#ef4444" />
            <span style={{ color: '#991b1b', fontSize: 14 }}>{formError}</span>
            <button onClick={() => setFormError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} color="#991b1b" /></button>
          </div>
        )}

          {/* Companies Table Section */}
        <div className="companies-section">
          <div className="section-header-companies">
            <h3>{user?.role === 'executive' ? 'My Company' : 'All Companies'}</h3>
            <div className="section-actions">
              <input
                type="text"
                className="filter-input"
                placeholder="Filter by company name..."
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
                style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, width: 200 }}
              />
              <select 
                className="filter-select"
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setCompanyStatusFilter(e.target.value); setCurrentPage(1) }}
              >
                <option value="All">All Statuses</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {canViewAllStats && (
                <>
                  <button className="btn-outline" onClick={handleExport}>
                    <Download size={16} />
                    Export
                  </button>
                  {hasPermission('companies.create') && (
                    <button className="btn-primary" onClick={() => { setFormError(null); setIsAddModalOpen(true) }}>
                      <Plus size={16} />
                      Add New Company
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="table-container">
            <table className="companies-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Code</th>
                  <th>Admin</th>
                  <th>Assigned Executive</th>
                  <th>Reporting TL</th>
                  <th>Employees</th>
                  <th>Created By</th>
                  <th>Parent Company</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedCompanies.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '48px 16px', color: '#9ca3af' }}>
                      <Building2 size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                      <p style={{ fontSize: 15, fontWeight: 500, color: '#6b7280' }}>No companies found matching your search</p>
                      <p style={{ fontSize: 13, marginTop: 4 }}>Try adjusting your search or filter criteria</p>
                    </td>
                  </tr>
                ) : paginatedCompanies.map((company) => {
                  const statusColors = getStatusBadgeColor(company.status)
                  const assignedExec = executives.find(e => e.id === (company as any).assignedExecutiveId)
                  const tlNames = getTLsForCompany(company.id)
                  return (
                    <tr key={company.id}>
                      <td>
                        <div className="company-details">
                          <span className="company-name">{company.name}</span>
                          <span className="company-domain">{company.domain}</span>
                        </div>
                      </td>
                      <td><span className="company-code">{company.code}</span></td>
                      <td>
                        <div className="admin-cell">
                          <span className="admin-name">{company.adminName}</span>
                          <span className="admin-email">{company.adminEmail}</span>
                        </div>
                      </td>
                      <td>
                        {assignedExec ? (
                          <div className="exec-cell">
                            <Crown size={14} color="#f97316" />
                            <span className="exec-name">{assignedExec.name}</span>
                            <span className="exec-title">{(assignedExec as any).executiveTitle || 'Executive'}</span>
                          </div>
                        ) : (
                          <span className="exec-unassigned">Unassigned</span>
                        )}
                      </td>
                      <td>{tlNames.length > 0 ? tlNames.map((tn, i) => <span key={i} className="company-code" style={{ marginRight: 4 }}>{tn}</span>) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                      <td><span className="employees-count">{employeeCounts[company.id] || 0}</span></td>
                      <td>
                        {(company as any).createdByName ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="admin-name">{(company as any).createdByName}</span>
                            {(company as any).createdByRole && (
                              <span style={{ fontSize: 11, color: '#8b5cf6', background: '#f5f3ff', padding: '1px 6px', borderRadius: 4 }}>
                                {(company as any).createdByRole}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>—</span>
                        )}
                      </td>
                      <td>
                        {company.parentCompanyName ? (
                          <span className="company-code">{company.parentCompanyName}</span>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span className="status-badge-table" style={{ background: statusColors.bg, color: statusColors.text }}>
                          {company.status}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button className="action-btn view" onClick={() => openViewModal(company)}>
                            <Eye size={16} />
                          </button>
                          {canViewAllStats && (
                            <>
                              {hasPermission('companies.edit') && (
                                <button className="action-btn edit" onClick={() => openEditModal(company)}>
                                  <Pencil size={16} />
                                </button>
                              )}
                              {hasPermission('companies.delete') && (
                                <button className="action-btn delete" onClick={() => { setSelectedCompany(company); setIsDeleteStaffModalOpen(true) }} title="Delete all staff (executives, team leaders, RMs, employees)">
                                  <UserX size={16} />
                                </button>
                              )}
                              {hasPermission('companies.delete') && (
                                <button className="action-btn delete" onClick={() => openDeleteModal(company)}>
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination-bottom">
            <div className="pagination-info">
              <span className="showing-text">Showing {paginatedCompanies.length} of {companies.length} entries</span>
              <select className="page-size-select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
                <option value={5}>5/page</option>
                <option value={10}>10/page</option>
                <option value={20}>20/page</option>
                <option value={50}>50/page</option>
              </select>
            </div>
            <div className="pagination-controls">
              <button className="page-btn" disabled={currentPage === 1} onClick={() => handlePageChange(1)}><ChevronLeft size={14} /></button>
              <button className="page-btn" disabled={currentPage === 1} onClick={() => handlePageChange(currentPage - 1)}><ChevronLeft size={14} /></button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .map((p, idx, arr) => (
                  <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="page-ellipsis">...</span>}
                    <button className={`page-btn ${currentPage === p ? 'page-btn-active' : ''}`} onClick={() => handlePageChange(p)}>{p}</button>
                  </span>
                ))}
              <button className="page-btn" disabled={currentPage === totalPages} onClick={() => handlePageChange(currentPage + 1)}><ChevronRight size={14} /></button>
              <button className="page-btn" disabled={currentPage === totalPages} onClick={() => handlePageChange(totalPages)}><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      </div>

      {/* Add Company Modal */}
      <Modal 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
        title="Add New Company"
        size="large"
      >
        <CompanyForm 
          onSubmit={handleAddCompany}
          submitLabel="Add Company"
          onCancel={() => { setIsAddModalOpen(false); setFormError(null) }}
          isSubmitting={isSubmitting}
          showCredentials
        />
      </Modal>

      {/* Edit Company Modal */}
      <Modal 
        isOpen={isEditModalOpen} 
        onClose={() => setIsEditModalOpen(false)} 
        title="Edit Company"
        size="large"
      >
        <CompanyForm 
          onSubmit={handleEditCompany}
          submitLabel="Save Changes"
          onCancel={() => { setIsEditModalOpen(false); setSelectedCompany(null); setFormError(null) }}
          isSubmitting={isSubmitting}
          defaultValues={editDefaultValues}
        />
      </Modal>

      {/* View Company Modal (same-screen, all sections) */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        title="Company Details"
        size="large"
        footer={
          <>
            {selectedCompany && canViewAllStats && hasPermission('companies.edit') && (
              <button className="btn-secondary" onClick={() => { setIsViewModalOpen(false); openEditModal(selectedCompany) }}><Pencil size={14} /> Edit</button>
            )}
            <button className="btn-primary" onClick={() => setIsViewModalOpen(false)}>Close</button>
          </>
        }
      >
        {selectedCompany && (() => {
          const sc = getStatusBadgeColor(selectedCompany.status)
          const att = selectedCompany.attendanceSettings
          const pay = selectedCompany.payrollSettings
          return (
            <div>
              <div className="modal-profile-header">
                <div className="modal-profile-info">
                  <h2>{selectedCompany.name}</h2>
                  <p>{selectedCompany.code} · {selectedCompany.domain}</p>
                  <div className="modal-profile-badges">
                    <span className="status-badge-table" style={{ background: sc.bg, color: sc.text }}>{selectedCompany.status}</span>
                    <span className="emp-dept-badge" style={{ background: '#dbeafe', color: '#2563eb' }}>{employeeCounts[selectedCompany.id] || 0} Employees</span>
                  </div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><Building2 size={18} /><h4>Company Overview</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Company Name</label><div className="field-value">{selectedCompany.name}</div></div>
                  <div className="modal-field"><label>Code</label><div className="field-value">{selectedCompany.code}</div></div>
                  <div className="modal-field"><label>Domain</label><div className="field-value">{selectedCompany.domain}</div></div>
                  <div className="modal-field"><label>Website</label><div className="field-value">{selectedCompany.website || '-'}</div></div>
                  <div className="modal-field"><label>Timezone</label><div className="field-value">{selectedCompany.timezone || '-'}</div></div>
                  <div className="modal-field"><label>Currency</label><div className="field-value">{selectedCompany.currency || '-'}</div></div>
                  <div className="modal-field"><label>Employees</label><div className="field-value">{employeeCounts[selectedCompany.id] || 0}</div></div>
                  <div className="modal-field"><label>Status</label><div className="field-value" style={{ color: sc.text }}>{selectedCompany.status}</div></div>
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><Mail size={18} /><h4>Contact Information</h4></div>
                <div className="modal-section-content">
                  <div className="modal-field"><label>Admin Name</label><div className="field-value">{selectedCompany.adminName}</div></div>
                  <div className="modal-field"><label>Admin Email</label><div className="field-value">{selectedCompany.adminEmail}</div></div>
                  <div className="modal-field"><label>Phone</label><div className="field-value">{selectedCompany.phone || '-'}</div></div>
                  <div className="modal-field"><label>Address</label><div className="field-value">{selectedCompany.address || '-'}</div></div>
                  {selectedCompany.description && (
                    <div className="modal-field" style={{ gridColumn: '1 / -1' }}><label>Description</label><div className="field-value">{selectedCompany.description}</div></div>
                  )}
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><MapPin size={18} /><h4>Attendance &amp; Security</h4></div>
                <div className="modal-section-content">
                  {att ? (
                    <>
                      <div className="modal-field" style={{ gridColumn: '1 / -1' }}><label>Office Location</label><div className="field-value">{att.officeAddress}<span style={{ fontSize: 12, color: '#6b7280', display: 'block' }}>{att.latitude}, {att.longitude}</span></div></div>
                      <div className="modal-field"><label>Geo-fence Radius</label><div className="field-value">{att.radiusInMeters}m</div></div>
                      <div className="modal-field"><label>Office Wi-Fi</label><div className="field-value">{att.requireWifi ? (att.wifiSSID || 'Required') : 'Not Required'}</div></div>
                      <div className="modal-field"><label>Mobile Data</label><div className="field-value">{att.allowMobileData ? 'Allowed' : 'Blocked'}</div></div>
                      <div className="modal-field"><label>Selfie</label><div className="field-value">{att.requireSelfie ? 'Required' : 'Optional'}</div></div>
                    </>
                  ) : (
                    <div className="modal-field" style={{ gridColumn: '1 / -1' }}><label>Status</label><div className="field-value" style={{ color: '#9ca3af' }}>Not Configured</div></div>
                  )}
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header"><DollarSign size={18} /><h4>Payroll &amp; Operational Rules</h4></div>
                <div className="modal-section-content">
                  {pay ? (
                    <>
                      <div className="modal-field"><label>Salary Cycle</label><div className="field-value">{pay.salaryCycle}</div></div>
                      <div className="modal-field"><label>Working Days / Month</label><div className="field-value">{pay.workingDaysPerMonth} days</div></div>
                      <div className="modal-field"><label>Weekends</label><div className="field-value">{pay.weekends.join(', ')}</div></div>
                      <div className="modal-field"><label>Overtime Rate</label><div className="field-value">{pay.overtimeRatePerHour}× base pay</div></div>
                    </>
                  ) : (
                    <div className="modal-field" style={{ gridColumn: '1 / -1' }}><label>Status</label><div className="field-value" style={{ color: '#9ca3af' }}>Not Configured</div></div>
                  )}
                  <div className="modal-field"><label>Avg Salary (Monthly)</label><div className="field-value">{selectedCompany.averageSalary ? `$${selectedCompany.averageSalary.toFixed(2)}` : '-'}</div></div>
                  <div className="modal-field"><label>Mandatory Attendance</label><div className="field-value">{selectedCompany.mandatoryAttendanceDays !== undefined ? `${selectedCompany.mandatoryAttendanceDays} days/month` : '-'}</div></div>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Delete Company" size="small">
        {selectedCompany && (
          <div className="delete-confirmation">
            <div className="delete-warning">
              <AlertCircle size={48} color="#ef4444" />
              <h3>Are you sure?</h3>
              <p>You are about to permanently delete <strong>{selectedCompany.name}</strong> and <em>all of its data</em> (employees, login accounts, attendance, leave, payroll, departments, etc.). This action cannot be undone.</p>
            </div>
<div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsDeleteModalOpen(false)}>Cancel</button>
                      {hasPermission('companies.delete') && (deleting ? <span className="spinner" /> : (
                        <button className="btn-danger" onClick={handleDelete}>Delete Company &amp; Data</button>
                      ))}
            </div>
          </div>
        )}
      </Modal>

      {/* DELETE ALL STAFF CONFIRMATION MODAL */}
      <Modal isOpen={isDeleteStaffModalOpen} onClose={() => setIsDeleteStaffModalOpen(false)} title="Delete All Company Staff" size="small">
        {selectedCompany && (
          <div className="delete-confirmation">
            <div className="delete-warning">
              <AlertCircle size={48} color="#ef4444" />
              <h3>Are you sure?</h3>
              <p>You are about to permanently delete <strong>all staff</strong> of <strong>{selectedCompany.name}</strong>: executives, team leaders, reporting managers and employees — including their login accounts and employee records. The company itself is kept. This cannot be undone.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsDeleteStaffModalOpen(false)}>Cancel</button>
              {hasPermission('companies.delete') && (deletingStaff ? <span className="spinner" /> : (
                <button className="btn-danger" onClick={handleDeleteAllStaff}>Delete All Staff</button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
