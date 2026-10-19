import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { getCompanyById, updateCompany } from '../../services/companyService';
import { HeroBanner, PremiumCard, PremiumBottomSheet, StatusBadge } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import { formatDateSafe } from '../../utils/dateUtils';

export default function CompanyDetailsViewScreen({ route }: any) {
  const { companyId } = route?.params || {};
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();

  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAttendance, setShowAttendance] = useState(false);
  const [showPayroll, setShowPayroll] = useState(false);

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    getCompanyById(companyId).then(data => {
      setCompany(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [companyId]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  if (!company) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <Ionicons name="alert-circle" size={48} color="#ef4444" />
          <Text style={[styles.errorText, { color: colors.text }]}>Company not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Company Details" onBack={() => navigation.goBack()} />
      <ScrollView>
        <View style={[styles.headerCard, { backgroundColor: company.logoColor || colors.accent }]}>
          <View style={styles.headerContent}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>{company.name?.charAt(0)?.toUpperCase()}</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.companyName}>{company.name}</Text>
              <StatusBadge status={company.status || 'Active'} color={company.status === 'Active' ? '#22c55e' : '#f59e0b'} />
            </View>
          </View>
        </View>

        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>General Info</Text>
          {[
            { icon: 'globe-outline', label: 'Domain', value: company.domain || 'N/A' },
            { icon: 'code-outline', label: 'Code', value: company.code || 'N/A' },
            { icon: 'location-outline', label: 'Address', value: company.address || 'N/A' },
            { icon: 'call-outline', label: 'Phone', value: company.phone || 'N/A' },
            { icon: 'cash-outline', label: 'Currency', value: company.currency || 'N/A' },
            { icon: 'time-outline', label: 'Timezone', value: company.timezone || 'N/A' },
          ].map((item, i) => (
            <View key={i} style={styles.infoRow}>
              <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{item.label}</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{item.value}</Text>
            </View>
          ))}
        </PremiumCard>

        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Admin</Text>
          {[
            { icon: 'person-outline', label: 'Name', value: company.adminName || 'N/A' },
            { icon: 'mail-outline', label: 'Email', value: company.adminEmail || 'N/A' },
            { icon: 'call-outline', label: 'Phone', value: company.adminPhone || 'N/A' },
          ].map((item, i) => (
            <View key={i} style={styles.infoRow}>
              <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{item.label}</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{item.value}</Text>
            </View>
          ))}
        </PremiumCard>

        <TouchableOpacity style={[styles.sectionBtn, { backgroundColor: colors.card }]} onPress={() => setShowAttendance(true)}>
          <Ionicons name="settings-outline" size={20} color={colors.accent} />
          <Text style={[styles.sectionBtnText, { color: colors.text }]}>Attendance Settings</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.sectionBtn, { backgroundColor: colors.card }]} onPress={() => setShowPayroll(true)}>
          <Ionicons name="cash-outline" size={20} color={colors.accent} />
          <Text style={[styles.sectionBtnText, { color: colors.text }]}>Payroll Settings</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Stats</Text>
          {[
            { icon: 'people-outline', label: 'Employees', value: String(company.employees || 0) },
            { icon: 'calendar-outline', label: 'Created', value: formatDateSafe(company.createdOn) },
            { icon: 'flag-outline', label: 'Mode', value: company.operationalMode || 'Continuous' },
          ].map((item, i) => (
            <View key={i} style={styles.infoRow}>
              <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{item.label}</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{item.value}</Text>
            </View>
          ))}
        </PremiumCard>
      </ScrollView>

      <PremiumBottomSheet visible={showAttendance} onClose={() => setShowAttendance(false)} title="Attendance Settings">
        {company.attendanceSettings && (
          <View style={styles.sheetContent}>
            {[
              { icon: 'location-outline', label: 'Office Address', value: company.attendanceSettings.officeAddress },
              { icon: 'map-outline', label: 'Coordinates', value: `${company.attendanceSettings.latitude}, ${company.attendanceSettings.longitude}` },
              { icon: 'radio-outline', label: 'Radius', value: `${company.attendanceSettings.radiusInMeters}m` },
              { icon: 'wifi-outline', label: 'WiFi SSID', value: company.attendanceSettings.wifiSSID },
              { icon: 'camera-outline', label: 'Require Selfie', value: company.attendanceSettings.requireSelfie ? 'Yes' : 'No' },
            ].map((item, i) => (
              <View key={i} style={styles.infoRow}>
                <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{item.label}</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>{item.value || 'N/A'}</Text>
              </View>
            ))}
          </View>
        )}
      </PremiumBottomSheet>

      <PremiumBottomSheet visible={showPayroll} onClose={() => setShowPayroll(false)} title="Payroll Settings">
        {company.payrollSettings && (
          <View style={styles.sheetContent}>
            {[
              { icon: 'calendar-outline', label: 'Cycle', value: company.payrollSettings.salaryCycle },
              { icon: 'calculator-outline', label: 'Working Days/Month', value: String(company.payrollSettings.workingDaysPerMonth) },
              { icon: 'cash-outline', label: 'Overtime Rate/hr', value: String(company.payrollSettings.overtimeRatePerHour) },
            ].map((item, i) => (
              <View key={i} style={styles.infoRow}>
                <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{item.label}</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>{item.value}</Text>
              </View>
            ))}
          </View>
        )}
      </PremiumBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: { fontSize: 16, fontWeight: '600' },
  headerCard: { padding: 24, marginHorizontal: 16, marginTop: 16, borderRadius: 20 },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  logoCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' },
  logoText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  headerInfo: { gap: 6 },
  companyName: { color: '#fff', fontSize: 22, fontWeight: '800' },
  card: { marginHorizontal: 16, marginBottom: 12, padding: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 5 },
  infoLabel: { fontSize: 13, width: 90 },
  infoValue: { fontSize: 14, fontWeight: '500', flex: 1 },
  sectionBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, marginHorizontal: 16, marginBottom: 8, borderRadius: 14, elevation: 1, gap: 10 },
  sectionBtnText: { fontSize: 15, fontWeight: '500', flex: 1 },
  sheetContent: { paddingBottom: 20 },
});
