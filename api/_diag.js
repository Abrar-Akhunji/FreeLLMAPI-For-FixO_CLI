export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    node: process.version,
    env: {
      hasFirebase: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
      hasGoogleCreds: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      hasEncryptionKey: Boolean(process.env.ENCRYPTION_KEY),
      nodeEnv: process.env.NODE_ENV,
    },
  });
}
