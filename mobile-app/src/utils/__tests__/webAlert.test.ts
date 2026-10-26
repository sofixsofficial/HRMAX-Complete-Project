import { describe, it, expect } from '@jest/globals';
import { responderFor } from '../webAlert';
import type { AlertButton } from 'react-native';

const OK: AlertButton = { text: 'OK' };
const SAVE: AlertButton = { text: 'Save', style: 'default', onPress: () => undefined };
const CANCEL: AlertButton = { text: 'Cancel', style: 'cancel', onPress: () => undefined };
const RETRY: AlertButton = { text: 'Retry', style: 'default', onPress: () => undefined };

describe('web Alert shim (react-native-web Alert.alert is a no-op)', () => {
  it('confirm() maps to the affirmative button', () => {
    expect(responderFor([CANCEL, SAVE], true)).toBe(SAVE);
    expect(responderFor([RETRY, CANCEL], true)).toBe(RETRY);
  });

  it('dismiss maps to the explicit cancel button when present', () => {
    expect(responderFor([SAVE, CANCEL], false)).toBe(CANCEL);
  });

  it('without a cancel button, dismiss falls back to the last button', () => {
    expect(responderFor([RETRY, SAVE], false)).toBe(SAVE);
  });

  it('single-button acknowledgement never resolves to undefined on confirm', () => {
    expect(responderFor([OK], true)).toBe(OK);
    // A lone OK is not a cancellation: nothing to press on dismiss.
    expect(responderFor([OK], false)).toBeUndefined();
  });

  it('handles an empty button list', () => {
    expect(responderFor([], true)).toBeUndefined();
    expect(responderFor([], false)).toBeUndefined();
  });
});
