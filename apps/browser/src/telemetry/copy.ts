export const SHARING_COPY = {
  toggle: "Share anonymous crash reports and usage stats",
  summary: "Crashes, errors, rough feature counts and speed. Never the sites you visit, anything you type or search, or what's in your tabs.",
  whatsSent: "What's Sent",
  footnote:
    "Sent to PostHog in the EU with a random ID made on this Mac. Turning this off stops it at once and deletes anything waiting to be sent. This setting doesn't sync.",
  ask: {
    title: "Help fix Netnyahoo?",
    body: "Share anonymous crash reports and usage stats. No sites, searches or typing. Ever.",
    share: "Share",
    notNow: "Not now",
  },
  onboarding: {
    title: "Help us fix what breaks",
    row: "Crashes, errors, feature counts and speed. Never your sites, typing or tabs.",
    subtitle: "Off unless you turn it on. You can change it any time in Settings › Privacy & Security.",
  },
} as const;

export const WHATS_SENT: { title: string; items: string[] }[] = [
  {
    title: "With everything",
    items: [
      "A random install ID, made on this Mac (a new one each time sharing is turned back on)",
      "App version and build, macOS version, chip (arm64 or x86_64), engine version",
      "A random ID for this launch, and whether it's a test build",
    ],
  },
  {
    title: "Crashes and errors",
    items: [
      "The error's type and message, with web addresses, paths, file names, quoted text and long numbers taken out",
      "Function names, script file names and line numbers from the stack trace",
      "After a crash: the exception type and the crashing thread's function names from this app's crash report",
      "Warning and error log lines, cleaned the same way",
    ],
  },
  {
    title: "Usage",
    items: [
      "Launches, updates, and whether the last session ended cleanly",
      "How many tabs and windows you open (a count, not which)",
      "Opening split view, switching profiles and opening the command bar",
      "The kind of command bar row you pick: history, bookmark, tab, address, search, calculator or action",
      "Installing an extension, turning sync on or off, translating a page, and which Settings sections you open",
    ],
  },
  {
    title: "Speed",
    items: [
      "Time to the first window, profile switch time, and command bar speed (a sample of keystrokes)",
      "Memory use and the number of tabs, once an hour",
    ],
  },
  {
    title: "Never",
    items: [
      "Web addresses, site names or page titles",
      "Anything you type or search for",
      "History, bookmarks, passwords or what's in your tabs",
      "Profile, extension or file names",
      "Screen recordings",
    ],
  },
];
