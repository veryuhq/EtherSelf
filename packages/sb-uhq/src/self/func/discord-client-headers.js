"use strict";

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9228 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36";
const ANDROID_USER_AGENT = "Discord-Android/316011;RNA";

const DESKTOP_SUPER_PROPERTIES = {
  os: "Windows",
  browser: "Discord Client",
  release_channel: "stable",
  client_version: "1.0.9228",
  os_version: "10.0.19045",
  os_arch: "x64",
  app_arch: "x64",
  system_locale: "en-US",
  has_client_mods: false,
  browser_user_agent: DESKTOP_USER_AGENT,
  browser_version: "37.6.0",
  os_sdk_version: "19045",
  client_build_number: 512062,
  native_build_number: 77013,
  client_event_source: null,
};

const ANDROID_SUPER_PROPERTIES = {
  os: "Android",
  browser: "Discord Android",
  device: "b0q",
  system_locale: "en-US",
  has_client_mods: false,
  client_version: "316.11 - rn",
  release_channel: "googleRelease",
  browser_user_agent: "",
  browser_version: "",
  os_version: "28",
  client_build_number: 5169,
  client_event_source: null,
};

function encodeSuperProperties(properties) {
  return Buffer.from(JSON.stringify(properties)).toString("base64");
}

function makeDesktopHeaders(token, extra = {}) {
  return {
    "Authorization": token,
    "Content-Type": "application/json",
    "User-Agent": DESKTOP_USER_AGENT,
    "X-Super-Properties": encodeSuperProperties(DESKTOP_SUPER_PROPERTIES),
    "accept-language": "en-US",
    "x-debug-options": "bugReporterEnabled",
    "x-discord-locale": "en-US",
    "x-discord-timezone": "Asia/Saigon",
    "origin": "https://discord.com",
    "referer": "https://discord.com/channels/@me",
    "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    ...extra,
  };
}

function makeAndroidHeaders(token, extra = {}) {
  return {
    "Authorization": token,
    "Content-Type": "application/json",
    "User-Agent": ANDROID_USER_AGENT,
    "X-Super-Properties": encodeSuperProperties(ANDROID_SUPER_PROPERTIES),
    "accept-language": "en-US",
    "x-debug-options": "bugReporterEnabled",
    "x-discord-locale": "en-US",
    "x-discord-timezone": "Asia/Saigon",
    ...extra,
  };
}

module.exports = {
  DESKTOP_USER_AGENT,
  ANDROID_USER_AGENT,
  makeDesktopHeaders,
  makeAndroidHeaders,
};
