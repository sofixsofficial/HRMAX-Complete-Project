import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Alert } from 'react-native';
import { doc, getDoc, updateDoc, serverTimestamp } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { formatDateSafe } from '../../utils/dateUtils';
import { Employee } from '../../types/user';
import { HeroBanner, PremiumCard, ShimmerLoader, PremiumModal } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';

export const MyProfileScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ phone: '', address: '', emergencyContact: '' });

  useEffect(() => {
    if (!user?.id) return;
    getDoc(doc(db, 'employees', user.id)).then((snap) => {
      if (snap.exists()) setEmployee({ id: snap.id, ...snap.data() } as Employee);
      setLoading(false);
    });
  }, [user?.id]);

  const onRefresh = () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 300); };
  const openEdit = () => {
    setEditForm({ phone: employee?.phone || '', address: employee?.address || '', emergencyContact: employee?.emergencyContact || '' });
    setEditModal(true);
  };

  const handleSave = async () => {
    if (!user?.id) return;
    try {
      await updateDoc(doc(db, 'employees', user.id), { phone: editForm.phone, address: editForm.address, emergencyContact: editForm.emergencyContact, updatedAt: serverTimestamp() });
      setEmployee(prev => prev ? { ...prev, phone: editForm.phone, address: editForm.address, emergencyContact: editForm.emergencyContact } : prev);
      setEditModal(false);
    } catch { Alert.alert('Error', 'Failed to update'); }
  };

  const infoRows = [
    { label: 'Email', value: user?.email, icon: 'mail-outline' },
    { label: 'Phone', value: employee?.phone || user?.phone || 'Not set', icon: 'call-outline' },
    { label: 'Department', value: employee?.department || 'Not assigned', icon: 'business-outline' },
    { label: 'Designation', value: employee?.designation || 'Not assigned', icon: 'briefcase-outline' },
    { label: 'Employee ID', value: employee?.employeeId || 'N/A', icon: 'hash-outline' },
    { label: 'Address', value: employee?.address || 'Not set', icon: 'location-outline' },
    { label: 'Emergency Contact', value: employee?.emergencyContact || 'Not set', icon: 'call-outline' },
    { label: 'Join Date', value: formatDateSafe(employee?.joinDate, 'en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), icon: 'calendar-outline' },
    { label: 'Type', value: employee?.employmentType || 'N/A', icon: 'briefcase-outline' },
    { label: 'Shift', value: employee?.shiftType ? `${employee.shiftType}` : 'N/A', icon: 'time-outline' },
  ];

  if (loading) return <ShimmerLoader count={6} height={70} style={{ padding: 16 }} />;

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="My Profile" onBack={() => navigation.goBack()} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
      <HeroBanner greeting="Your Profile" name={user?.name || 'User'} subtitle={user?.role?.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())} />

      <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: `${colors.accent}20`, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="person-outline" size={32} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{user?.name}</Text>
            <Text style={{ fontSize: 13, color: colors.accent, marginTop: 2, textTransform: 'capitalize' }}>{user?.role?.replace('-', ' ')}</Text>
          </View>
          <TouchableOpacity onPress={openEdit} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: `${colors.accent}15`, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="create-outline" size={18} color={colors.accent} />
          </TouchableOpacity>
        </View>
        {infoRows.map((row, i) => (
          <View key={row.label} style={[s.infoRow, i < infoRows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderLight }]}>
            <Icon name={row.icon} size={16} color={colors.textTertiary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ fontSize: 11, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 }}>{row.label}</Text>
              <Text style={{ fontSize: 14, color: colors.text, fontWeight: '500', marginTop: 1 }}>{row.value || 'N/A'}</Text>
            </View>
          </View>
        ))}
      </PremiumCard>

      {employee?.salary && (
        <PremiumCard style={{ marginHorizontal: 16, marginBottom: 16, padding: 16 }} accentColor="#FF6600">
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>Salary Info</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="wallet-outline" size={18} color={colors.accent} />
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>Monthly Gross:</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.accent }}>₹{(employee.monthlyGrossSalary || employee.salary)?.toLocaleString()}</Text>
          </View>
        </PremiumCard>
      )}

      <PremiumModal visible={editModal} onClose={() => setEditModal(false)} title="Edit Profile">
        {[{ key: 'phone', label: 'Phone', placeholder: 'Phone number' }, { key: 'address', label: 'Address', placeholder: 'Address' }, { key: 'emergencyContact', label: 'Emergency Contact', placeholder: 'Emergency contact' }].map((field) => (
          <View key={field.key}>
            <Text style={[s.fieldLabel, { color: colors.textSecondary }]}>{field.label}</Text>
            <TextInput style={[s.modalInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
              placeholder={field.placeholder} placeholderTextColor={colors.textTertiary}
              value={(editForm as any)[field.key]} onChangeText={(t) => setEditForm(f => ({ ...f, [field.key]: t }))} />
          </View>
        ))}
        <TouchableOpacity style={{ backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 8 }}
          onPress={handleSave}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Save Changes</Text>
        </TouchableOpacity>
      </PremiumModal>

      <View style={{ height: 24 }} />
    </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4, marginTop: 8 },
  modalInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 4 },
});
