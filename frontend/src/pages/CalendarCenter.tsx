import { useState, useEffect, useMemo } from 'react'
import {
  Calendar, Search, ChevronLeft, ChevronRight, Download,
  Eye, Clock, Star, Briefcase, Users, CalendarDays,
  Filter, LayoutGrid, List, Building2
} from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { getAllHolidays, getHolidaysByCompany } from '../services/holidayService'
import { getAllEmployees, getEmployeesByCompany } from '../services/employeeService'
import { getAllLeaveRequests, getLeaveRequestsByCompany } from '../services/leaveService'
import { getAllTasks, getTasksByCompany } from '../services/taskService'
import { getAllCompanies } from '../services/companyService'
import { isDate } from '../utils/dateUtils'
import { scopedCompanyIds } from '../utils/companyScope'
import type { Holiday, Employee, LeaveRequest, Task, Company } from '../types/user'
import './Employees.css'
import './Assets.css'

interface CalendarEvent {
  id: string
  title: string
  date: Date
  type: 'Holiday' | 'Birthday' | 'Leave' | 'Task' | 'Meeting'
  description: string
  color: string
  bgColor: string
  extra?: string
  companyName?: string
}

const EVENT_COLORS: Record<string, { color: string; bgColor: string }> = {
  Holiday: { color: '#ea580c', bgColor: '#fff7ed' },
  Birthday: { color: '#db2777', bgColor: '#fdf2f8' },
  Leave: { color: '#2563eb', bgColor: '#eff6ff' },
  Task: { color: '#16a34a', bgColor: '#f0fdf4' },
  Meeting: { color: '#7c3aed', bgColor: '#f5f3ff' },
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type ViewMode = 'month' | 'week' | 'day'
type EventType = 'All' | 'Holiday' | 'Birthday' | 'Leave' | 'Task' | 'Meeting'
const EVENT_TYPES: EventType[] = ['All', 'Holiday', 'Birthday', 'Leave', 'Task', 'Meeting']

export function CalendarCenter() {
  const { user } = useAuth()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId: setGlobalCompanyId, selectedCompanyName } = usePermissionScope('calendar')
  const isMasterAdmin = user?.role === 'master-admin'

  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [eventTypeFilter, setEventTypeFilter] = useState<EventType>('All')
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [companies, setCompanies] = useState<Company[]>([])

  const companyId = effectiveCompanyId || user?.companyId || ''

  useEffect(() => {
    if (isMasterAdmin) {
      getAllCompanies().then(setCompanies).catch(() => setCompanies([]))
    }
  }, [isMasterAdmin])

  useEffect(() => {
    fetchData()
  }, [companyId, effectiveCompanyId, availableCompanies, isMasterAdmin])

  const fetchData = async () => {
    try {
      setLoading(true)

      if (isMasterAdmin) {
        const filterCompanyId = companyId || undefined

        const [holidaysData, employeesData, leavesData, tasksData] = await Promise.all([
          filterCompanyId ? getHolidaysByCompany(filterCompanyId).catch(() => []) : getAllHolidays().catch(() => []),
          filterCompanyId ? getEmployeesByCompany(filterCompanyId).catch(() => []) : getAllEmployees().catch(() => []),
          filterCompanyId ? getLeaveRequestsByCompany(filterCompanyId).catch(() => []) : getAllLeaveRequests().catch(() => []),
          filterCompanyId ? getTasksByCompany(filterCompanyId).catch(() => []) : getAllTasks().catch(() => []),
        ])
        setHolidays(holidaysData)
        setEmployees(employeesData)
        setLeaves(leavesData)
        setTasks(tasksData)
      } else {
        // Scope: selected company, or ALL authorized companies in "All Companies" mode
        const ids = scopedCompanyIds(effectiveCompanyId, availableCompanies)
        const byCompany = async <T,>(fn: (cid: string) => Promise<T[]>): Promise<T[]> => {
          const results = await Promise.all(ids.map(id => fn(id).catch(() => [] as T[])))
          return results.flat()
        }
        const [holidaysData, employeesData, leavesData, tasksData] = await Promise.all([
          byCompany(getHolidaysByCompany),
          byCompany(getEmployeesByCompany),
          byCompany(getLeaveRequestsByCompany),
          byCompany(getTasksByCompany),
        ])
        setHolidays(holidaysData)
        setEmployees(employeesData)
        setLeaves(leavesData)
        setTasks(tasksData)
      }
    } catch (err) {
      console.error('Error fetching calendar data:', err)
    } finally {
      setLoading(false)
    }
  }

  const companyMap = useMemo(() => {
    const map: Record<string, string> = {}
    companies.forEach(c => { map[c.id] = c.name })
    return map
  }, [companies])

  const allEvents: CalendarEvent[] = useMemo(() => {
    const events: CalendarEvent[] = []

    holidays.forEach(h => {
      events.push({
        id: `h-${h.id}`,
        title: h.name,
        date: isDate(h.date) ? h.date : new Date(h.date),
        type: 'Holiday',
        description: h.description || `${h.type} Holiday`,
        color: EVENT_COLORS.Holiday.color,
        bgColor: EVENT_COLORS.Holiday.bgColor,
        extra: h.type,
        companyName: isMasterAdmin && h.companyId ? companyMap[h.companyId] : undefined,
      })
    })

    employees.forEach(e => {
      if (e.birthDate) {
        const dob = isDate(e.birthDate) ? e.birthDate : new Date(e.birthDate)
        const birthdayThisYear = new Date(currentDate.getFullYear(), dob.getMonth(), dob.getDate())
        events.push({
          id: `b-${e.id}`,
          title: `${e.name}'s Birthday`,
          date: birthdayThisYear,
          type: 'Birthday',
          description: `Birthday celebration for ${e.name}`,
          color: EVENT_COLORS.Birthday.color,
          bgColor: EVENT_COLORS.Birthday.bgColor,
          extra: e.department || '',
          companyName: isMasterAdmin && e.companyId ? companyMap[e.companyId] : undefined,
        })
      }
    })

    leaves.forEach(l => {
      events.push({
        id: `l-${l.id}`,
        title: `${l.employeeName} - ${l.leaveType} Leave`,
        date: isDate(l.startDate) ? l.startDate : new Date(l.startDate),
        type: 'Leave',
        description: `${l.leaveType} leave from ${isDate(l.startDate) ? l.startDate.toLocaleDateString() : new Date(l.startDate).toLocaleDateString()} to ${isDate(l.endDate) ? l.endDate.toLocaleDateString() : new Date(l.endDate).toLocaleDateString()}`,
        color: EVENT_COLORS.Leave.color,
        bgColor: EVENT_COLORS.Leave.bgColor,
        extra: l.status,
        companyName: isMasterAdmin && l.companyId ? companyMap[l.companyId] : undefined,
      })
    })

    tasks.forEach(t => {
      events.push({
        id: `t-${t.id}`,
        title: t.title,
        date: isDate(t.dueDate) ? t.dueDate : new Date(t.dueDate),
        type: 'Task',
        description: t.description,
        color: EVENT_COLORS.Task.color,
        bgColor: EVENT_COLORS.Task.bgColor,
        extra: t.priority,
        companyName: isMasterAdmin && t.companyId ? companyMap[t.companyId] : undefined,
      })
    })

    return events
  }, [holidays, employees, leaves, tasks, currentDate, isMasterAdmin, companyMap])

  const filteredEvents = useMemo(() => {
    let filtered = allEvents

    if (eventTypeFilter !== 'All') {
      filtered = filtered.filter(e => e.type === eventTypeFilter)
    }

    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      filtered = filtered.filter(e =>
        e.title.toLowerCase().includes(s) || e.description.toLowerCase().includes(s)
      )
    }

    return filtered
  }, [allEvents, eventTypeFilter, searchTerm])

  const statsCards = useMemo(() => [
    { icon: Calendar, label: 'Total Events', value: filteredEvents.length, color: '#f97316', bgColor: '#fff7ed', filterValue: 'All' as const },
    { icon: Star, label: 'Holidays', value: filteredEvents.filter(e => e.type === 'Holiday').length, color: '#ea580c', bgColor: '#fff7ed', filterValue: 'Holiday' as const },
    { icon: Users, label: 'Birthdays', value: filteredEvents.filter(e => e.type === 'Birthday').length, color: '#db2777', bgColor: '#fdf2f8', filterValue: 'Birthday' as const },
    { icon: Clock, label: 'Leaves', value: filteredEvents.filter(e => e.type === 'Leave').length, color: '#2563eb', bgColor: '#eff6ff', filterValue: 'Leave' as const },
    { icon: Briefcase, label: 'Tasks', value: filteredEvents.filter(e => e.type === 'Task').length, color: '#16a34a', bgColor: '#f0fdf4', filterValue: 'Task' as const },
  ], [filteredEvents])

  const currentMonth = currentDate.getMonth()
  const currentYear = currentDate.getFullYear()

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay()

  const calendarDays = useMemo(() => {
    const days: (Date | null)[] = []
    for (let i = 0; i < firstDayOfMonth; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(new Date(currentYear, currentMonth, d))
    }
    return days
  }, [currentYear, currentMonth, firstDayOfMonth, daysInMonth])

  const getEventsForDate = (date: Date) => {
    return filteredEvents.filter(e => {
        const evDate = isDate(e.date) ? e.date : new Date(e.date)
      return evDate.toDateString() === date.toDateString()
    })
  }

  const upcomingEvents = useMemo(() => {
    const now = new Date()
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return filteredEvents
      .filter(e => {
      const evDate = isDate(e.date) ? e.date : new Date(e.date)
        return evDate >= todayEnd
      })
      .sort((a, b) => {
        const da = isDate(a.date) ? a.date : new Date(a.date)
        const db = isDate(b.date) ? b.date : new Date(b.date)
        return da.getTime() - db.getTime()
      })
      .slice(0, 10)
  }, [filteredEvents])

  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : []

  const navigateMonth = (direction: number) => {
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() + direction)
    setCurrentDate(newDate)
  }

  const goToToday = () => {
    setCurrentDate(new Date())
    setSelectedDate(new Date())
  }

  const handleExport = () => {
    const csvContent = [
      ['Title', 'Date', 'Type', 'Description'].join(','),
      ...filteredEvents.map(e => [
        e.title,
        isDate(e.date) ? e.date.toLocaleDateString() : new Date(e.date).toLocaleDateString(),
        e.type,
        e.description,
      ].join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'calendar-events.csv'
    a.click()
  }

  const handleCardFilter = (filterValue: EventType) => {
    setEventTypeFilter(prev => prev === filterValue ? 'All' : filterValue)
  }

  const renderMonthView = () => (
    <div className="flex gap-5 flex-1 max-lg:flex-col">
      <div className="flex-1">
        <div className="table-wrapper" style={{ marginBottom: 0 }}>
          <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
            {WEEKDAYS.map(day => (
              <div key={day} className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map((date, idx) => {
              if (!date) return <div key={`empty-${idx}`} className="min-h-[100px] border-r border-b border-gray-100 bg-gray-50/50" />
              const dayEvents = getEventsForDate(date)
              const isToday = date.toDateString() === new Date().toDateString()
              const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString()
              return (
                <div
                  key={date.toISOString()}
                  onClick={() => setSelectedDate(date)}
                  className={`min-h-[100px] border-r border-b border-gray-100 p-1.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-orange-50' : isToday ? 'bg-amber-50/60' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-medium w-[26px] h-[26px] rounded-full flex items-center justify-center ${
                      isToday ? 'bg-orange-500 text-white font-bold' : 'text-gray-700'
                    }`}>{date.getDate()}</span>
                    {dayEvents.length > 0 && <span className="text-[10px] text-gray-400">{dayEvents.length}</span>}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map(ev => (
                      <div
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); setIsViewOpen(true) }}
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium truncate cursor-pointer"
                        style={{ background: ev.bgColor, color: ev.color }}
                        title={ev.companyName ? `${ev.title} [${ev.companyName}]` : ev.title}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[10px] text-gray-400 pl-1">+{dayEvents.length - 3} more</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="w-[320px] max-lg:w-full flex flex-col gap-4">
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="m-0 mb-1 text-[15px] font-bold text-slate-900">
            {selectedDate ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'Select a date'}
          </h3>
          <p className="m-0 mb-4 text-xs text-gray-400">
            {selectedDate ? `${selectedDateEvents.length} event${selectedDateEvents.length !== 1 ? 's' : ''}` : 'Click on a date to see events'}
          </p>
          {selectedDate && selectedDateEvents.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No events on this date{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}</p>
          )}
          {selectedDate && selectedDateEvents.map(ev => (
            <div key={ev.id} className="flex items-start gap-2.5 py-2.5 border-b border-gray-100 cursor-pointer" onClick={() => { setSelectedEvent(ev); setIsViewOpen(true) }}>
              <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ background: ev.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{ev.title}</div>
                <div className="text-[11px] text-gray-400">{ev.type}{ev.extra ? ` · ${ev.extra}` : ''}{ev.companyName ? ` · ${ev.companyName}` : ''}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-100 rounded-xl p-5 flex-1">
          <h3 className="m-0 mb-4 text-[15px] font-bold text-slate-900">Upcoming Events</h3>
          {upcomingEvents.length === 0 ? (
            <p className="text-sm text-gray-400 text-center">No upcoming events{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}</p>
          ) : upcomingEvents.map(ev => (
            <div key={ev.id} className="flex items-start gap-2.5 py-2 border-b border-gray-100 cursor-pointer" onClick={() => { setSelectedEvent(ev); setIsViewOpen(true) }}>
              <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ background: ev.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{ev.title}</div>
                <div className="text-[11px] text-gray-400">
                  {(isDate(ev.date) ? ev.date : new Date(ev.date)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' · '}
                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px]" style={{ background: ev.bgColor, color: ev.color }}>{ev.type}</span>
                  {ev.companyName && ` · ${ev.companyName}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  const renderWeekView = () => {
    const startOfWeek = new Date(currentDate)
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())

    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek)
      d.setDate(d.getDate() + i)
      return d
    })

    return (
      <div className="flex gap-5 flex-1 max-lg:flex-col">
        <div className="flex-1">
          <div className="table-wrapper" style={{ marginBottom: 0 }}>
            <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
              {weekDays.map(d => (
                <div key={d.toISOString()} className="px-3 py-3 text-center" style={{ borderBottom: d.toDateString() === new Date().toDateString() ? '3px solid #f97316' : 'none' }}>
                  <div className="text-[11px] text-gray-500 font-semibold">{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                  <div className={`text-lg font-bold ${d.toDateString() === new Date().toDateString() ? 'text-orange-500' : 'text-slate-900'}`}>{d.getDate()}</div>
                </div>
              ))}
            </div>
            <div className="p-4 min-h-[400px]">
              {weekDays.map(d => {
                const dayEvents = getEventsForDate(d)
                return (
                  <div key={d.toISOString()} className="mb-3">
                    {dayEvents.length > 0 && (
                      <>
                        <div className="text-xs font-semibold text-gray-500 mb-1.5">{d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                        {dayEvents.map(ev => (
                          <div
                            key={ev.id}
                            onClick={() => { setSelectedEvent(ev); setIsViewOpen(true) }}
                            className="flex items-center gap-2.5 px-3 py-2 my-1 rounded-lg cursor-pointer"
                            style={{ background: ev.bgColor }}
                          >
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ev.color }} />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-semibold text-slate-900">{ev.title}</span>
                              {ev.companyName && <span className="text-[10px] text-gray-500 ml-2">[{ev.companyName}]</span>}
                            </div>
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px]" style={{ background: ev.bgColor, color: ev.color, border: `1px solid ${ev.color}30` }}>{ev.type}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="w-[300px] max-lg:w-full">
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="m-0 mb-4 text-[15px] font-bold text-slate-900">This Week</h3>
            {upcomingEvents.slice(0, 5).map(ev => (
              <div key={ev.id} className="flex items-start gap-2.5 py-2 border-b border-gray-100 cursor-pointer" onClick={() => { setSelectedEvent(ev); setIsViewOpen(true) }}>
                <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ background: ev.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{ev.title}</div>
                  <div className="text-[11px] text-gray-400">{(isDate(ev.date) ? ev.date : new Date(ev.date)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {ev.type}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const renderDayView = () => {
    const dayToShow = selectedDate || new Date()
    const dayEvents = getEventsForDate(dayToShow)

    return (
      <div className="flex gap-5 flex-1 max-lg:flex-col">
        <div className="flex-1">
          <div className="table-wrapper" style={{ marginBottom: 0 }}>
            <div className="p-5">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-16 h-16 rounded-xl bg-orange-50 flex items-center justify-center">
                  <CalendarDays size={28} color="#f97316" />
                </div>
                <div>
                  <h3 className="m-0 text-xl font-bold text-slate-900">{dayToShow.toLocaleDateString('en-US', { weekday: 'long' })}</h3>
                  <p className="m-0 text-sm text-gray-500">{dayToShow.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              {dayEvents.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Calendar size={48} color="#d1d5db" />
                  <p className="text-sm mt-3">No events scheduled for this day{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}</p>
                </div>
              ) : (
                dayEvents.map(ev => (
                  <div
                    key={ev.id}
                    onClick={() => { setSelectedEvent(ev); setIsViewOpen(true) }}
                    className="flex items-start gap-4 p-4 mb-2 rounded-xl cursor-pointer"
                    style={{ background: ev.bgColor, borderLeft: `3px solid ${ev.color}` }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-semibold text-slate-900">{ev.title}</div>
                      <div className="text-sm text-gray-500 mt-0.5">{ev.description}</div>
                    </div>
                    <span className="inline-block px-2 py-0.5 rounded text-xs shrink-0" style={{ background: ev.bgColor, color: ev.color, border: `1px solid ${ev.color}30` }}>
                      {ev.type}{ev.companyName ? ` · ${ev.companyName}` : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="w-[300px] max-lg:w-full">
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="m-0 mb-4 text-[15px] font-bold text-slate-900">Upcoming</h3>
            {upcomingEvents.slice(0, 7).map(ev => (
              <div key={ev.id} className="flex items-start gap-2.5 py-2 border-b border-gray-100 cursor-pointer" onClick={() => { setSelectedEvent(ev); setIsViewOpen(true) }}>
                <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ background: ev.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{ev.title}</div>
                  <div className="text-[11px] text-gray-400">{(isDate(ev.date) ? ev.date : new Date(ev.date)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {ev.type}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Calendar Center" breadcrumbs={['Dashboard', 'Calendar Center']} />

      <div className="page-content">
        <div className="w-full max-w-7xl 2xl:max-w-[1600px] mx-auto">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            {statsCards.map((stat, idx) => {
              const Icon = stat.icon
              const isActive = eventTypeFilter === stat.filterValue
              return (
                <div
                  key={idx}
                  className={`bg-white border rounded-xl p-4 flex items-center gap-3.5 cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${
                    isActive ? 'border-orange-500 shadow-md' : 'border-gray-100 shadow-sm'
                  }`}
                  style={isActive ? { boxShadow: '0 0 0 2px rgba(249,115,22,0.2), 0 4px 12px rgba(249,115,22,0.1)' } : undefined}
                  onClick={() => handleCardFilter(stat.filterValue)}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: stat.bgColor, color: stat.color }}>
                    <Icon size={20} />
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <strong className="text-lg font-bold text-gray-900 leading-none">{stat.value}</strong>
                    <span className="text-xs text-gray-500">{stat.label}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Search & Filters Toolbar */}
          <div className="bg-white rounded-xl shadow-sm mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search events..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:border-orange-500 bg-white"
                />
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {/* Company filter */}
                <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white">
                  <Building2 size={14} className="text-gray-400 shrink-0" />
                  <select
                    value={companyId}
                    onChange={(e) => setGlobalCompanyId(e.target.value)}
                    className="text-sm border-none outline-none bg-transparent cursor-pointer text-gray-700"
                    style={{ padding: 0 }}
                  >
                    {canAccessAllCompanies && <option value="">All Companies</option>}
                    {(canAccessAllCompanies ? companies : availableCompanies).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Type filter */}
                <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white">
                  <Filter size={14} className="text-gray-400 shrink-0" />
                  <select
                    value={eventTypeFilter}
                    onChange={e => setEventTypeFilter(e.target.value as EventType)}
                    className="text-sm border-none outline-none bg-transparent cursor-pointer text-gray-700"
                    style={{ padding: 0 }}
                  >
                    {EVENT_TYPES.map(t => <option key={t} value={t}>{t === 'All' ? 'All Types' : t}</option>)}
                  </select>
                </div>

                {/* Year */}
                <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white">
                  <select
                    value={currentYear}
                    onChange={e => { const d = new Date(currentDate); d.setFullYear(parseInt(e.target.value)); setCurrentDate(d) }}
                    className="text-sm border-none outline-none bg-transparent cursor-pointer text-gray-700"
                    style={{ padding: 0 }}
                  >
                    {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>

                {/* Month */}
                <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white">
                  <select
                    value={MONTHS[currentMonth]}
                    onChange={e => { const d = new Date(currentDate); d.setMonth(MONTHS.indexOf(e.target.value)); setCurrentDate(d) }}
                    className="text-sm border-none outline-none bg-transparent cursor-pointer text-gray-700"
                    style={{ padding: 0 }}
                  >
                    {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                {/* View mode */}
                <div className="flex bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                  {(['month', 'week', 'day'] as ViewMode[]).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={`px-3.5 py-1.5 text-xs font-semibold cursor-pointer flex items-center gap-1 transition-all ${
                        viewMode === mode ? 'bg-orange-500 text-white' : 'bg-transparent text-gray-500 hover:text-gray-700'
                      }`}
                      style={{ border: 'none' }}
                    >
                      {mode === 'month' ? <LayoutGrid size={14} /> : <List size={14} />}
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Export */}
                <button className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm" onClick={handleExport}>
                  <Download size={16} /> Export
                </button>
              </div>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 mb-3">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <button onClick={() => navigateMonth(-1)} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center cursor-pointer hover:bg-gray-50">
                  <ChevronLeft size={16} />
                </button>
                <button onClick={() => navigateMonth(1)} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center cursor-pointer hover:bg-gray-50">
                  <ChevronRight size={16} />
                </button>
                <h3 className="m-0 text-lg font-bold text-slate-900">{MONTHS[currentMonth]} {currentYear}</h3>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={goToToday} className="px-3.5 py-1.5 border border-orange-500 bg-orange-50 text-orange-500 rounded-lg text-sm font-semibold cursor-pointer hover:bg-orange-100">
                  Today
                </button>
                <div className="flex items-center gap-3 flex-wrap">
                  {Object.entries(EVENT_COLORS).map(([type, colors]) => (
                    <div key={type} className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full" style={{ background: colors.color }} />
                      <span className="text-[11px] text-gray-500">{type}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {viewMode === 'month' && renderMonthView()}
            {viewMode === 'week' && renderWeekView()}
            {viewMode === 'day' && renderDayView()}
          </div>
        </div>
      </div>

      <Modal isOpen={isViewOpen} onClose={() => setIsViewOpen(false)} title="Event Details" size="small">
        {selectedEvent && (
          <div className="emp-profile">
            <div className="emp-profile-header">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: selectedEvent.bgColor }}>
                <Calendar size={24} color={selectedEvent.color} />
              </div>
              <div>
                <h2 className="m-0">{selectedEvent.title}</h2>
                <p className="text-gray-500 text-sm m-0 mt-1">
                  {(isDate(selectedEvent.date) ? selectedEvent.date : new Date(selectedEvent.date)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
                <span className="inline-block px-2.5 py-1 rounded text-xs font-medium mt-1.5" style={{ background: selectedEvent.bgColor, color: selectedEvent.color }}>{selectedEvent.type}</span>
              </div>
            </div>
            <div className="emp-profile-grid" style={{ gridTemplateColumns: '1fr' }}>
              <div className="emp-profile-section">
                <h4><Eye size={16} /> Details</h4>
                <div className="emp-profile-fields">
                  <div><label>Description</label><span>{selectedEvent.description}</span></div>
                  {selectedEvent.extra && <div><label>Additional Info</label><span>{selectedEvent.extra}</span></div>}
                  {selectedEvent.companyName && <div><label>Company</label><span>{selectedEvent.companyName}</span></div>}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
