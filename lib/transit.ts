/**
 * The transit map: every state as a tile on a grid shaped like the US (col, row), and the main city we price to.
 * Transit is from our ZIP to that city; a ZIP lookup in the rate calculator gives the exact answer for any address.
 */
export type StateTile = { st: string; name: string; col: number; row: number; zip: string; city: string };

export const STATES: StateTile[] = [
  { st: "AK", name: "Alaska", col: 0, row: 0, zip: "99501", city: "Anchorage" },
  { st: "ME", name: "Maine", col: 10, row: 0, zip: "04101", city: "Portland" },
  { st: "WI", name: "Wisconsin", col: 5, row: 1, zip: "53202", city: "Milwaukee" },
  { st: "VT", name: "Vermont", col: 9, row: 1, zip: "05401", city: "Burlington" },
  { st: "NH", name: "New Hampshire", col: 10, row: 1, zip: "03301", city: "Concord" },
  { st: "WA", name: "Washington", col: 0, row: 2, zip: "98101", city: "Seattle" },
  { st: "ID", name: "Idaho", col: 1, row: 2, zip: "83702", city: "Boise" },
  { st: "MT", name: "Montana", col: 2, row: 2, zip: "59601", city: "Helena" },
  { st: "ND", name: "North Dakota", col: 3, row: 2, zip: "58501", city: "Bismarck" },
  { st: "MN", name: "Minnesota", col: 4, row: 2, zip: "55401", city: "Minneapolis" },
  { st: "IL", name: "Illinois", col: 5, row: 2, zip: "60601", city: "Chicago" },
  { st: "MI", name: "Michigan", col: 6, row: 2, zip: "48226", city: "Detroit" },
  { st: "NY", name: "New York", col: 8, row: 2, zip: "10001", city: "New York" },
  { st: "MA", name: "Massachusetts", col: 9, row: 2, zip: "02108", city: "Boston" },
  { st: "OR", name: "Oregon", col: 0, row: 3, zip: "97204", city: "Portland" },
  { st: "NV", name: "Nevada", col: 1, row: 3, zip: "89101", city: "Las Vegas" },
  { st: "WY", name: "Wyoming", col: 2, row: 3, zip: "82001", city: "Cheyenne" },
  { st: "SD", name: "South Dakota", col: 3, row: 3, zip: "57104", city: "Sioux Falls" },
  { st: "IA", name: "Iowa", col: 4, row: 3, zip: "50309", city: "Des Moines" },
  { st: "IN", name: "Indiana", col: 5, row: 3, zip: "46204", city: "Indianapolis" },
  { st: "OH", name: "Ohio", col: 6, row: 3, zip: "43215", city: "Columbus" },
  { st: "PA", name: "Pennsylvania", col: 7, row: 3, zip: "19103", city: "Philadelphia" },
  { st: "NJ", name: "New Jersey", col: 8, row: 3, zip: "07102", city: "Newark" },
  { st: "CT", name: "Connecticut", col: 9, row: 3, zip: "06103", city: "Hartford" },
  { st: "RI", name: "Rhode Island", col: 10, row: 3, zip: "02903", city: "Providence" },
  { st: "CA", name: "California", col: 0, row: 4, zip: "90012", city: "Los Angeles" },
  { st: "UT", name: "Utah", col: 1, row: 4, zip: "84101", city: "Salt Lake City" },
  { st: "CO", name: "Colorado", col: 2, row: 4, zip: "80202", city: "Denver" },
  { st: "NE", name: "Nebraska", col: 3, row: 4, zip: "68102", city: "Omaha" },
  { st: "MO", name: "Missouri", col: 4, row: 4, zip: "64105", city: "Kansas City" },
  { st: "KY", name: "Kentucky", col: 5, row: 4, zip: "40202", city: "Louisville" },
  { st: "WV", name: "West Virginia", col: 6, row: 4, zip: "25301", city: "Charleston" },
  { st: "VA", name: "Virginia", col: 7, row: 4, zip: "23219", city: "Richmond" },
  { st: "MD", name: "Maryland", col: 8, row: 4, zip: "21202", city: "Baltimore" },
  { st: "DE", name: "Delaware", col: 9, row: 4, zip: "19801", city: "Wilmington" },
  { st: "AZ", name: "Arizona", col: 1, row: 5, zip: "85004", city: "Phoenix" },
  { st: "NM", name: "New Mexico", col: 2, row: 5, zip: "87102", city: "Albuquerque" },
  { st: "KS", name: "Kansas", col: 3, row: 5, zip: "67202", city: "Wichita" },
  { st: "AR", name: "Arkansas", col: 4, row: 5, zip: "72201", city: "Little Rock" },
  { st: "TN", name: "Tennessee", col: 5, row: 5, zip: "37203", city: "Nashville" },
  { st: "NC", name: "North Carolina", col: 6, row: 5, zip: "28202", city: "Charlotte" },
  { st: "SC", name: "South Carolina", col: 7, row: 5, zip: "29201", city: "Columbia" },
  { st: "DC", name: "Washington, DC", col: 8, row: 5, zip: "20001", city: "Washington" },
  { st: "OK", name: "Oklahoma", col: 3, row: 6, zip: "73102", city: "Oklahoma City" },
  { st: "LA", name: "Louisiana", col: 4, row: 6, zip: "70112", city: "New Orleans" },
  { st: "MS", name: "Mississippi", col: 5, row: 6, zip: "39201", city: "Jackson" },
  { st: "AL", name: "Alabama", col: 6, row: 6, zip: "35203", city: "Birmingham" },
  { st: "GA", name: "Georgia", col: 7, row: 6, zip: "30303", city: "Atlanta" },
  { st: "HI", name: "Hawaii", col: 0, row: 7, zip: "96813", city: "Honolulu" },
  { st: "TX", name: "Texas", col: 3, row: 7, zip: "78701", city: "Austin" },
  { st: "FL", name: "Florida", col: 8, row: 7, zip: "32801", city: "Orlando" },
];

export type TransitRow = { state: string; zip: string; city: string; carrier: string; service: string; days: number | null; cost: number | null; delivery_date: string | null; from_zip: string; updated_at: string };

/** Friendly service names ("FEDEX_2_DAY" → "2Day", "NextDayAir" → "Next Day Air"). */
export function serviceName(carrier: string, service: string) {
  const s = service.replace(/^FEDEX_/i, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/(\d)([A-Z])/g, "$1 $2").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return s.replace(/\bUps\b/, "UPS").replace(/2nd Day/, "2nd Day").trim();
}
/** Ground first, then slower to faster. */
export function serviceRank(service: string) {
  const s = service.toLowerCase();
  if (/ground/.test(s) && !/home/.test(s)) return 0;
  if (/home/.test(s)) return 1;
  if (/3|select|saver/.test(s)) return 2;
  if (/2/.test(s)) return 3;
  if (/overnight|next|1/.test(s)) return 4;
  return 5;
}
