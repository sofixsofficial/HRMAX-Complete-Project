/**
 * Cognito PreSignUp trigger — auto-confirms the user and marks the email
 * verified. The app's sign-up flow signs the new admin in immediately and
 * email verification is informational (sendEmailVerification), never a
 * gate before first login. Without this trigger the web sign-up flow would
 * strand new admins on a code-entry screen the app doesn't have.
 */

export const handler = async (event: {
  response: { autoConfirmUser?: boolean; autoVerifyEmail?: boolean };
}) => {
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
