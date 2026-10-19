import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Switch, Alert } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useCompany } from '../../context/CompanyContext';
import { Icon } from '../../utils/icons';
import { subscribeAttendancePolicy, saveAttendancePolicy, AttendancePolicy } from '../../services/attendanceSettingsService';
import { HeroBanner, PremiumCard, ShimmerLoader } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';

export const AttendanceSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId } = useCompany();
  const s = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    mode: 'gps-only', officeName: '', officeAddress: '', latitude: '', longitude: '', radiusMeters: '100',
    wifiOnly: false, mobileDataAllowed: true, requireSelfie: false,
    enableGeofence: true, enableNetworkGuard: true, enableAntiSpoofing: true, enableSelfie: false,
    gracePeriodMinutes: '15', lateThresholdMinutes: '60', autoCheckoutMinutes: '0', enableAutoCheckout: false,
    defaultShiftStart: '09:00', defaultShiftEnd: '18:00', weekendDays: '0,6', allowedWifisText: '',
  });

  useEffect(() => {
    if (!effectiveCompanyId) return;
    const unsub = subscribeAttendancePolicy(effectiveCompanyId, (p) => {
      if (p) setForm({
        mode: p.mode, officeName: p.officeLocation.name, officeAddress: p.officeLocation.address,
        latitude: String(p.officeLocation.latitude), longitude: String(p.officeLocation.longitude), radiusMeters: String(p.officeLocation.radiusMeters),
        wifiOnly: p.wifiOnly, mobileDataAllowed: p.mobileDataAllowed, requireSelfie: p.requireSelfie,
        enableGeofence: p.enableGeofence, enableNetworkGuard: p.enableNetworkGuard, enableAntiSpoofing: p.enableAntiSpoofing,
        enableSelfie: p.enableSelfie,
        gracePeriodMinutes: String(p.gracePeriodMinutes), lateThresholdMinutes: String(p.lateThresholdMinutes),
        autoCheckoutMinutes: String(p.autoCheckoutMinutes), enableAutoCheckout: p.enableAutoCheckout,
        defaultShiftStart: p.defaultShiftStart, defaultShiftEnd: p.defaultShiftEnd,
        weekendDays: p.weekendDays.join(','), allowedWifisText: p.allowedWifis.map(w => w.ssid).join(', '),
      });
      setLoading(false);
    });
    return unsub;
  }, [effectiveCompanyId]);

  const handleSave = async () => {
    if (!effectiveCompanyId || !user?.id) return;
    setSaving(true);
    try {
      await saveAttendancePolicy(effectiveCompanyId, {
        mode: form.mode,
        officeLocation: { name: form.officeName, address: form.officeAddress, latitude: Number(form.latitude) || 0, longitude: Number(form.longitude) || 0, radiusMeters: Number(form.radiusMeters) || 100 },
        allowedWifis: form.allowedWifisText.split(',').map(s => ({ ssid: s.trim() })).filter(w => w.ssid),
        wifiOnly: form.wifiOnly, mobileDataAllowed: form.mobileDataAllowed, requireSelfie: form.requireSelfie,
        enableGeofence: form.enableGeofence, enableNetworkGuard: form.enableNetworkGuard, enableAntiSpoofing: form.enableAntiSpoofing,
        enableSelfie: form.enableSelfie,
        gracePeriodMinutes: Number(form.gracePeriodMinutes) || 15, lateThresholdMinutes: Number(form.lateThresholdMinutes) || 60,
        autoCheckoutMinutes: Number(form.autoCheckoutMinutes) || 0, enableAutoCheckout: form.enableAutoCheckout,
        defaultShiftStart: form.defaultShiftStart, defaultShiftEnd: form.defaultShiftEnd,
        weekendDays: form.weekendDays.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n)),
        updatedBy: user.id,
      } as any);
      Alert.alert('Success', 'Settings saved');
    } catch { Alert.alert('Error', 'Failed to save'); }
    finally { setSaving(false); }
  };

  if (loading) return <ShimmerLoader count={6} height={60} style={{ padding: 16 }} />;

  const Field = ({ label, value, onChange, placeholder, keyboardType, multiline }: any) => (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>{label}</Text>
      <TextInput style={[s.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
        placeholder={placeholder || label} placeholderTextColor={colors.textTertiary} value={value}
        onChangeText={onChange} keyboardType={keyboardType} multiline={multiline} />
    </View>
  );

  const Toggle = ({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 }}>
      <Text style={{ fontSize: 14, color: colors.text, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.switchTrack, true: `${colors.accent}80` }} thumbColor={value ? colors.accent : colors.textTertiary} />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Attendance Settings" onBack={() => navigation.goBack()} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} showsVerticalScrollIndicator={false}>
      <HeroBanner greeting="Configuration" name="Attendance Settings" subtitle="Configure attendance policy for your organization"
        stats={[
          { label: 'Active Rules', value: [form.enableGeofence, form.enableNetworkGuard, form.enableAntiSpoofing, form.enableSelfie, form.enableAutoCheckout, form.wifiOnly, form.mobileDataAllowed, form.requireSelfie].filter(Boolean).length, color: '#3b82f6' },
        ]}
      />

      <PremiumCard style={{ marginHorizontal: 16, marginBottom: 12, padding: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 12 }}>Office Location</Text>
        <Field label="Location Name" value={form.officeName} onChange={(t: string) => setForm(f => ({ ...f, officeName: t }))} />
        <Field label="Address" value={form.officeAddress} onChange={(t: string) => setForm(f => ({ ...f, officeAddress: t }))} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Latitude" value={form.latitude} onChange={(t: string) => setForm(f => ({ ...f, latitude: t }))} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Longitude" value={form.longitude} onChange={(t: string) => setForm(f => ({ ...f, longitude: t }))} keyboardType="decimal-pad" /></View>
        </View>
        <Field label="Geofence Radius (meters)" value={form.radiusMeters} onChange={(t: string) => setForm(f => ({ ...f, radiusMeters: t }))} keyboardType="number-pad" />
      </PremiumCard>

      <PremiumCard style={{ marginHorizontal: 16, marginBottom: 12, padding: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 12 }}>Mode & Guard</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {['gps-only', 'wifi-only', 'hybrid'].map(m => (
            <TouchableOpacity key={m} style={[s.chip, form.mode === m && { backgroundColor: colors.accent }]}
              onPress={() => setForm(f => ({ ...f, mode: m }))}>
              <Text style={[s.chipText, form.mode === m && { color: '#fff' }]}>{m.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Toggle label="Enable Geofence" value={form.enableGeofence} onValueChange={(v) => setForm(f => ({ ...f, enableGeofence: v }))} />
        <Toggle label="Enable Network Guard" value={form.enableNetworkGuard} onValueChange={(v) => setForm(f => ({ ...f, enableNetworkGuard: v }))} />
        <Toggle label="Enable Anti-Spoofing" value={form.enableAntiSpoofing} onValueChange={(v) => setForm(f => ({ ...f, enableAntiSpoofing: v }))} />
      </PremiumCard>

      <PremiumCard style={{ marginHorizontal: 16, marginBottom: 12, padding: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 12 }}>Shift Defaults</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Shift Start" value={form.defaultShiftStart} onChange={(t: string) => setForm(f => ({ ...f, defaultShiftStart: t }))} /></View>
          <View style={{ flex: 1 }}><Field label="Shift End" value={form.defaultShiftEnd} onChange={(t: string) => setForm(f => ({ ...f, defaultShiftEnd: t }))} /></View>
        </View>
        <Field label="Weekend Days (0=Sun,6=Sat, comma separated)" value={form.weekendDays} onChange={(t: string) => setForm(f => ({ ...f, weekendDays: t }))} />
      </PremiumCard>

      <PremiumCard style={{ marginHorizontal: 16, marginBottom: 12, padding: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 12 }}>Grace & Late Policy</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Grace Period (min)" value={form.gracePeriodMinutes} onChange={(t: string) => setForm(f => ({ ...f, gracePeriodMinutes: t }))} keyboardType="number-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Late Threshold (min)" value={form.lateThresholdMinutes} onChange={(t: string) => setForm(f => ({ ...f, lateThresholdMinutes: t }))} keyboardType="number-pad" /></View>
        </View>
        <Toggle label="Enable Auto Checkout" value={form.enableAutoCheckout} onValueChange={(v) => setForm(f => ({ ...f, enableAutoCheckout: v }))} />
        {form.enableAutoCheckout && <Field label="Auto Checkout After (min)" value={form.autoCheckoutMinutes} onChange={(t: string) => setForm(f => ({ ...f, autoCheckoutMinutes: t }))} keyboardType="number-pad" />}
      </PremiumCard>

      <PremiumCard style={{ marginHorizontal: 16, marginBottom: 12, padding: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 12 }}>Verification</Text>
        <Toggle label="Require Selfie" value={form.requireSelfie} onValueChange={(v) => setForm(f => ({ ...f, requireSelfie: v }))} />
        <Toggle label="Enable Selfie Verification" value={form.enableSelfie} onValueChange={(v) => setForm(f => ({ ...f, enableSelfie: v }))} />
      </PremiumCard>

      <PremiumCard style={{ marginHorizontal: 16, marginBottom: 12, padding: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 12 }}>Network</Text>
        <Field label="Allowed WiFi SSIDs (comma separated)" value={form.allowedWifisText} onChange={(t: string) => setForm(f => ({ ...f, allowedWifisText: t }))} />
        <Toggle label="WiFi Only" value={form.wifiOnly} onValueChange={(v) => setForm(f => ({ ...f, wifiOnly: v }))} />
        <Toggle label="Allow Mobile Data" value={form.mobileDataAllowed} onValueChange={(v) => setForm(f => ({ ...f, mobileDataAllowed: v }))} />
      </PremiumCard>

      <TouchableOpacity style={[s.saveBtn, { backgroundColor: colors.accent }, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
        <Icon name="checkmark-outline" size={20} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{saving ? 'Saving...' : 'Save Settings'}</Text>
      </TouchableOpacity>

      <View style={{ height: 24 }} />
    </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 16, paddingVertical: 14, borderRadius: 14, marginBottom: 12 },
});
