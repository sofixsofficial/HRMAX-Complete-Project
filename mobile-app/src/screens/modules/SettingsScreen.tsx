import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, Switch, ActivityIndicator, Platform } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useNotifications } from '../../hooks/useNotifications';
import { validatePasswordPolicy } from '../../utils/passwordPolicy';
import { Icon } from '../../utils/icons';
import { collection, onSnapshot } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { ScreenHeader } from '../../components/ScreenHeader';

type Tab = 'profile' | 'notifications' | 'security' | 'system';

export const SettingsScreen: React.FC<{ navigation?: any }> = ({ navigation }) => {
  const { user, logout } = useAuth();
  const { colors, isDark, toggleTheme } = useTheme();
  const { isRegistered, register, unregister } = useNotifications();
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [userStats, setUserStats] = useState<Record<string, number>>({});
  const s = useMemo(() => createStyles(colors), [colors]);

  const isMasterAdmin = user?.role === 'master-admin';
  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'security', label: 'Security' },
  ];
  if (isMasterAdmin) {
    tabs.push({ key: 'system', label: 'System Config' });
  }

  useEffect(() => {
    if (!isMasterAdmin) return;
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const counts: Record<string, number> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        const role = data.role || 'unknown';
        counts[role] = (counts[role] || 0) + 1;
      });
      setUserStats(counts);
    }, () => {});
    return unsub;
  }, [isMasterAdmin]);

  const handleUpdateProfile = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Name cannot be empty.'); return; }
    try {
      const { updateUserProfile } = await import('../../services/authService');
      await updateUserProfile({ name: name.trim() });
      Alert.alert('Success', 'Profile updated successfully!');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile.');
    }
  };

  const handleUpdatePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Error', 'Please fill current and new password');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }
    if (newPassword === currentPassword) {
      Alert.alert('Error', 'New password must be different from the current password.');
      return;
    }
    // Same 8+/upper/lower/digit/symbol policy as the web and the server.
    const policy = validatePasswordPolicy(newPassword);
    if (!policy.valid) {
      Alert.alert('Password does not meet the requirements', policy.errors.join('\n'));
      return;
    }
    setSaving(true);
    try {
      // Server-verified: backend re-checks the current password, enforces the
      // policy, records the audit event and emails the user. Genuine server
      // messages ("Current password is incorrect", policy errors) surface here.
      const { changePassword } = await import('../../services/authService');
      await changePassword(currentPassword, newPassword);
      Alert.alert('Success', 'Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      const { toDisplayError } = await import('../../aws/errors');
      Alert.alert('Error', toDisplayError(error).message || 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    // RN-web's Alert.alert is a no-op — without window.confirm the confirm
    // dialog never appears in the browser preview and Sign Out does nothing.
    const confirmed = Platform.OS === 'web'
      ? window.confirm('Are you sure you want to logout?')
      : await new Promise<boolean>((resolve) => {
          Alert.alert('Logout', 'Are you sure you want to logout?', [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Logout', style: 'destructive', onPress: () => resolve(true) },
          ]);
        });
    if (!confirmed) return;
    try {
      await logout();
    } catch (error: any) {
      const msg = error?.message || 'Logout failed';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'profile':
        return (
          <>
            <View style={s.section}>
              <Text style={s.sectionTitle}>Profile</Text>
              <View style={s.card}>
                <View style={s.avatarContainer}>
                  <Text style={s.avatarText}>{user?.name?.charAt(0) || '?'}</Text>
                </View>
                <Text style={s.email}>{user?.email}</Text>
                <Text style={s.role}>{user?.role?.replace('-', ' ').toUpperCase()}</Text>
              </View>
            </View>
            <View style={s.section}>
              <Text style={s.sectionTitle}>Update Name</Text>
              <View style={s.card}>
                <TextInput style={s.input} placeholder="Your name" placeholderTextColor={colors.textTertiary} value={name} onChangeText={setName} />
                <TouchableOpacity style={s.saveButton} onPress={handleUpdateProfile}>
                  <Text style={s.saveText}>Save Changes</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        );
      case 'notifications':
        return (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Notification Preferences</Text>
            <View style={s.card}>
              <View style={s.settingRow}>
                <Text style={s.settingLabel}>Push Notifications</Text>
                <Switch value={isRegistered} onValueChange={(v) => v ? register() : unregister()} trackColor={{ false: colors.switchTrack, true: '#FF6600' }} thumbColor="#fff" />
              </View>
              <View style={[s.settingRow, { marginTop: 16 }]}>
                <Text style={s.settingLabel}>Dark Mode</Text>
                <Switch value={isDark} onValueChange={toggleTheme} trackColor={{ false: colors.switchTrack, true: '#FF6600' }} thumbColor="#fff" />
              </View>
            </View>
          </View>
        );
      case 'security':
        return (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Change Password</Text>
            <View style={s.card}>
              <Text style={s.fieldLabel}>Current Password</Text>
              <View style={s.inputRow}>
                <TextInput style={s.inputFlex} placeholder="Enter current password" placeholderTextColor={colors.textTertiary} value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry={!showCurrentPw} autoCapitalize="none" />
                <Icon name={showCurrentPw ? 'eye-off-outline' : 'eye-outline'} size={22} color="#FF6600" onPress={() => setShowCurrentPw(!showCurrentPw)} />
              </View>
              <Text style={s.fieldLabel}>New Password</Text>
              <View style={s.inputRow}>
                <TextInput style={s.inputFlex} placeholder="Enter new password (min 6 chars)" placeholderTextColor={colors.textTertiary} value={newPassword} onChangeText={setNewPassword} secureTextEntry={!showNewPw} autoCapitalize="none" />
                <Icon name={showNewPw ? 'eye-off-outline' : 'eye-outline'} size={22} color="#FF6600" onPress={() => setShowNewPw(!showNewPw)} />
              </View>
              <Text style={s.fieldLabel}>Confirm Password</Text>
              <View style={s.inputRow}>
                <TextInput style={s.inputFlex} placeholder="Confirm new password" placeholderTextColor={colors.textTertiary} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry={!showConfirmPw} autoCapitalize="none" />
                <Icon name={showConfirmPw ? 'eye-off-outline' : 'eye-outline'} size={22} color="#FF6600" onPress={() => setShowConfirmPw(!showConfirmPw)} />
              </View>
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <Text style={s.mismatchText}>Passwords do not match</Text>
              )}
              <TouchableOpacity style={[s.saveButton, saving && { opacity: 0.6 }]} onPress={handleUpdatePassword} disabled={saving}>
                <Text style={s.saveText}>{saving ? 'Updating...' : 'Update Password'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      case 'system':
        return (
          <>
            <View style={s.section}>
              <Text style={s.sectionTitle}>User Management</Text>
              <View style={s.card}>
                {Object.entries(userStats).length === 0 ? (
                  <ActivityIndicator size="small" color="#FF6600" />
                ) : (
                  Object.entries(userStats).map(([role, count]) => (
                    <View key={role} style={s.settingRow}>
                      <Text style={s.settingLabel}>{role.replace('-', ' ')}</Text>
                      <Text style={[s.settingValue, { color: colors.accent }]}>{count}</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
            <View style={s.section}>
              <Text style={s.sectionTitle}>Security Protocols</Text>
              <View style={s.card}>
                {[
                  { label: 'Session Timeout', value: '30 minutes' },
                  { label: 'Max Login Attempts', value: '5' },
                  { label: 'Min Password Length', value: '8 characters' },
                  { label: 'MFA Required', value: 'Disabled' },
                ].map(item => (
                  <View key={item.label} style={s.protocolRow}>
                    <Text style={s.settingLabel}>{item.label}</Text>
                    <Text style={s.protocolValue}>{item.value}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={s.section}>
              <TouchableOpacity style={s.card} onPress={() => navigation?.navigate?.('Home', { screen: 'AuditLogs' })}>
                <View style={[s.settingRow, { marginBottom: 8 }]}>
                  <Text style={[s.settingLabel, { fontWeight: '600' }]}>Recent Audit Logs</Text>
                  <Icon name="arrow-forward-outline" size={18} color={colors.accent} />
                </View>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>View the latest security and access logs</Text>
              </TouchableOpacity>
            </View>
          </>
        );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Settings" />
      <ScrollView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Settings</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRow}>
        {tabs.map(t => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[s.tabBtn, activeTab === t.key && s.tabBtnActive]}
          >
            <Text style={[s.tabText, activeTab === t.key && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {renderTabContent()}

      <TouchableOpacity style={s.logoutButton} onPress={handleLogout}>
        <Text style={s.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: c.text },
  tabRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16, borderBottomWidth: 2, borderBottomColor: c.border, flexWrap: 'wrap' },
  tabBtn: { paddingVertical: 10, paddingHorizontal: 14, marginRight: 4 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: c.accent, marginBottom: -2 },
  tabText: { fontSize: 13, fontWeight: '500', color: c.textSecondary },
  tabTextActive: { color: c.accent },
  section: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 16 },
  avatarContainer: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FF6600', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 12 },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  email: { color: c.textPrimary, fontSize: 16, textAlign: 'center' },
  role: { color: c.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 4 },
  input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, marginBottom: 12 },
  inputFlex: { flex: 1, paddingVertical: 12, color: c.text, fontSize: 15 },
  mismatchText: { color: '#ef4444', fontSize: 12, marginBottom: 8 },
  saveButton: { backgroundColor: '#FF6600', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  settingLabel: { color: c.textPrimary, fontSize: 14, flex: 1 },
  settingValue: { fontSize: 14, fontWeight: '600' },
  protocolRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderLight },
  protocolValue: { fontSize: 13, color: c.textSecondary },
  logoutButton: { marginHorizontal: 20, backgroundColor: c.card, borderRadius: 10, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#ef4444', marginTop: 8 },
  logoutText: { color: '#ef4444', fontSize: 16, fontWeight: '600' },
});
