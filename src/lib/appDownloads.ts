export const APP_DOWNLOAD_PAGE_PATH = "/download-app";

// Published release only. Update this when the installer has actually been uploaded.
export const WINDOWS_APP_DOWNLOAD = {
    version: "0.4.5",
    platform: "Windows · 64-bit",
    size: "116 MB",
    url: "https://github.com/Lukasso7788/my-session/releases/download/desktop-latest/MySession-Setup-0.4.5.exe",
} as const;

export const ANDROID_APP_PAGE_PATH = "/download-android";
export const ANDROID_APP_DOWNLOAD = {
    version: "0.2.9",
    size: "59.4 MB",
    url: "https://github.com/Lukasso7788/my-session/releases/download/android-v0.2.9/MySession-Android-0.2.9-native-preview.apk",
} as const;
