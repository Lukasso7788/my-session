export type DeviceTier = "weak" | "normal" | "strong";

export function isChromeOSLike() {
  if (typeof navigator === "undefined") return false;

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  const ua = String(nav.userAgent || "").toLowerCase();
  const platform = String(nav.userAgentData?.platform || nav.platform || "").toLowerCase();

  return (
    ua.includes("cros") ||
    ua.includes("chromebook") ||
    platform.includes("cros") ||
    platform.includes("chrome os")
  );
}

export function detectDeviceTier(args: {
  isMobile: boolean;
  isTablet: boolean;
}): DeviceTier {
  if (typeof window === "undefined") return "normal";

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };

  const mem = Number(nav.deviceMemory || 0);
  const cores = Number(nav.hardwareConcurrency || 0);
  const chromeOS = isChromeOSLike();

  if (!chromeOS && args.isMobile) return "weak";
  if (!chromeOS && args.isTablet && (mem <= 4 || cores <= 4)) return "weak";
  if ((mem > 0 && mem <= 4) || (cores > 0 && cores <= 4)) return "weak";
  if (mem >= 8 && cores >= 8 && !args.isMobile) return "strong";

  return "normal";
}

export function getCapturePresetForTier(tier: DeviceTier) {
  if (tier === "weak") {
    return { width: 320, height: 180, fps: 10 };
  }

  if (tier === "strong") {
    return { width: 960, height: 540, fps: 24 };
  }

  return { width: 640, height: 360, fps: 15 };
}

export function shouldUseLowPowerMode(args: {
  isMobile: boolean;
  isTablet: boolean;
  tier: DeviceTier;
}) {
  if (isChromeOSLike()) return args.tier === "weak";
  return args.isMobile || args.isTablet || args.tier === "weak";
}

export function shouldHideBackgroundFx(args: {
  isMobile: boolean;
  isTablet: boolean;
  tier: DeviceTier;
}) {
  if (isChromeOSLike()) return false;
  return args.isMobile || args.isTablet || args.tier === "weak";
}
