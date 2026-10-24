import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ref, uploadBytes, getDownloadURL } from '../aws/storage-compat';
import { storage } from '../aws/clients';
import { Icon } from '../utils/icons';

interface Props {
  visible: boolean;
  companyId: string;
  userId: string;
  onClose: () => void;
  onCaptured: (downloadUrl: string) => void;
}

export const SelfieCaptureModal: React.FC<Props> = ({ visible, companyId, userId, onClose, onCaptured }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const camRef = useRef<CameraView | null>(null);

  const handleCapture = async (camera: CameraView | null) => {
    if (!camera || capturing) return;
    setCapturing(true);
    try {
      const photo = await camera.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) throw new Error('Capture failed');

      const res = await fetch(photo.uri);
      const blob = await res.blob();
      const storageRef = ref(storage, `selfies/${companyId}/${userId}/${Date.now()}.jpg`);
      await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(storageRef);
      onCaptured(url);
    } catch (err: any) {
      setCapturing(false);
      alert('Failed to capture or upload selfie: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleRequestPermission = async () => {
    await requestPermission();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.title}>Take a Selfie</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {!permission?.granted ? (
          <View style={styles.centerBox}>
            {permission?.canAskAgain === false ? (
              <>
                <Icon name="camera-outline" size={40} color="#9ca3af" />
                <Text style={styles.permissionText}>
                  Camera permission is required to take a check-in selfie.
                </Text>
                <Text style={styles.permissionHint}>
                  Enable camera access for this app in your device settings, then reopen the capture screen.
                </Text>
              </>
            ) : (
              <>
                <Icon name="camera-outline" size={40} color="#9ca3af" />
                <Text style={styles.permissionText}>Camera permission is required to take a check-in selfie.</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleRequestPermission}>
                  <Text style={styles.primaryBtnText}>Grant Camera Permission</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            facing="front"
            ref={(c) => { camRef.current = c as CameraView | null; }}
          >
            <View style={styles.selfieFrame} pointerEvents="none">
              <Text style={styles.selfieHint}>Position your face in the frame</Text>
            </View>
            {capturing && (
              <View style={styles.capturingOverlay}>
                <ActivityIndicator color="#FF6600" size="large" />
                <Text style={styles.permissionText}>Uploading selfie...</Text>
              </View>
            )}
          </CameraView>
        )}

        <View style={styles.footer}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          {permission?.granted && (
            <TouchableOpacity
              style={[styles.captureBtn, capturing && { opacity: 0.6 }]}
              onPress={() => handleCapture(camRef.current)}
              disabled={capturing}
            >
              <Icon name="camera" size={22} color="#fff" />
              <Text style={styles.captureBtnText}>{capturing ? 'Uploading...' : 'Capture & Continue'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: '#111827',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  permissionText: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
  },
  permissionHint: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: '#FF6600',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  camera: {
    flex: 1,
  },
  selfieFrame: {
    position: 'absolute',
    top: '28%',
    alignSelf: 'center',
    width: 220,
    height: 260,
    borderWidth: 2,
    borderColor: '#FF6600',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 12,
  },
  selfieHint: {
    color: '#fff',
    fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  capturingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: 16,
    backgroundColor: '#111827',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  cancelBtn: {
    backgroundColor: '#374151',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  cancelBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  captureBtn: {
    flex: 1,
    backgroundColor: '#FF6600',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  captureBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
