export function isPlausibleEmail(raw: string): boolean {
  const email = raw.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function canReceiveDailyDigest(input: {
  email: string;
  emailConfirmed: boolean;
  marketingEnabled: boolean;
  dailyEnabled: boolean;
  alreadyAttemptedToday: boolean;
}): boolean {
  return isPlausibleEmail(input.email) && input.emailConfirmed && input.marketingEnabled
    && input.dailyEnabled && !input.alreadyAttemptedToday;
}

export function isLocalMorning(value: Date, timeZone: string): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", hourCycle: "h23", timeZone,
  }).format(value));
  return hour === 8 || hour === 9;
}
