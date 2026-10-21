// Secrets are supplied by Pages, never in the client bundle or committed values.
// MEDIA exists only in the local qualification/test environment.
interface Env {
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  FIREBASE_ACCOUNT_DELETER?: string;
  MEDIA?: R2Bucket;
}
