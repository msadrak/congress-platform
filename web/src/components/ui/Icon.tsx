import type { SVGProps } from "react";

/**
 * AIteb product icon set: 24px grid, 1.75 stroke, round joins. Drawn for this platform so every
 * portal shares one consistent line language (no emoji, no mixed icon libraries).
 *
 * Logical direction (RTL). Icons are named for English (LTR) reading and the set mirrors the
 * directional ones itself, so a caller never picks a glyph by direction (no `isRtl ? "arrow-right" : …`):
 * - Mirrored in RTL: chevrons and arrows that mean "back", "forward", "open" or "next"
 *   (`arrow-left` is always "back", `chevron-right` always "opens something"), `arrow-up-right`
 *   (external link), and the door pair `login` / `logout`.
 * - Never mirrored: clocks and time, media (`play`, `pause`), charts, `upload` / `download`, `sync`,
 *   `chevron-down` / `arrow-up` / `arrow-down` (vertical), checkmarks, the QR and every object icon.
 * - A row that opens something ends with `chevron-right`; a call-to-action button uses `arrow-right`.
 */
const paths = {
  calendar: "M4.5 4.5h15A1.5 1.5 0 0 1 21 6v13.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5V6a1.5 1.5 0 0 1 1.5-1.5ZM3 9.5h18M8 2.5v4M16 2.5v4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3.5 2",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21ZM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
  ticket: "M3 8.5v-2A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v2a3.5 3.5 0 0 0 0 7v2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-2a3.5 3.5 0 0 0 0-7ZM14.5 7.5v1.5M14.5 11.25v1.5M14.5 15v1.5",
  qr: "M4.5 3h4A1.5 1.5 0 0 1 10 4.5v4A1.5 1.5 0 0 1 8.5 10h-4A1.5 1.5 0 0 1 3 8.5v-4A1.5 1.5 0 0 1 4.5 3ZM15.5 3h4A1.5 1.5 0 0 1 21 4.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 14 8.5v-4A1.5 1.5 0 0 1 15.5 3ZM4.5 14h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 8.5 21h-4A1.5 1.5 0 0 1 3 19.5v-4A1.5 1.5 0 0 1 4.5 14ZM14 14h2.5v2.5H14ZM19 14h2M14 20.5h2.5M19 18.5h2V21",
  scan: "M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16",
  users: "M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8",
  user: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4.5 21a7.5 7.5 0 0 1 15 0",
  congress: "M3 21h18M4.5 10h15M12 3l8.5 5h-17ZM6.5 10v8M10 10v8M14 10v8M17.5 10v8",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v5.5M12 7.75v.01",
  check: "M5 12.5l4.5 4.5L19 7.5",
  "check-circle": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8 12.5l3 3 5-6",
  x: "M6 6l12 12M18 6 6 18",
  "x-circle": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9 9l6 6M15 9l-6 6",
  alert: "M10.3 4.1 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0ZM12 9.5v4.5M12 17.25v.01",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  "arrow-left": "M19 12H5M11 6l-6 6 6 6",
  "arrow-up-right": "M7 17 17 7M9 7h8v8",
  "chevron-right": "M9.5 6l6 6-6 6",
  "chevron-left": "M14.5 6l-6 6 6 6",
  "chevron-down": "M6 9.5l6 6 6-6",
  download: "M12 3.5v12M7 10.5l5 5 5-5M4 20h16",
  search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM16 16l4.5 4.5",
  print: "M7 9V3.5h10V9M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2M7 14h10v6.5H7Z",
  bookmark: "M6.5 3.5h11V21l-5.5-4-5.5 4Z",
  booth: "M4.5 10v10h15V10M3 5.5 5 3h14l2 2.5v2a2.5 2.5 0 0 1-4.5 1.5 2.5 2.5 0 0 1-4.5 0 2.5 2.5 0 0 1-4.5 0A2.5 2.5 0 0 1 3 7.5ZM9.5 20v-5h5v5",
  chart: "M5 20v-8M10 20V5M15 20v-5M20 20V9M3 20.5h18",
  gate: "M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21M3 21h18M14.5 12v.5",
  key: "M8 10.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM11.2 11.8 20 3M16.5 6.5 19 9M14.5 8.5l2 2",
  logout: "M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M9.5 8l-4 4 4 4M5.5 12H15",
  login: "M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 8l4 4-4 4M14 12H4.5",
  more: "M6.5 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM19.5 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z",
  camera: "M4.5 7h2.8l1.7-2.5h6L16.7 7h2.8A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-10A1.5 1.5 0 0 1 4.5 7ZM12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
  keyboard: "M4.5 6h15A2 2 0 0 1 21.5 8v8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9",
  sync: "M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4",
  wifi: "M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.01",
  "wifi-off": "M2.5 9a14 14 0 0 1 4.3-2.8M10.5 5.1A14 14 0 0 1 21.5 9M5.5 12.5a9.5 9.5 0 0 1 4-2.3M15.5 10.9a9.5 9.5 0 0 1 3 1.6M8.5 16a5 5 0 0 1 6-.8M12 19.5v.01M3 3l18 18",
  flame: "M12 21c-4 0-7-2.7-7-6.5 0-3.4 2.5-5.4 3.5-8.5 1.6 1.4 2.6 3.1 2.6 5 1-.7 1.8-2 2-3.5 2.3 1.7 5.9 4.3 5.9 7C19 18.3 16 21 12 21Z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  snow: "M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M9.5 4 12 6l2.5-2M9.5 20l2.5-2 2.5 2",
  note: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17ZM13.5 6.5l3 3",
  tag: "M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.4 1.4 0 0 1 0 2l-7.1 7.1a1.4 1.4 0 0 1-2 0ZM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
  mail: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM3.5 6.5 12 13l8.5-6.5",
  phone: "M5 3.5h3.5L10 8 7.8 9.4a11 11 0 0 0 6.8 6.8l1.4-2.2 4.5 1.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5Z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  shield: "M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6ZM9 12l2 2 4-4",
  lock: "M6.5 10.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM8 10.5v-3a4 4 0 0 1 8 0v3",
  file: "M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5ZM14 3v4.5h4.5M9 13h6M9 16.5h4",
  "id-card": "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM9 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 16a3 3 0 0 1 6 0M14.5 10h4M14.5 13.5h3",
  utensils: "M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.2 1.2-3.5 3.6-3.5 6.5V14H17",
  layers: "M12 3l9 5-9 5-9-5ZM3 12.5l9 5 9-5M3 16.5l9 5 9-5",
  volume: "M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  "volume-off": "M11 5 6 9H3v6h3l5 4V5ZM22 9l-6 6M16 9l6 6",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  "eye-off": "M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.6 6.6A16.5 16.5 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 5.3-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18",
  copy: "M10 8h8.5a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2ZM16 8V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9.5A1.5 1.5 0 0 0 5 16h3",
  menu: "M4 7h16M4 12h16M4 17h16",
  trash: "M4 7h16M9 7V4.5h6V7M6 7l1 13.5h10L18 7",
  filter: "M3.5 5h17l-6.5 8v6l-4 2v-8Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  share: "M12 3.5v11M8 7.5l4-4 4 4M5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6",
  pause: "M8.5 5v14M15.5 5v14",
  play: "M7 4.5v15l12-7.5Z",
  activity: "M3 12h4l3-7 4 14 3-7h4",
  device: "M8.5 2.5h7A2.5 2.5 0 0 1 18 5v14a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 19V5a2.5 2.5 0 0 1 2.5-2.5ZM11 18.5h2",
  grid: "M4.5 3.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM14.5 3.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM4.5 13.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM14.5 13.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z",
  "user-plus": "M10 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM2.5 21a7.5 7.5 0 0 1 12.2-5.8M19 14v6M16 17h6",
  hourglass: "M6.5 3h11M6.5 21h11M7.5 3c0 4.5 4.5 5.5 4.5 9s-4.5 4.5-4.5 9M16.5 3c0 4.5-4.5 5.5-4.5 9s4.5 4.5 4.5 9",
  image: "M4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-13A1.5 1.5 0 0 1 4.5 4ZM3 16l5-5 4 4 3-3 6 6M15.5 8.5v.01",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9.5 9.25a2.5 2.5 0 1 1 3.5 2.3c-.6.27-1 .86-1 1.5v.45M12 16.75v.01",
  mic: "M12 3a3 3 0 0 0-3 3v5.5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  "arrow-up": "M12 19V5M6 11l6-6 6 6",
  "arrow-down": "M12 5v14M6 13l6 6 6-6",
  upload: "M12 15.5v-12M7 8.5l5-5 5 5M4 20h16",
  palette: "M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.4-1.3-1.8-1.3-3 0-1 .8-1.8 1.8-1.8h2.2A4.5 4.5 0 0 0 21 10c0-3.9-4-7-9-7ZM7.5 11.5v.01M10 7.5v.01M15 7.5v.01",
  monitor: "M4.5 4h15A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-10A1.5 1.5 0 0 1 4.5 4ZM9 21h6M12 17v4",
  smartphone: "M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5ZM11 18.5h2",
  megaphone: "M3.5 10v4a1 1 0 0 0 1 1H7l7.5 4.5V4.5L7 9H4.5a1 1 0 0 0-1 1ZM18 9a4 4 0 0 1 0 6M7 15l1.2 5",
  type: "M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6",
  // Page Studio: blocks, channels and the text toolbar.
  video: "M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5ZM10 9.2v5.6l4.8-2.8Z",
  columns: "M4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-13A1.5 1.5 0 0 1 4.5 4ZM12 4v16",
  send: "M21 3 3 10.4l7 2.6M21 3l-7.4 18-3.6-8M21 3 10 13",
  message: "M5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4V16A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4Z",
  chat: "M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z",
  instagram: "M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM17.2 6.8h.01",
  linkedin: "M4.5 3h15A1.5 1.5 0 0 1 21 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-15A1.5 1.5 0 0 1 4.5 3ZM8 10.5V17M8 7.4v.01M12 17v-6.5M12 13.5a2.5 2.5 0 0 1 5 0V17",
  "x-brand": "M4 4h4.5L20 20h-4.5ZM20 4l-6.6 7.2M4 20l6.6-7.2",
  bold: "M7 4.5h5.5a3.75 3.75 0 0 1 0 7.5H7ZM7 12h6.5a3.75 3.75 0 0 1 0 7.5H7Z",
  italic: "M10 4.5h8M6 19.5h8M14 4.5l-4 15",
  heading: "M5 5v14M13 5v14M5 12h8M17 19h4M19 19v-8l-2 1.5",
  "list-ordered": "M10 6h11M10 12h11M10 18h11M4 4.5h1.5V9M4 9h3M4 14.6a1.5 1.5 0 1 1 2.6 1L4 18.5h3",
  quote: "M4 7h6v5c0 3-2 5-5 5.5M14 7h6v5c0 3-2 5-5 5.5",
  highlight: "M9 15l-3 3h4l1.5-1.5M9 15l7.5-7.5a2.1 2.1 0 0 1 3 3L12 18M9 15l3 3M4 21h16",
  star: "M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8Z",
  web: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3.5 9h17M3.5 15h17M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z",
} as const;

export type IconName = keyof typeof paths;

/** Icons that point along the reading direction and must mirror in RTL. */
const directional = new Set<IconName>(["arrow-right", "arrow-left", "arrow-up-right", "chevron-right", "chevron-left", "logout", "login"]);

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Accessible name; omit for decorative icons next to visible text. */
  label?: string;
}

export function Icon({ name, size = 20, strokeWidth = 1.75, label, className = "", ...props }: IconProps) {
  const flip = directional.has(name) ? "rtl:-scale-x-100" : "";
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={`shrink-0 ${flip} ${className}`.trim()}
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
