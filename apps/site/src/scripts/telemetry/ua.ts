// Browser, OS and device from the user agent, with PostHog's names and values ($browser "Mobile Safari",
// $os "Mac OS X", $device_type "Desktop" …), so old and new events group the same way.

export interface Device {
  $browser: string;
  $browser_version: number | null;
  $os: string;
  $os_version: string | null;
  $device: string | null;
  $device_type: "Mobile" | "Tablet" | "Desktop";
  $device_model: string | null;
  $webview_app: string | null;
  $webview_app_version: string | null;
}

const version = (ua: string, re: RegExp): number | null => {
  const m = re.exec(ua);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
};

function browser(ua: string, brave: boolean): [string, number | null] {
  if (brave) return ["Brave", null];
  if (/ OPR\/|Opera/.test(ua)) return ["Opera", version(ua, /(?:OPR|Opera)\/(\d+(?:\.\d+)?)/)];
  if (/BlackBerry|PlayBook|BB10/.test(ua)) return ["BlackBerry", version(ua, /Version\/(\d+(?:\.\d+)?)/)];
  if (/Edge?\//.test(ua)) return ["Microsoft Edge", version(ua, /Edge?\/(\d+(?:\.\d+)?)/)];
  if (/FBIOS|FBAN\/FBIOS/.test(ua)) return ["Facebook Mobile", version(ua, /FBAV\/(\d+(?:\.\d+)?)/)];
  if (/UCWEB|UCBrowser/.test(ua)) return ["UC Browser", version(ua, /UCBrowser\/(\d+(?:\.\d+)?)/)];
  if (/CriOS\//.test(ua)) return ["Chrome iOS", version(ua, /CriOS\/(\d+(?:\.\d+)?)/)];
  if (/YaBrowser\//.test(ua)) return ["Yandex", version(ua, /YaBrowser\/(\d+(?:\.\d+)?)/)];
  if (/SamsungBrowser\//.test(ua)) return ["Samsung Internet", version(ua, /SamsungBrowser\/(\d+(?:\.\d+)?)/)];
  if (/ Ddg\//.test(ua)) return ["DuckDuckGo", version(ua, /Ddg\/(\d+(?:\.\d+)?)/)];
  if (/Chrome\//.test(ua)) return ["Chrome", version(ua, /Chrome\/(\d+(?:\.\d+)?)/)];
  if (/FxiOS\//.test(ua)) return ["Firefox iOS", version(ua, /FxiOS\/(\d+(?:\.\d+)?)/)];
  if (/Firefox\//.test(ua)) return ["Firefox", version(ua, /Firefox\/(\d+(?:\.\d+)?)/)];
  if (/Android/.test(ua)) return ["Android Mobile", version(ua, /Android (\d+(?:\.\d+)?)/)];
  if (/MSIE|Trident\//.test(ua)) return ["Internet Explorer", version(ua, /(?:MSIE |rv:)(\d+(?:\.\d+)?)/)];
  if (/AppleWebKit/.test(ua) && (/Mobile\//.test(ua) || /iPhone|iPad|iPod/.test(ua)))
    return ["Mobile Safari", version(ua, /Version\/(\d+(?:\.\d+)?)/)];
  if (/Safari\//.test(ua)) return ["Safari", version(ua, /Version\/(\d+(?:\.\d+)?)/)];
  if (/Gecko\//.test(ua)) return ["Mozilla", version(ua, /rv:(\d+(?:\.\d+)?)/)];
  return ["", null];
}

const WINDOWS: Record<string, string> = { "10.0": "10", "6.3": "8.1", "6.2": "8", "6.1": "7", "6.0": "Vista", "5.1": "XP", "5.0": "2000" };
const dotted = (a: string, b?: string, c?: string) => `${a}.${b ?? 0}.${c ?? 0}`;

function os(ua: string): [string, string | null] {
  let m: RegExpExecArray | null;
  if (/Windows Phone|WPDesktop/.test(ua)) return ["Windows Phone", null];
  if ((m = /Windows NT (\d+\.\d+)/.exec(ua))) return ["Windows", WINDOWS[m[1]] ?? m[1]];
  if (/Windows/.test(ua)) return ["Windows", null];
  if (/iPhone|iPad|iPod/.test(ua)) {
    m = /OS (\d+)_(\d+)(?:_(\d+))?/.exec(ua);
    return ["iOS", m ? dotted(m[1], m[2], m[3]) : null];
  }
  if (/Android/.test(ua)) return ["Android", /Android (\d+(?:\.\d+)*)/.exec(ua)?.[1] ?? null];
  if (/BlackBerry|PlayBook|BB10/.test(ua)) return ["BlackBerry", null];
  if (/CrOS/.test(ua)) return ["Chrome OS", null];
  if (/Macintosh|Mac OS X/.test(ua)) {
    m = /Mac OS X (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua);
    return ["Mac OS X", m ? dotted(m[1], m[2], m[3]) : null];
  }
  if (/Linux|X11/.test(ua)) return ["Linux", null];
  return ["", null];
}

function device(ua: string): string | null {
  if (/Windows Phone|WPDesktop/.test(ua)) return "Windows Phone";
  if (/iPad/.test(ua)) return "iPad";
  if (/iPod/.test(ua)) return "iPod Touch";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/BlackBerry|PlayBook|BB10/.test(ua)) return "BlackBerry";
  if (/Kindle|Silk\//.test(ua)) return "Kindle Fire";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android" : "Android Tablet";
  return null;
}

const TABLETS = new Set(["iPad", "Android Tablet", "Kindle Fire", "PlayBook"]);

// In-app browsers (X is most of the traffic): the app and its version.
const WEBVIEWS: [string, RegExp][] = [
  ["Twitter", /(?:TwitterAndroid|Twitter for iP(?:hone|ad))\/(\d[\d.]*\d|\d)/],
  ["Facebook", /(?:FBAV|FB_IAB\/[^;]*;FBAV)\/(\d[\d.]*\d|\d)/],
  ["Instagram", /Instagram (\d[\d.]*\d|\d)/],
  ["WeChat", /MicroMessenger\/(\d[\d.]*\d|\d)/],
  ["Snapchat", /Snapchat\/(\d[\d.]*\d|\d)/],
  ["LinkedIn", /LinkedInApp(?:\/(\d[\d.]*\d|\d))?/],
  ["TikTok", /(?:musical_ly|BytedanceWebview|TikTok)[_/ ]?(\d[\d.]*\d|\d)?/],
  ["Threads", /Barcelona (\d[\d.]*\d|\d)/],
  ["Line", / Line\/(\d[\d.]*\d|\d)/],
  ["Telegram", /Telegram(?:-Android)?\/(\d[\d.]*\d|\d)/],
  ["Discord", /discord\/(\d[\d.]*\d|\d)/i],
  ["Reddit", /Reddit\/(?:Version )?(\d[\d.]*\d|\d)/],
];

export function parseUserAgent(ua: string, brave = false): Device {
  const [b, bv] = browser(ua, brave);
  const [o, ov] = os(ua);
  const d = device(ua);
  let app: string | null = null;
  let appVersion: string | null = null;
  for (const [name, re] of WEBVIEWS) {
    const m = re.exec(ua);
    if (m) {
      app = name;
      appVersion = m[1] ?? null;
      break;
    }
  }
  // Android puts the model in the UA ("Android 16; Pixel 10 Build/…"); reduced UAs say "K".
  let model = /Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/.exec(ua)?.[1] ?? null;
  if (model === "K" || model === "Mobile" || model === "Tablet") model = null;
  return {
    $browser: b,
    $browser_version: bv,
    $os: o,
    $os_version: ov,
    $device: d,
    $device_type: d === null ? "Desktop" : TABLETS.has(d) ? "Tablet" : "Mobile",
    $device_model: model,
    $webview_app: app,
    $webview_app_version: appVersion,
  };
}
