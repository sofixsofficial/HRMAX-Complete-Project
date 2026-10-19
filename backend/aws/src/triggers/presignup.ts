/**
 * Cognito PreSignUp trigger — auto-confirms the user and marks the email
 * verified. Firebase parity: the original flow's
 * createUserWithEmailAndPassword returned a signed-in credential immediately
 * and email verification was informational (sendEmailVerification), never a
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
