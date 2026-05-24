import { resetDailyQuotas } from '../db/index.js';

let intervalId: NodeJS.Timeout | null = null;

export function startQuotaResetService() {
  if (intervalId) return;
  
  try {
    resetDailyQuotas();
  } catch (e) {
    console.error('[QuotaReset] Failed to reset daily quotas on startup', e);
  }
  
  intervalId = setInterval(() => {
    try {
      resetDailyQuotas();
    } catch (e) {
      console.error('[QuotaReset] Failed to reset daily quotas', e);
    }
  }, 60 * 60 * 1000); // Check every hour
}
