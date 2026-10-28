import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, TextInput, ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Icon } from '../utils/icons';
import type { Branch } from '../services/branchService';

/**
 * Branch + QR sheet for check-in.
 *
 * The server records every punch against a branch and, for QR-enabled
 * companies, rejects it without the branch's scanned code (QR_REQUIRED /
 * QR_INVALID). This modal is the mobile equivalent of the web punch banner's
 * branch pill + "Scan or enter branch QR code" field: pick the branch (only
 * when the account has more than one authorized), scan the QR posted at that
 * branch, or type the code when the camera is unavailable.
 */
interface Props {
  visible: boolean;
  branches: Branch[];
  primaryBranchId: string;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: { branchId: string; qrToken: string }) => void;
}

export const BranchQrModal: React.FC<Props> = ({
  visible, branches, primaryBranchId, submitting, onClose, onSubmit,
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [selected, setSelected] = useState(primaryBranchId || (branches[0]?.id ?? ''));
  const [qrToken, setQrToken] = useState('');
  const [scanned, setScanned] = useState(false);
  const scanLock = useRef(false);

  // Fresh state every time the sheet opens (a stale token from yesterday's
  // punch must never be silently reused).
  useEffect(() => {
    if (visible) {
      setSelected(primaryBranchId || (branches[0]?.id ?? ''));
      setQrToken('');
      setScanned(false);
      scanLock.current = false;
    }
  }, [visible, primaryBranchId, branches]);

  const canSubmit = !!selected && !!qrToken.trim() && !submitting;

  const handleScan = ({ data }: { data: string }) => {
    if (scanLock.current) return; // CameraView can fire repeatedly on one code
    scanLock.current = true;
    setScanned(true);
    setQrToken(String(data ?? '').trim());
  };

  const selectedBranch = branches.find((b) => b.id === selected);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.title}>Check-in at your branch</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {branches.length > 1 && (
            <View style={styles.section}>
              <Text style={styles.label}>Branch</Text>
              <View style={styles.chipRow}>
                {branches.map((b) => {
                  const active = b.id === selected;
                  return (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => { setSelected(b.id); setScanned(false); scanLock.current = false; }}
                    >
                      <Icon name="business-outline" size={14} color={active ? '#fff' : '#374151'} />
                      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                        {b.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {!!selectedBranch?.address && <Text style={styles.hint}>{selectedBranch.address}</Text>}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.label}>Branch QR code</Text>
            {!permission?.granted ? (
              <View style={styles.permissionBox}>
                <Icon name="qr-code-outline" size={34} color="#9ca3af" />
                <Text style={styles.permissionText}>
                  Camera access is needed to scan the QR code posted at your branch.
                </Text>
                {permission?.canAskAgain === false ? (
                  <Text style={styles.hint}>
                    Camera is blocked — enable it in device settings, or type the code below.
                  </Text>
                ) : (
                  <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
                    <Text style={styles.primaryBtnText}>Enable Camera</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : scanned ? (
              <View style={styles.scannedBox}>
                <Icon name="checkmark-circle" size={30} color="#16a34a" />
                <Text style={styles.scannedText}>QR code captured</Text>
                <TouchableOpacity onPress={() => { setScanned(false); setQrToken(''); scanLock.current = false; }}>
                  <Text style={styles.rescanText}>Scan again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleScan}
              >
                <View style={styles.scanFrame} pointerEvents="none">
                  <Text style={styles.scanHint}>Align the branch QR code inside the frame</Text>
                </View>
              </CameraView>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Or type the code</Text>
            <TextInput
              style={styles.input}
              value={qrToken}
              onChangeText={(t) => { setQrToken(t); setScanned(false); scanLock.current = false; }}
              placeholder="Enter the branch QR code"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmBtn, !canSubmit && { opacity: 0.5 }]}
            onPress={() => canSubmit && onSubmit({ branchId: selected, qrToken: qrToken.trim() })}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Icon name="log-in-outline" size={20} color="#fff" />
                <Text style={styles.confirmBtnText}>Check In</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#111827' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14, backgroundColor: '#111827',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  closeBtn: { padding: 4 },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  section: { marginBottom: 22 },
  label: { color: '#d1d5db', fontSize: 13, fontWeight: '600', marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1f2937', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#374151', maxWidth: 220,
  },
  chipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  chipText: { color: '#374151', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  hint: { color: '#9ca3af', fontSize: 12, marginTop: 8 },
  camera: { height: 240, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  scanFrame: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,102,0,0.9)', borderRadius: 16, margin: 42,
  },
  scanHint: { color: '#fff', fontSize: 12, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  permissionBox: {
    alignItems: 'center', gap: 10, backgroundColor: '#1f2937',
    borderRadius: 16, paddingVertical: 26, paddingHorizontal: 18,
  },
  permissionText: { color: '#d1d5db', fontSize: 13, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: '#FF6600', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22, marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  scannedBox: {
    alignItems: 'center', gap: 6, backgroundColor: '#1f2937',
    borderRadius: 16, paddingVertical: 24,
  },
  scannedText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  rescanText: { color: '#FF6600', fontSize: 13, fontWeight: '600', marginTop: 4 },
  input: {
    backgroundColor: '#1f2937', borderRadius: 12, borderWidth: 1, borderColor: '#374151',
    color: '#fff', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  footer: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingBottom: 34, paddingTop: 12,
    backgroundColor: '#111827', borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  cancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1, borderColor: '#374151', paddingVertical: 14,
  },
  cancelBtnText: { color: '#d1d5db', fontSize: 15, fontWeight: '600' },
  confirmBtn: {
    flex: 2, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FF6600', borderRadius: 12, paddingVertical: 14,
  },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
