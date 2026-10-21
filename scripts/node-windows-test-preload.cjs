// tsx calls os.userInfo() to name its Windows IPC pipe. Some managed Windows
// sessions return ENOMEM from that OS call even when Node itself is healthy.
// Supplying the already-known process identity avoids that unrelated test-runner
// failure; application code and production builds are unaffected.
if (process.platform === 'win32' && typeof process.geteuid !== 'function') {
  process.geteuid = () => process.env.USERNAME || 'srtb-graphics';
}
