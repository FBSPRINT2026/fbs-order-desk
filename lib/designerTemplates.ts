/**
 * Idea Lab "design ideas": starter layouts customers change the words on.
 * Clip art is listed as candidates ("set:name"); the first one the library has is used,
 * with the built-in art ("fbs:...") as the last fallback. Artboard: 600 x 700 (12" x 14").
 */
export type TplText = { kind: "text"; text: string; font: string; size: number; y: number; x?: number; weight?: number; color?: string; stroke?: string; strokeW?: number; spacing?: number; arc?: number; rot?: number };
export type TplArt = { kind: "art"; art: string[]; w: number; x?: number; y: number; color?: string; rot?: number };
export type Template = { key: string; label: string; cat: string; layers: (TplText | TplArt)[] };

// Wilflex ink colors
const BLACK = "#111111", WHITE = "#FFFFFF", RED = "#C8102E", NAVY = "#1B2A4A", ROYAL = "#003DA5", GREEN = "#00843D", GOLD = "#F2A900", MAROON = "#6F263D", PURPLE = "#4B2E83", ORANGE = "#FF5F00", GRAY = "#53565A", AQUA = "#00A3AD", PINK = "#FF3EB5";

const T = (text: string, font: string, size: number, y: number, more: Partial<TplText> = {}): TplText => ({ kind: "text", text, font, size, y, ...more });
const A = (art: string[], w: number, y: number, more: Partial<TplArt> = {}): TplArt => ({ kind: "art", art, w, y, ...more });

// clip art candidates
const I = {
  football: ["game-icons:american-football-ball", "fluent-emoji-high-contrast:american-football", "mdi:football", "fbs:football"],
  helmet: ["game-icons:american-football-helmet", "mdi:football-helmet", "fluent-emoji-high-contrast:american-football", "fbs:football"],
  baseball: ["fluent-emoji-high-contrast:baseball", "mdi:baseball", "game-icons:baseball-ball", "fbs:baseball"],
  bat: ["game-icons:baseball-bat", "mdi:baseball-bat", "fluent-emoji-high-contrast:baseball", "fbs:baseball"],
  softball: ["fluent-emoji-high-contrast:softball", "mdi:baseball", "fbs:baseball"],
  basketball: ["game-icons:basketball-ball", "fluent-emoji-high-contrast:basketball", "mdi:basketball", "fbs:basketball"],
  soccer: ["game-icons:soccer-ball", "fluent-emoji-high-contrast:soccer-ball", "mdi:soccer", "fbs:soccer"],
  volleyball: ["game-icons:volleyball-ball", "fluent-emoji-high-contrast:volleyball", "mdi:volleyball", "fbs:circle"],
  hockey: ["game-icons:hockey", "fluent-emoji-high-contrast:ice-hockey", "mdi:hockey-sticks", "fbs:cross"],
  golf: ["fluent-emoji-high-contrast:flag-in-hole", "mdi:golf", "game-icons:golf-flag", "fbs:arrow"],
  runner: ["fluent-emoji-high-contrast:person-running", "mdi:run-fast", "mdi:run", "game-icons:run", "fbs:bolt"],
  swim: ["fluent-emoji-high-contrast:person-swimming", "mdi:swim", "game-icons:swimming", "fbs:ring"],
  megaphone: ["fluent-emoji-high-contrast:megaphone", "mdi:bullhorn", "game-icons:megaphone", "fbs:star"],
  trophy: ["game-icons:trophy-cup", "fluent-emoji-high-contrast:trophy", "mdi:trophy", "fbs:trophy"],
  medal: ["fluent-emoji-high-contrast:sports-medal", "mdi:medal", "game-icons:medal", "fbs:star"],
  gradcap: ["fluent-emoji-high-contrast:graduation-cap", "mdi:school", "game-icons:graduate-cap", "fbs:star"],
  book: ["fluent-emoji-high-contrast:open-book", "mdi:book-open-variant", "game-icons:open-book", "fbs:square"],
  apple: ["fluent-emoji-high-contrast:red-apple", "mdi:food-apple", "fbs:heart"],
  note: ["fluent-emoji-high-contrast:musical-notes", "mdi:music", "fbs:note"],
  guitar: ["fluent-emoji-high-contrast:guitar", "mdi:guitar-electric", "game-icons:guitar", "fbs:note"],
  masks: ["fluent-emoji-high-contrast:performing-arts", "mdi:drama-masks", "game-icons:drama-masks", "fbs:star"],
  star: ["fbs:star"], heart: ["fbs:heart"], paw: ["fbs:paw"], bolt: ["fbs:bolt"], crown: ["fbs:crown"], shield: ["fbs:shield"], banner: ["fbs:banner"], line: ["fbs:line"], circle: ["fbs:circle"], ring: ["fbs:ring"],
  mountains: ["game-icons:mountains", "fluent-emoji-high-contrast:snow-capped-mountain", "mdi:image-filter-hdr", "fbs:mountains"],
  pine: ["game-icons:pine-tree", "fluent-emoji-high-contrast:evergreen-tree", "mdi:pine-tree", "fbs:tree"],
  sun: ["fbs:sun"], moon: ["fbs:moon"],
  palm: ["fluent-emoji-high-contrast:palm-tree", "mdi:palm-tree", "game-icons:palm-tree", "fbs:tree"],
  beach: ["fluent-emoji-high-contrast:beach-with-umbrella", "mdi:beach", "fbs:sun"],
  tent: ["fluent-emoji-high-contrast:tent", "mdi:tent", "game-icons:camping-tent", "fbs:mountains"],
  campfire: ["game-icons:campfire", "mdi:campfire", "fluent-emoji-high-contrast:fire", "fbs:flame"],
  fire: ["fluent-emoji-high-contrast:fire", "mdi:fire", "fbs:flame"],
  cross: ["fluent-emoji-high-contrast:latin-cross", "mdi:cross", "fbs:cross"],
  dove: ["fluent-emoji-high-contrast:dove", "game-icons:dove", "mdi:bird", "fbs:heart"],
  church: ["fluent-emoji-high-contrast:church", "mdi:church", "fbs:cross"],
  praying: ["fluent-emoji-high-contrast:folded-hands", "mdi:hands-pray", "fbs:heart"],
  xmastree: ["fluent-emoji-high-contrast:christmas-tree", "mdi:pine-tree", "fbs:tree"],
  snowflake: ["fluent-emoji-high-contrast:snowflake", "mdi:snowflake", "game-icons:snowflake-1", "fbs:star"],
  pumpkin: ["fluent-emoji-high-contrast:jack-o-lantern", "game-icons:carved-pumpkin", "mdi:halloween", "fbs:circle"],
  ghost: ["fluent-emoji-high-contrast:ghost", "mdi:ghost", "game-icons:ghost", "fbs:circle"],
  turkey: ["fluent-emoji-high-contrast:turkey", "game-icons:turkey", "fbs:heart"],
  leaf: ["fluent-emoji-high-contrast:maple-leaf", "mdi:leaf-maple", "fbs:tree"],
  flag: ["game-icons:usa-flag", "fluent-emoji-high-contrast:flag-united-states", "mdi:flag", "fbs:star"],
  fireworks: ["fluent-emoji-high-contrast:fireworks", "mdi:firework", "fbs:sun"],
  shamrock: ["fluent-emoji-high-contrast:shamrock", "mdi:clover", "game-icons:clover", "fbs:heart"],
  cake: ["fluent-emoji-high-contrast:birthday-cake", "mdi:cake-variant", "game-icons:cake-slice", "fbs:crown"],
  balloon: ["fluent-emoji-high-contrast:balloon", "mdi:balloon", "fbs:circle"],
  ring2: ["fluent-emoji-high-contrast:ring", "mdi:ring", "game-icons:diamond-ring", "fbs:ring"],
  champagne: ["fluent-emoji-high-contrast:bottle-with-popping-cork", "mdi:glass-cocktail", "fbs:star"],
  wrench: ["fluent-emoji-high-contrast:wrench", "mdi:wrench", "game-icons:spanner", "fbs:cross"],
  hammer: ["fluent-emoji-high-contrast:hammer", "mdi:hammer", "game-icons:hammer-drop", "fbs:cross"],
  tractor: ["fluent-emoji-high-contrast:tractor", "mdi:tractor", "fbs:square"],
  truck: ["fluent-emoji-high-contrast:delivery-truck", "mdi:truck", "fbs:square"],
  coffee: ["fluent-emoji-high-contrast:hot-beverage", "mdi:coffee", "fbs:circle"],
  grill: ["mdi:grill", "game-icons:barbecue", "fluent-emoji-high-contrast:fire", "fbs:flame"],
  firetruck: ["fluent-emoji-high-contrast:fire-engine", "mdi:fire-truck", "fbs:flame"],
  badge: ["mdi:police-badge", "game-icons:police-badge", "fbs:shield"],
  ribbon: ["fluent-emoji-high-contrast:reminder-ribbon", "mdi:ribbon", "game-icons:ribbon", "fbs:heart"],
  anchor: ["fbs:anchor"],
  skull: ["game-icons:skull-crossed-bones", "fluent-emoji-high-contrast:skull", "mdi:skull", "fbs:circle"],
  wolf: ["game-icons:wolf-howl", "game-icons:wolf-head", "fluent-emoji-high-contrast:wolf", "fbs:moon"],
  eagle: ["game-icons:eagle-emblem", "game-icons:eagle-head", "fluent-emoji-high-contrast:eagle", "fbs:shield"],
  bear: ["game-icons:bear-head", "fluent-emoji-high-contrast:bear", "fbs:paw"],
  tiger: ["game-icons:tiger-head", "fluent-emoji-high-contrast:tiger-face", "fbs:paw"],
  laurel: ["game-icons:laurels", "game-icons:laurel-crown", "fbs:ring"],
  plane: ["fluent-emoji-high-contrast:airplane", "mdi:airplane", "fbs:arrow"],
  dumbbell: ["mdi:dumbbell", "game-icons:weight-lifting-up", "fluent-emoji-high-contrast:person-lifting-weights", "fbs:line"],
  bus: ["fluent-emoji-high-contrast:bus", "mdi:bus-school", "fbs:square"],
  rocket: ["fluent-emoji-high-contrast:rocket", "mdi:rocket", "game-icons:rocket", "fbs:arrow"],
  tooth: ["fluent-emoji-high-contrast:tooth", "mdi:tooth", "fbs:heart"],
  stethoscope: ["mdi:stethoscope", "fluent-emoji-high-contrast:stethoscope", "fbs:heart"],
  house: ["fluent-emoji-high-contrast:house", "mdi:home", "fbs:square"],
  puzzle: ["fluent-emoji-high-contrast:puzzle-piece", "mdi:puzzle", "fbs:square"],
  bible: ["mdi:book-cross", "fluent-emoji-high-contrast:open-book", "fbs:cross"],
  fish: ["fluent-emoji-high-contrast:fish", "mdi:fish", "game-icons:fish", "fbs:arrow"],
  deer: ["game-icons:deer-head", "fluent-emoji-high-contrast:deer", "mdi:deer", "fbs:tree"],
};

export const TEMPLATE_CATS = ["School", "Sports", "Teams & mascots", "Events", "Family & parties", "Church & faith", "Holidays", "Business", "Causes", "Service", "Outdoors & travel", "Fun"];

export const TEMPLATES: Template[] = [
  // School
  { key: "class-of", label: "Class of", cat: "School", layers: [T("CLASS OF", "Graduate", 60, 170, { arc: 60, color: NAVY, spacing: 4 }), T("2026", "Anton", 200, 300, { color: RED }), A(I.star, 44, 425, { x: 200, color: NAVY }), A(I.star, 44, 425, { x: 300, color: NAVY }), A(I.star, 44, 425, { x: 400, color: NAVY })] },
  { key: "seniors", label: "Seniors", cat: "School", layers: [A(I.gradcap, 150, 150, { color: BLACK }), T("SENIORS", "Alfa Slab One", 110, 290, { color: MAROON, stroke: GOLD, strokeW: 6 }), T("2026", "Graduate", 90, 395, { color: GOLD, spacing: 10 })] },
  { key: "school-spirit", label: "School spirit", cat: "School", layers: [T("LINCOLN", "Graduate", 110, 190, { arc: 40, color: ROYAL }), T("ELEMENTARY", "Oswald", 46, 270, { weight: 600, spacing: 10, color: GRAY }), A(I.star, 70, 350, { color: GOLD }), T("HOME OF THE EAGLES", "Oswald", 32, 425, { weight: 600, spacing: 4, color: ROYAL })] },
  { key: "teacher", label: "Teacher crew", cat: "School", layers: [A(I.apple, 120, 150, { color: RED }), T("Teacher", "Pacifico", 110, 280, { color: BLACK }), T("SQUAD", "Bebas Neue", 90, 380, { spacing: 16, color: RED })] },
  { key: "band", label: "Band & choir", cat: "School", layers: [A(I.note, 130, 150, { color: BLACK }), T("MARCHING BAND", "Graduate", 60, 280, { arc: 30, color: PURPLE }), T("2026 SEASON", "Oswald", 40, 360, { weight: 600, spacing: 8, color: BLACK })] },
  { key: "drama", label: "Theater", cat: "School", layers: [A(I.masks, 160, 170, { color: BLACK }), T("DRAMA CLUB", "Abril Fatface", 80, 310, { color: RED }), T("BREAK A LEG", "Oswald", 36, 385, { weight: 600, spacing: 10, color: BLACK })] },
  { key: "field-day", label: "Field day", cat: "School", layers: [T("FIELD DAY", "Bungee", 100, 200, { color: ORANGE, stroke: BLACK, strokeW: 5 }), A(I.runner, 130, 320, { color: BLACK }), T("2026", "Anton", 70, 440, { color: BLACK })] },
  // Sports
  { key: "football", label: "Football", cat: "Sports", layers: [T("WILDCATS", "Alfa Slab One", 100, 170, { arc: 45, color: WHITE, stroke: ROYAL, strokeW: 8 }), A(I.football, 170, 310, { color: ROYAL }), T("FOOTBALL", "Graduate", 64, 440, { spacing: 8, color: ROYAL })] },
  { key: "baseball", label: "Baseball", cat: "Sports", layers: [T("Tigers", "Yellowtail", 140, 190, { color: RED, stroke: NAVY, strokeW: 5, rot: -6 }), A(I.baseball, 110, 320, { color: NAVY }), T("BASEBALL · 2026", "Oswald", 40, 420, { weight: 600, spacing: 6, color: NAVY })] },
  { key: "softball", label: "Softball", cat: "Sports", layers: [A(I.softball, 150, 170, { color: GOLD }), T("SOFTBALL", "Graduate", 90, 310, { color: BLACK }), T("PLAY LIKE A GIRL", "Oswald", 40, 390, { weight: 600, spacing: 6, color: PINK })] },
  { key: "basketball", label: "Basketball", cat: "Sports", layers: [A(I.basketball, 180, 180, { color: ORANGE }), T("HOOPS", "Bungee", 120, 340, { color: BLACK }), T("BASKETBALL CAMP 2026", "Oswald", 34, 425, { weight: 600, spacing: 4, color: BLACK })] },
  { key: "soccer", label: "Soccer", cat: "Sports", layers: [T("UNITED", "Russo One", 110, 180, { color: GREEN }), A(I.soccer, 160, 310, { color: BLACK }), T("SOCCER CLUB", "Oswald", 44, 430, { weight: 600, spacing: 10, color: GREEN })] },
  { key: "volleyball", label: "Volleyball", cat: "Sports", layers: [A(I.volleyball, 150, 170, { color: PURPLE }), T("VOLLEYBALL", "Teko", 110, 310, { weight: 600, color: BLACK }), T("DIG · SET · SPIKE", "Oswald", 40, 390, { weight: 600, spacing: 6, color: PURPLE })] },
  { key: "track", label: "Track & XC", cat: "Sports", layers: [T("CROSS COUNTRY", "Graduate", 56, 160, { arc: 35, color: GREEN }), A(I.runner, 150, 280, { color: BLACK }), T("OUR SPORT IS YOUR SPORT'S PUNISHMENT", "Oswald", 22, 400, { weight: 600, spacing: 2, color: BLACK })] },
  { key: "cheer", label: "Cheer", cat: "Sports", layers: [A(I.megaphone, 130, 160, { color: RED, rot: -15 }), T("Cheer", "Pacifico", 140, 300, { color: RED }), T("SQUAD 2026", "Oswald", 44, 400, { weight: 600, spacing: 10, color: BLACK })] },
  { key: "hockey", label: "Hockey", cat: "Sports", layers: [T("ICE DOGS", "Black Ops One", 110, 180, { color: NAVY }), A(I.hockey, 160, 310, { color: NAVY }), T("HOCKEY CLUB", "Oswald", 44, 430, { weight: 600, spacing: 10, color: RED })] },
  { key: "golf", label: "Golf outing", cat: "Sports", layers: [A(I.golf, 130, 160, { color: GREEN }), T("ANNUAL GOLF", "Playfair Display", 70, 290, { weight: 700, color: GREEN }), T("CLASSIC", "Oswald", 50, 360, { weight: 600, spacing: 20, color: BLACK }), T("2026", "Oswald", 32, 420, { spacing: 8, color: GRAY })] },
  { key: "fitness", label: "Gym & fitness", cat: "Sports", layers: [A(I.dumbbell, 150, 160, { color: BLACK }), T("NO PAIN", "Anton", 110, 290, { color: BLACK }), T("NO GAIN", "Anton", 110, 400, { color: RED })] },
  // Teams & mascots
  { key: "mascot-eagles", label: "Eagles", cat: "Teams & mascots", layers: [A(I.eagle, 220, 210, { color: NAVY }), T("EAGLES", "Graduate", 110, 400, { color: GOLD, stroke: NAVY, strokeW: 7 })] },
  { key: "mascot-wolves", label: "Wolves", cat: "Teams & mascots", layers: [A(I.moon, 180, 180, { color: GOLD }), A(I.wolf, 200, 220, { color: BLACK }), T("WOLF PACK", "Black Ops One", 90, 400, { color: BLACK })] },
  { key: "mascot-bears", label: "Bears", cat: "Teams & mascots", layers: [T("BEARS", "Alfa Slab One", 110, 160, { arc: 40, color: GREEN }), A(I.bear, 200, 310, { color: BLACK }), T("EST. 1998", "Oswald", 36, 440, { weight: 600, spacing: 10, color: GREEN })] },
  { key: "mascot-tigers", label: "Tigers", cat: "Teams & mascots", layers: [A(I.tiger, 210, 200, { color: ORANGE }), T("TIGERS", "Russo One", 110, 380, { color: BLACK, stroke: ORANGE, strokeW: 5 })] },
  { key: "jersey", label: "Jersey number", cat: "Teams & mascots", layers: [T("SMITH", "Graduate", 80, 150, { arc: 25, color: WHITE, stroke: RED, strokeW: 6 }), T("23", "Graduate", 300, 350, { color: RED, stroke: WHITE, strokeW: 8 })] },
  { key: "team-shield", label: "Team crest", cat: "Teams & mascots", layers: [A(I.shield, 300, 280, { color: NAVY }), T("TEAM", "Graduate", 60, 230, { color: WHITE }), T("NAME", "Graduate", 90, 310, { color: GOLD })] },
  // Events
  { key: "5k", label: "Fun run", cat: "Events", layers: [T("ANNUAL", "Oswald", 40, 130, { spacing: 10, color: ROYAL }), T("5K FUN RUN", "Anton", 110, 215, { color: BLACK }), A(I.line, 380, 290, { color: ROYAL }), T("SATURDAY · MAY 2, 2026", "Oswald", 30, 330, { spacing: 3, color: BLACK })] },
  { key: "charity-walk", label: "Charity walk", cat: "Events", layers: [A(I.ribbon, 130, 160, { color: PINK }), T("WALK FOR", "Oswald", 50, 280, { weight: 600, spacing: 8, color: BLACK }), T("THE CURE", "Anton", 120, 370, { color: PINK })] },
  { key: "staff-event", label: "Event staff", cat: "Events", layers: [T("EVENT", "Bebas Neue", 150, 230, { color: BLACK }), T("STAFF", "Bebas Neue", 150, 360, { color: RED })] },
  { key: "camp", label: "Summer camp", cat: "Events", layers: [A(I.mountains, 240, 170, { color: GREEN }), T("CAMP WILLOW", "Rye", 70, 300, { color: GREEN }), T("SUMMER 2026", "Oswald", 36, 370, { weight: 600, spacing: 10, color: BLACK })] },
  { key: "concert", label: "Tour / concert", cat: "Events", layers: [A(I.guitar, 170, 170, { color: BLACK, rot: 20 }), T("ROCK THE BLOCK", "Permanent Marker", 70, 320, { color: RED }), T("JULY 12 · CITY PARK", "Oswald", 32, 390, { weight: 600, spacing: 6, color: BLACK })] },
  // Family & parties
  { key: "reunion", label: "Family reunion", cat: "Family & parties", layers: [T("The Johnson Family", "Pacifico", 56, 160, { arc: 40, color: MAROON }), A(I.heart, 110, 275, { color: RED }), T("REUNION 2026", "Bebas Neue", 96, 395, { spacing: 4, color: BLACK })] },
  { key: "birthday", label: "Birthday", cat: "Family & parties", layers: [A(I.cake, 150, 160, { color: PINK }), T("Birthday", "Pacifico", 110, 290, { color: BLACK }), T("SQUAD", "Bebas Neue", 110, 390, { spacing: 16, color: PINK })] },
  { key: "bachelorette", label: "Bachelorette", cat: "Family & parties", layers: [A(I.ring2, 120, 150, { color: BLACK }), T("Bride Squad", "Great Vibes", 120, 290, { color: PINK }), T("NASHVILLE 2026", "Oswald", 40, 390, { weight: 600, spacing: 10, color: BLACK })] },
  { key: "vacation", label: "Family vacation", cat: "Family & parties", layers: [A(I.palm, 160, 180, { color: GREEN }), T("SMITH FAMILY", "Oswald", 50, 320, { weight: 600, spacing: 8, color: BLACK }), T("Vacation", "Lobster", 110, 400, { color: AQUA })] },
  // Church & faith
  { key: "faith-cross", label: "Faith", cat: "Church & faith", layers: [A(I.cross, 150, 180, { color: BLACK }), T("FAITH OVER FEAR", "Oswald", 60, 330, { weight: 600, spacing: 6, color: BLACK }), T("Isaiah 41:10", "Dancing Script", 50, 400, { weight: 700, color: GRAY })] },
  { key: "vbs", label: "VBS / youth group", cat: "Church & faith", layers: [T("VBS", "Bungee", 170, 220, { color: ORANGE, stroke: BLACK, strokeW: 6 }), A(I.sun, 120, 350, { color: GOLD }), T("FIRST BAPTIST 2026", "Oswald", 36, 450, { weight: 600, spacing: 6, color: BLACK })] },
  { key: "mission", label: "Mission trip", cat: "Church & faith", layers: [A(I.plane, 140, 150, { color: BLACK, rot: -20 }), T("MISSION TRIP", "Graduate", 70, 280, { color: NAVY }), T("Go and make disciples", "Dancing Script", 50, 360, { weight: 700, color: BLACK })] },
  // Holidays
  { key: "christmas", label: "Christmas", cat: "Holidays", layers: [A(I.xmastree, 170, 190, { color: GREEN }), T("Merry Christmas", "Great Vibes", 100, 350, { color: RED }), T("SMITH FAMILY 2026", "Oswald", 32, 420, { weight: 600, spacing: 8, color: GREEN })] },
  { key: "halloween", label: "Halloween", cat: "Holidays", layers: [A(I.pumpkin, 170, 190, { color: ORANGE }), T("SPOOKY", "Creepster", 110, 350, { color: BLACK }), T("SEASON", "Creepster", 70, 430, { color: ORANGE })] },
  { key: "july4", label: "4th of July", cat: "Holidays", layers: [A(I.fireworks, 150, 150, { color: RED }), T("LAND OF THE FREE", "Graduate", 60, 280, { color: NAVY }), T("because of the brave", "Dancing Script", 60, 350, { weight: 700, color: RED }), A(I.star, 40, 420, { x: 250, color: NAVY }), A(I.star, 40, 420, { x: 300, color: NAVY }), A(I.star, 40, 420, { x: 350, color: NAVY })] },
  { key: "thanksgiving", label: "Thanksgiving", cat: "Holidays", layers: [A(I.leaf, 130, 160, { color: ORANGE }), T("Thankful", "Pacifico", 110, 290, { color: MAROON }), T("GRATEFUL · BLESSED", "Oswald", 36, 380, { weight: 600, spacing: 8, color: BLACK })] },
  { key: "stpatricks", label: "St. Patrick's", cat: "Holidays", layers: [A(I.shamrock, 150, 170, { color: GREEN }), T("LUCKY", "Alfa Slab One", 120, 320, { color: GREEN }), T("CREW", "Oswald", 50, 400, { weight: 600, spacing: 20, color: BLACK })] },
  // Business
  { key: "business", label: "Business", cat: "Business", layers: [T("YOUR BUSINESS", "Archivo Black", 70, 200, { color: BLACK }), A(I.line, 400, 250, { color: RED }), T("EST. 2026", "Oswald", 36, 292, { spacing: 10, color: BLACK })] },
  { key: "construction", label: "Construction", cat: "Business", layers: [A(I.hammer, 130, 160, { color: BLACK, rot: -20 }), T("SMITH", "Black Ops One", 110, 290, { color: ORANGE }), T("CONSTRUCTION", "Oswald", 50, 370, { weight: 600, spacing: 8, color: BLACK }), T("LICENSED & INSURED", "Oswald", 26, 420, { spacing: 6, color: GRAY })] },
  { key: "auto", label: "Auto shop", cat: "Business", layers: [A(I.wrench, 140, 170, { color: RED, rot: 45 }), T("JOE'S GARAGE", "Russo One", 80, 310, { color: BLACK }), T("AUTO REPAIR · SINCE 1985", "Oswald", 30, 380, { weight: 600, spacing: 4, color: RED })] },
  { key: "farm", label: "Farm", cat: "Business", layers: [A(I.tractor, 180, 180, { color: GREEN }), T("OAK HILL FARM", "Rye", 64, 320, { color: BLACK }), T("FARM FRESH · EST. 1952", "Oswald", 30, 385, { weight: 600, spacing: 4, color: GREEN })] },
  { key: "coffee", label: "Coffee shop", cat: "Business", layers: [A(I.coffee, 140, 160, { color: BLACK }), T("Daily Grind", "Lobster", 100, 290, { color: MAROON }), T("COFFEE CO.", "Oswald", 40, 370, { weight: 600, spacing: 12, color: BLACK })] },
  { key: "bbq", label: "BBQ", cat: "Business", layers: [A(I.grill, 150, 170, { color: BLACK }), T("SMOKE & SAUCE", "Alfa Slab One", 70, 310, { color: RED }), T("BBQ CATERING", "Oswald", 40, 380, { weight: 600, spacing: 10, color: BLACK })] },
  { key: "medical", label: "Medical team", cat: "Business", layers: [A(I.stethoscope, 140, 160, { color: AQUA }), T("NURSE", "Anton", 120, 300, { color: BLACK }), T("LIFE", "Oswald", 50, 380, { weight: 600, spacing: 20, color: AQUA })] },
  // Causes
  { key: "awareness", label: "Awareness", cat: "Causes", layers: [A(I.ribbon, 150, 170, { color: PINK }), T("FIGHT LIKE A GIRL", "Oswald", 60, 310, { weight: 600, spacing: 4, color: BLACK }), T("Team Sarah", "Pacifico", 70, 390, { color: PINK })] },
  { key: "autism", label: "Autism awareness", cat: "Causes", layers: [A(I.puzzle, 150, 170, { color: ROYAL }), T("ACCEPT · UNDERSTAND · LOVE", "Oswald", 36, 310, { weight: 600, spacing: 3, color: BLACK })] },
  { key: "rescue", label: "Animal rescue", cat: "Causes", layers: [A(I.paw, 130, 160, { color: BLACK }), T("Adopt", "Pacifico", 110, 290, { color: RED }), T("DON'T SHOP", "Bebas Neue", 90, 380, { spacing: 8, color: BLACK })] },
  // Service
  { key: "fire-dept", label: "Fire department", cat: "Service", layers: [A(I.fire, 150, 170, { color: RED }), T("FIRE DEPT", "Graduate", 90, 320, { color: BLACK }), T("STATION 7", "Oswald", 50, 400, { weight: 600, spacing: 12, color: RED })] },
  { key: "police", label: "Police", cat: "Service", layers: [A(I.badge, 150, 170, { color: NAVY }), T("POLICE", "Black Ops One", 110, 320, { color: NAVY }), T("SERVE · PROTECT", "Oswald", 40, 400, { weight: 600, spacing: 8, color: BLACK })] },
  { key: "military", label: "Military family", cat: "Service", layers: [A(I.flag, 180, 170, { color: NAVY }), T("PROUD ARMY MOM", "Graduate", 64, 320, { color: BLACK }), A(I.star, 50, 400, { color: RED })] },
  { key: "navy", label: "Navy & anchors", cat: "Service", layers: [A(I.anchor, 160, 180, { color: NAVY }), T("SEMPER FORTIS", "Graduate", 64, 330, { color: NAVY })] },
  // Outdoors & travel
  { key: "adventure", label: "Adventure", cat: "Outdoors & travel", layers: [A(I.ring, 330, 250, { color: BLACK }), A(I.mountains, 190, 250, { color: BLACK }), T("ADVENTURE AWAITS", "Oswald", 44, 450, { weight: 600, spacing: 6, color: BLACK })] },
  { key: "camping", label: "Camping", cat: "Outdoors & travel", layers: [A(I.tent, 170, 180, { color: GREEN }), T("Happy Camper", "Kaushan Script", 90, 320, { color: BLACK })] },
  { key: "beach", label: "Beach trip", cat: "Outdoors & travel", layers: [A(I.sun, 200, 190, { color: ORANGE }), A(I.palm, 150, 210, { color: BLACK }), T("GULF SHORES", "Graduate", 70, 370, { color: AQUA }), T("2026", "Oswald", 40, 430, { weight: 600, spacing: 16, color: BLACK })] },
  { key: "fishing", label: "Fishing", cat: "Outdoors & travel", layers: [A(I.fish, 200, 190, { color: GREEN }), T("REEL COOL DAD", "Alfa Slab One", 64, 330, { color: BLACK })] },
  { key: "hunting", label: "Hunting", cat: "Outdoors & travel", layers: [A(I.deer, 200, 190, { color: BLACK }), T("BUCK WILD", "Black Ops One", 90, 360, { color: ORANGE })] },
  // Fun
  { key: "squad", label: "Squad", cat: "Fun", layers: [T("SQUAD", "Bungee Shade", 140, 260, { color: BLACK }), A(I.fire, 80, 370, { color: ORANGE })] },
  { key: "skull", label: "Skull", cat: "Fun", layers: [A(I.skull, 220, 220, { color: BLACK }), T("RIDE OR DIE", "UnifrakturMaguntia", 80, 410, { color: BLACK })] },
  { key: "space", label: "Space", cat: "Fun", layers: [A(I.rocket, 170, 190, { color: BLACK, rot: 30 }), T("TO THE MOON", "Orbitron", 64, 340, { weight: 700, color: PURPLE })] },
];
