import { closestThread, threads, type Thread } from "@/lib/embroidery";

/**
 * Isacord to Madeira (Nov 20 2026, Nick: "convert Isacord thread to Madeira"; Buckets of Ink's Isacord-to-other color
 * equivalents chart). We run Madeira Polyneon, and digitizers often send worksheets on Isacord (A Banner Co's westwood:
 * Isacord 0015 White, 0020 Black). The chart gives Madeira's Classic Rayon equivalent for each Isacord code; the Polyneon
 * we run is the one nearest that Rayon's color. A code the chart doesn't list (or a color with no code, "Sky Blue"): the
 * Polyneon nearest the Isacord's own color, else the color its name says.
 */
export const ISACORD_TO_MADEIRA_RAYON: Record<string, string> = {"0010":"1001","0015":"1071","0017":"1001","0020":"1000","0101":"1071","0108":"1118","0111":"1241","0112":"1041","0124":"1087","0131":"1118","0132":"1041","0142":"1118","0145":"1087","0150":"1087","0151":"1062","0152":"1118","0180":"1087","0182":"1087","0184":"1060","0221":"1223","0232":"1106","0250":"1067","0270":"1067","0310":"1223","0311":"1024","0345":"1157","0352":"1106","0442":"1190","0453":"1306","0463":"1306","0465":"1357","0506":"1024","0520":"1023","0532":"1070","0542":"1192","0546":"1192","0552":"1055","0600":"1223","0605":"1372","0608":"1223","0630":"1023","0640":"1372","0651":"1055","0660":"1067","0670":"1071","0672":"1060","0700":"1024","0702":"1024","0704":"1025","0713":"1372","0722":"1128","0747":"1157","0761":"1055","0776":"1062","0800":"1137","0811":"1372","0821":"1025","0822":"1070","0824":"1173","0832":"1126","0842":"1126","0851":"1055","0853":"1144","0861":"1060","0862":"1128","0870":"1082","0873":"1062","0874":"1062","0904":"1137","0922":"1173","0931":"1173","0932":"1773","0933":"1173","0934":"1173","0940":"1128","0941":"1173","0945":"1144","0970":"1067","1055":"1053","1060":"1145","1061":"1142","1102":"1278","1114":"1065","1115":"1057","1123":"1128","1134":"1057","1140":"1055","1141":"1142","1154":"1057","1172":"1055","1220":"1379","1300":"1278","1301":"1037","1304":"1078","1305":"1379","1311":"1221","1312":"1221","1332":"1379","1334":"1221","1335":"1221","1342":"1057","1346":"1145","1351":"1019","1352":"1019","1355":"1145","1362":"1019","1366":"1059","1375":"1041","1430":"1019","1514":"1221","1521":"1379","1532":"1107","1551":"1019","1565":"1144","1600":"1379","1701":"1078","1703":"1037","1704":"1037","1725":"1221","1755":"1019","1760":"1142","1761":"1142","1800":"1037","1805":"1147","1840":"1107","1860":"1019","1874":"1062","1876":"1145","1900":"1147","1902":"1147","1903":"1147","1904":"1039","1906":"1186","1911":"1181","1912":"1181","1913":"1181","1921":"1119","1972":"1118","2011":"1181","2022":"1181","2051":"1019","2101":"1147","2113":"1181","2115":"1181","2123":"1035","2152":"1108","2153":"1108","2155":"1108","2160":"1116","2166":"1019","2170":"1053","2171":"1120","2220":"1309","2222":"1117","2224":"1181","2241":"1119","2250":"1120","2300":"1110","2320":"1119","2333":"1035"};

const pad = (c: string) => (c || "").replace(/\D/g, "").padStart(4, "0");

/** the Madeira Polyneon thread for an Isacord code (or name), with the chart's Rayon code when it had one */
export function madeiraForIsacord(code: string, name = "", guess?: (n: string) => string): { thread: Thread | null; rayon: string; how: "chart" | "color" } {
  const all = threads();
  const rc = code ? ISACORD_TO_MADEIRA_RAYON[pad(code)] : undefined;
  const rayon = rc ? all.find((t) => t.line === "Classic Rayon 40" && t.code === rc) : undefined;
  if (rayon?.hex) return { thread: closestThread(rayon.hex, { line: "Polyneon 40" }), rayon: rc!, how: "chart" };
  const isa = code ? all.find((t) => t.line === "Isacord 40" && t.code === pad(code)) : name ? all.find((t) => t.line === "Isacord 40" && t.name.toLowerCase() === name.toLowerCase()) : undefined;
  const hex = isa?.hex || (guess && name ? guess(name) : "");
  return { thread: hex && hex !== "#9aa1ab" ? closestThread(hex, { line: "Polyneon 40" }) : null, rayon: rc || "", how: "color" };
}
