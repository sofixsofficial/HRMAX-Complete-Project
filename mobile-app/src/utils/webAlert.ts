import { Alert, Platform, type AlertButton } from 'react-native';

/**
 * react-native-web ships `Alert.alert() {}` - a silent no-op. Every success,
 * validation and error message in the app that goes through Alert therefore
 * vanished on web: submitting a leave "did nothing" with no feedback at all
 * (the request never even told the user it failed).
 *
 * installWebAlert() swaps in a browser-backed implementation on web only;
 * native platforms keep the real system dialog.
 */

const bodyOf = (title?: string, message?: string) =>
  [title, message].filter(Boolean).join('\n');

export type AlertChoice = 'confirm' | 'cancel';

/**
 * Which button a browser confirm() maps to. Pure so it can be unit-tested:
 * - confirmed  -> the affirmative (first non-cancel) button
 * - cancelled  -> the explicit cancel button, else the last button
 */
export const responderFor = (
  buttons: AlertButton[],
  confirmed: boolean
): AlertButton | undefined => {
  if (!buttons.length) return undefined;
  if (confirmed) return buttons.find((b) => b.style !== 'cancel') || buttons[0];
  const cancel = buttons.find((b) => b.style === 'cancel');
  if (cancel) return cancel;
  return buttons.length > 1 ? buttons[buttons.length - 1] : undefined;
};

export function installWebAlert(): void {
  if (Platform.OS !== 'web') return;

  Alert.alert = (title?: string, message?: string, buttons?: AlertButton[]) => {
    const list = buttons && buttons.length ? buttons : [{ text: 'OK' }];
    const body = bodyOf(title, message);

    if (list.length === 1) {
      // Single acknowledgement: show it, then continue the flow.
      // eslint-disable-next-line no-alert
      globalThis.alert(body);
      list[0].onPress?.();
      return;
    }

    // Two or more actions -> OK/Cancel semantics.
    // eslint-disable-next-line no-alert
    const confirmed = globalThis.confirm(body);
    responderFor(list, confirmed)?.onPress?.();
  };
}
