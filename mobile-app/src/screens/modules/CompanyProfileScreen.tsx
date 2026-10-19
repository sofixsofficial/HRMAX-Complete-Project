import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { getCompanyById, updateCompany } from '../../services/companyService';
import { HeroBanner, PremiumCard, StatusBadge, PremiumBottomSheet } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';

export default function CompanyProfileScreen() {
  const navigation = useNavigation();
  const { user, hasPermission } = useAuth();
  const { effectiveCompanyId } = useCompany();
  const { colors, isDark } = useTheme();
  const canEdit = hasPermission('companies.edit');

  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!effectiveCompanyId) { setLoading(false); return; }
    getCompanyById(effectiveCompanyId).then(data => {
      setCompany(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [effectiveCompanyId]);

  const openEdit = () => {
    if (!company) { Alert.alert('Error', 'Company not found'); return; }
    if (!hasPermission('companies.edit')) {
      Alert.alert('Access denied', 'You do not have permission to edit companies');
      return;
    }
    setEditFields({
      name: company.name || '',
      address: company.address || '',
      phone: company.phone || '',
      website: company.website || '',
      description: company.description || '',
      currency: company.currency || '',
      timezone: company.timezone || '',
    });
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!company?.id) { Alert.alert('Error', 'Company not found'); return; }
    setSaving(true);
    try {
      await updateCompany(company.id, editFields);
      setCompany({ ...company, ...editFields });
      setShowEdit(false);
      Alert.alert('Success', 'Company profile updated');
    } catch {
      Alert.alert('Error', 'Failed to update');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Company Profile" onBack={() => navigation.goBack()} />
      <ScrollView>
        <View style={[styles.headerCard, { backgroundColor: company?.logoColor || colors.accent }]}>
          <View style={styles.headerContent}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>{company?.name?.charAt(0)?.toUpperCase() || 'C'}</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.companyName}>{company?.name || 'Company'}</Text>
              <StatusBadge status={company?.status || 'Active'} color={company?.status === 'Active' ? '#22c55e' : '#f59e0b'} />
            </View>
            {canEdit && (
              <TouchableOpacity onPress={openEdit} style={styles.editBtn}>
                <Ionicons name="create-outline" size={22} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Company Info</Text>
          {[
            { icon: 'globe-outline', label: 'Domain', value: company?.domain },
            { icon: 'code-outline', label: 'Code', value: company?.code },
            { icon: 'location-outline', label: 'Address', value: company?.address },
            { icon: 'call-outline', label: 'Phone', value: company?.phone },
            { icon: 'globe-outline', label: 'Website', value: company?.website },
            { icon: 'cash-outline', label: 'Currency', value: company?.currency },
            { icon: 'time-outline', label: 'Timezone', value: company?.timezone },
            { icon: 'people-outline', label: 'Employees', value: String(company?.employees || 0) },
          ].map((item, i) => (
            <View key={i} style={styles.infoRow}>
              <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{item.label}</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{item.value || 'N/A'}</Text>
            </View>
          ))}
        </PremiumCard>

        {company?.description && (
          <PremiumCard style={styles.card}>
            <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Description</Text>
            <Text style={[styles.desc, { color: colors.text }]}>{company.description}</Text>
          </PremiumCard>
        )}
      </ScrollView>

      <PremiumBottomSheet visible={showEdit} onClose={() => setShowEdit(false)} title="Edit Company Profile">
        <ScrollView style={styles.sheetContent}>
          {Object.keys(editFields).map(key => (
            <View key={key}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
                value={editFields[key]}
                onChangeText={(val) => setEditFields(prev => ({ ...prev, [key]: val }))}
                placeholderTextColor={colors.textSecondary}
                multiline={key === 'description'}
              />
            </View>
          ))}
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.accent }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </TouchableOpacity>
        </ScrollView>
      </PremiumBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerCard: { padding: 24, marginHorizontal: 16, marginTop: 16, borderRadius: 20 },
  headerContent: { flexDirection: 'row', alignItems: 'center' },
  logoCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' },
  logoText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  headerInfo: { flex: 1, marginLeft: 16, gap: 4 },
  companyName: { color: '#fff', fontSize: 22, fontWeight: '800' },
  editBtn: { padding: 8 },
  card: { marginHorizontal: 16, marginBottom: 12, padding: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 5 },
  infoLabel: { fontSize: 13, width: 90 },
  infoValue: { fontSize: 14, fontWeight: '500', flex: 1 },
  desc: { fontSize: 14, lineHeight: 22 },
  sheetContent: { paddingBottom: 30 },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 4, marginTop: 12 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1, marginBottom: 4 },
  saveBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
