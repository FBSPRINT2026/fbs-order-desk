/**
 * BJCP 2021 beer styles (and the 2015 mead and cider guides) with their vital statistics: OG, FG, IBU, SRM and ABV
 * ranges. Seeded into dp_styles (migration 338) so recipes can point at one; the app reads this list directly.
 */
export type Style = { id: string; name: string; cat: string; og: [number, number]; fg: [number, number]; ibu: [number, number]; srm: [number, number]; abv: [number, number]; guide?: string };

// id, name, category, OG lo/hi, FG lo/hi, IBU lo/hi, SRM lo/hi, ABV lo/hi
type Row = [string, string, string, number, number, number, number, number, number, number, number, number, number];
const ROWS: Row[] = [
  ["1A", "American Light Lager", "Standard American Beer", 1.028, 1.040, 0.998, 1.008, 8, 12, 2, 3, 2.8, 4.2],
  ["1B", "American Lager", "Standard American Beer", 1.040, 1.050, 1.004, 1.010, 8, 18, 2, 3.5, 4.2, 5.3],
  ["1C", "Cream Ale", "Standard American Beer", 1.042, 1.055, 1.006, 1.012, 8, 20, 2, 5, 4.2, 5.6],
  ["1D", "American Wheat Beer", "Standard American Beer", 1.040, 1.055, 1.008, 1.013, 15, 30, 3, 6, 4.0, 5.5],
  ["2A", "International Pale Lager", "International Lager", 1.042, 1.050, 1.008, 1.012, 18, 25, 2, 6, 4.6, 6.0],
  ["2B", "International Amber Lager", "International Lager", 1.042, 1.055, 1.008, 1.014, 8, 25, 7, 14, 4.6, 6.0],
  ["2C", "International Dark Lager", "International Lager", 1.044, 1.056, 1.008, 1.012, 8, 20, 14, 30, 4.2, 6.0],
  ["3A", "Czech Pale Lager", "Czech Lager", 1.028, 1.044, 1.008, 1.014, 20, 35, 3, 6, 3.0, 4.1],
  ["3B", "Czech Premium Pale Lager", "Czech Lager", 1.044, 1.060, 1.013, 1.017, 30, 45, 3.5, 6, 4.2, 5.8],
  ["3C", "Czech Amber Lager", "Czech Lager", 1.044, 1.060, 1.013, 1.017, 20, 35, 10, 16, 4.4, 5.8],
  ["3D", "Czech Dark Lager", "Czech Lager", 1.044, 1.060, 1.013, 1.017, 18, 34, 17, 35, 4.4, 5.8],
  ["4A", "Munich Helles", "Pale Malty European Lager", 1.044, 1.048, 1.006, 1.012, 16, 22, 3, 5, 4.7, 5.4],
  ["4B", "Festbier", "Pale Malty European Lager", 1.054, 1.057, 1.010, 1.012, 18, 25, 4, 6, 5.8, 6.3],
  ["4C", "Helles Bock", "Pale Malty European Lager", 1.064, 1.072, 1.011, 1.018, 23, 35, 6, 9, 6.3, 7.4],
  ["5A", "German Leichtbier", "Pale Bitter European Beer", 1.026, 1.034, 1.006, 1.010, 15, 28, 1.5, 4, 2.4, 3.6],
  ["5B", "Kölsch", "Pale Bitter European Beer", 1.044, 1.050, 1.007, 1.011, 18, 30, 3.5, 5, 4.4, 5.2],
  ["5C", "German Helles Exportbier", "Pale Bitter European Beer", 1.050, 1.058, 1.008, 1.015, 20, 30, 4, 6, 5.0, 6.0],
  ["5D", "German Pils", "Pale Bitter European Beer", 1.044, 1.050, 1.008, 1.013, 22, 40, 2, 4, 4.4, 5.2],
  ["6A", "Märzen", "Amber Malty European Lager", 1.054, 1.060, 1.010, 1.014, 18, 24, 8, 17, 5.6, 6.3],
  ["6B", "Rauchbier", "Amber Malty European Lager", 1.050, 1.057, 1.012, 1.016, 20, 30, 12, 22, 4.8, 6.0],
  ["6C", "Dunkles Bock", "Amber Malty European Lager", 1.064, 1.072, 1.013, 1.019, 20, 27, 14, 22, 6.3, 7.2],
  ["7A", "Vienna Lager", "Amber Bitter European Beer", 1.048, 1.055, 1.010, 1.014, 18, 30, 9, 15, 4.7, 5.5],
  ["7B", "Altbier", "Amber Bitter European Beer", 1.044, 1.052, 1.008, 1.014, 25, 50, 9, 17, 4.3, 5.5],
  ["8A", "Munich Dunkel", "Dark European Lager", 1.048, 1.056, 1.010, 1.016, 18, 28, 17, 28, 4.5, 5.6],
  ["8B", "Schwarzbier", "Dark European Lager", 1.046, 1.052, 1.010, 1.016, 20, 35, 19, 30, 4.4, 5.4],
  ["9A", "Doppelbock", "Strong European Beer", 1.072, 1.112, 1.016, 1.024, 16, 26, 6, 25, 7.0, 10.0],
  ["9B", "Eisbock", "Strong European Beer", 1.078, 1.120, 1.020, 1.035, 25, 35, 17, 30, 9.0, 14.0],
  ["9C", "Baltic Porter", "Strong European Beer", 1.060, 1.090, 1.016, 1.024, 20, 40, 17, 30, 6.5, 9.5],
  ["10A", "Weissbier", "German Wheat Beer", 1.044, 1.053, 1.008, 1.014, 8, 15, 2, 6, 4.3, 5.6],
  ["10B", "Dunkles Weissbier", "German Wheat Beer", 1.044, 1.057, 1.008, 1.014, 10, 18, 14, 23, 4.3, 5.6],
  ["10C", "Weizenbock", "German Wheat Beer", 1.064, 1.090, 1.015, 1.022, 15, 30, 6, 25, 6.5, 9.0],
  ["11A", "Ordinary Bitter", "British Bitter", 1.030, 1.039, 1.007, 1.011, 25, 35, 8, 14, 3.2, 3.8],
  ["11B", "Best Bitter", "British Bitter", 1.040, 1.048, 1.008, 1.012, 25, 40, 8, 16, 3.8, 4.6],
  ["11C", "Strong Bitter", "British Bitter", 1.048, 1.060, 1.010, 1.016, 30, 50, 8, 18, 4.6, 6.2],
  ["12A", "British Golden Ale", "Pale Commonwealth Beer", 1.038, 1.053, 1.006, 1.012, 20, 45, 2, 5, 3.8, 5.0],
  ["12B", "Australian Sparkling Ale", "Pale Commonwealth Beer", 1.038, 1.050, 1.004, 1.006, 20, 35, 4, 7, 4.5, 6.0],
  ["12C", "English IPA", "Pale Commonwealth Beer", 1.050, 1.070, 1.010, 1.015, 40, 60, 6, 14, 5.0, 7.5],
  ["13A", "Dark Mild", "Brown British Beer", 1.030, 1.038, 1.008, 1.013, 10, 25, 14, 25, 3.0, 3.8],
  ["13B", "British Brown Ale", "Brown British Beer", 1.040, 1.052, 1.008, 1.013, 20, 30, 12, 22, 4.2, 5.4],
  ["13C", "English Porter", "Brown British Beer", 1.040, 1.052, 1.008, 1.014, 18, 35, 20, 30, 4.0, 5.4],
  ["14A", "Scottish Light", "Scottish Ale", 1.030, 1.035, 1.010, 1.013, 10, 20, 17, 25, 2.5, 3.3],
  ["14B", "Scottish Heavy", "Scottish Ale", 1.035, 1.040, 1.010, 1.015, 10, 20, 12, 20, 3.3, 3.9],
  ["14C", "Scottish Export", "Scottish Ale", 1.040, 1.060, 1.010, 1.016, 15, 30, 12, 20, 3.9, 6.0],
  ["15A", "Irish Red Ale", "Irish Beer", 1.036, 1.046, 1.010, 1.014, 18, 28, 9, 14, 3.8, 5.0],
  ["15B", "Irish Stout", "Irish Beer", 1.036, 1.044, 1.007, 1.011, 25, 45, 25, 40, 3.8, 5.0],
  ["15C", "Irish Extra Stout", "Irish Beer", 1.052, 1.062, 1.010, 1.014, 35, 50, 30, 40, 5.5, 6.5],
  ["16A", "Sweet Stout", "Dark British Beer", 1.044, 1.060, 1.012, 1.024, 20, 40, 30, 40, 4.0, 6.0],
  ["16B", "Oatmeal Stout", "Dark British Beer", 1.045, 1.065, 1.010, 1.018, 25, 40, 22, 40, 4.2, 5.9],
  ["16C", "Tropical Stout", "Dark British Beer", 1.056, 1.075, 1.010, 1.018, 30, 50, 30, 40, 5.5, 8.0],
  ["16D", "Foreign Extra Stout", "Dark British Beer", 1.056, 1.075, 1.010, 1.018, 50, 70, 30, 40, 6.3, 8.0],
  ["17A", "British Strong Ale", "Strong British Ale", 1.055, 1.080, 1.015, 1.022, 30, 60, 8, 22, 5.5, 8.0],
  ["17B", "Old Ale", "Strong British Ale", 1.055, 1.088, 1.015, 1.022, 30, 60, 10, 22, 5.5, 9.0],
  ["17C", "Wee Heavy", "Strong British Ale", 1.070, 1.130, 1.018, 1.040, 17, 35, 14, 25, 6.5, 10.0],
  ["17D", "English Barley Wine", "Strong British Ale", 1.080, 1.120, 1.018, 1.030, 35, 70, 8, 22, 8.0, 12.0],
  ["18A", "Blonde Ale", "Pale American Ale", 1.038, 1.054, 1.008, 1.013, 15, 28, 3, 6, 3.8, 5.5],
  ["18B", "American Pale Ale", "Pale American Ale", 1.045, 1.060, 1.010, 1.015, 30, 50, 5, 10, 4.5, 6.2],
  ["19A", "American Amber Ale", "Amber and Brown American Beer", 1.045, 1.060, 1.010, 1.015, 25, 40, 10, 17, 4.5, 6.2],
  ["19B", "California Common", "Amber and Brown American Beer", 1.048, 1.054, 1.011, 1.014, 30, 45, 9, 14, 4.5, 5.5],
  ["19C", "American Brown Ale", "Amber and Brown American Beer", 1.045, 1.060, 1.010, 1.016, 20, 30, 18, 35, 4.3, 6.2],
  ["20A", "American Porter", "American Porter and Stout", 1.050, 1.070, 1.012, 1.018, 25, 50, 22, 40, 4.8, 6.5],
  ["20B", "American Stout", "American Porter and Stout", 1.050, 1.075, 1.010, 1.022, 35, 75, 30, 40, 5.0, 7.0],
  ["20C", "Imperial Stout", "American Porter and Stout", 1.075, 1.115, 1.018, 1.030, 50, 90, 30, 40, 8.0, 12.0],
  ["21A", "American IPA", "IPA", 1.056, 1.070, 1.008, 1.014, 40, 70, 6, 14, 5.5, 7.5],
  ["21B-BL", "Belgian IPA", "IPA", 1.058, 1.080, 1.008, 1.016, 50, 100, 5, 15, 6.2, 9.5],
  ["21B-BK", "Black IPA", "IPA", 1.050, 1.085, 1.010, 1.018, 50, 90, 25, 40, 5.5, 9.0],
  ["21B-BR", "Brown IPA", "IPA", 1.056, 1.070, 1.008, 1.016, 40, 70, 11, 19, 5.5, 7.5],
  ["21B-RD", "Red IPA", "IPA", 1.056, 1.070, 1.008, 1.016, 40, 70, 11, 17, 5.5, 7.5],
  ["21B-RY", "Rye IPA", "IPA", 1.056, 1.075, 1.008, 1.014, 50, 75, 6, 14, 5.5, 8.0],
  ["21B-WH", "White IPA", "IPA", 1.056, 1.065, 1.010, 1.016, 40, 70, 5, 6, 5.5, 7.0],
  ["21B-BT", "Brut IPA", "IPA", 1.046, 1.057, 0.990, 1.004, 20, 30, 2, 4, 6.0, 7.5],
  ["21C", "Hazy IPA", "IPA", 1.060, 1.085, 1.010, 1.015, 25, 60, 3, 7, 6.0, 9.0],
  ["22A", "Double IPA", "Strong American Ale", 1.065, 1.085, 1.008, 1.018, 60, 100, 6, 14, 7.5, 10.0],
  ["22B", "American Strong Ale", "Strong American Ale", 1.062, 1.090, 1.014, 1.024, 50, 100, 7, 18, 6.3, 10.0],
  ["22C", "American Barleywine", "Strong American Ale", 1.080, 1.120, 1.016, 1.030, 50, 100, 9, 18, 8.0, 12.0],
  ["22D", "Wheatwine", "Strong American Ale", 1.080, 1.120, 1.016, 1.030, 30, 60, 6, 14, 8.0, 12.0],
  ["23A", "Berliner Weisse", "European Sour Ale", 1.028, 1.032, 1.003, 1.006, 3, 8, 2, 3, 2.8, 3.8],
  ["23B", "Flanders Red Ale", "European Sour Ale", 1.048, 1.057, 1.002, 1.012, 10, 25, 10, 17, 4.6, 6.5],
  ["23C", "Oud Bruin", "European Sour Ale", 1.040, 1.074, 1.008, 1.012, 20, 25, 17, 22, 4.0, 8.0],
  ["23D", "Lambic", "European Sour Ale", 1.040, 1.054, 1.001, 1.010, 0, 10, 3, 6, 5.0, 6.5],
  ["23E", "Gueuze", "European Sour Ale", 1.040, 1.060, 1.000, 1.006, 0, 10, 5, 6, 5.0, 8.0],
  ["23F", "Fruit Lambic", "European Sour Ale", 1.040, 1.060, 1.000, 1.010, 0, 10, 3, 7, 5.0, 7.0],
  ["23G", "Gose", "European Sour Ale", 1.036, 1.056, 1.006, 1.010, 5, 12, 3, 4, 4.2, 4.8],
  ["24A", "Witbier", "Belgian Ale", 1.044, 1.052, 1.008, 1.012, 8, 20, 2, 4, 4.5, 5.5],
  ["24B", "Belgian Pale Ale", "Belgian Ale", 1.048, 1.054, 1.010, 1.014, 20, 30, 8, 14, 4.8, 5.5],
  ["24C", "Bière de Garde", "Belgian Ale", 1.060, 1.080, 1.008, 1.016, 18, 28, 6, 19, 6.0, 8.5],
  ["25A", "Belgian Blond Ale", "Strong Belgian Ale", 1.062, 1.075, 1.008, 1.018, 15, 30, 4, 6, 6.0, 7.5],
  ["25B", "Saison", "Strong Belgian Ale", 1.048, 1.065, 1.002, 1.008, 20, 35, 5, 14, 5.0, 7.0],
  ["25C", "Belgian Golden Strong Ale", "Strong Belgian Ale", 1.070, 1.095, 1.005, 1.016, 22, 35, 3, 6, 7.5, 10.5],
  ["26A", "Belgian Single", "Monastic Ale", 1.044, 1.054, 1.004, 1.010, 25, 45, 3, 5, 4.8, 6.0],
  ["26B", "Belgian Dubbel", "Monastic Ale", 1.062, 1.075, 1.008, 1.018, 15, 25, 10, 17, 6.0, 7.6],
  ["26C", "Belgian Tripel", "Monastic Ale", 1.075, 1.085, 1.008, 1.014, 20, 40, 4.5, 7, 7.5, 9.5],
  ["26D", "Belgian Dark Strong Ale", "Monastic Ale", 1.075, 1.110, 1.010, 1.024, 20, 35, 12, 22, 8.0, 12.0],
  ["27-KE", "Kellerbier", "Historical Beer", 1.045, 1.051, 1.008, 1.012, 20, 35, 3, 17, 4.7, 5.4],
  ["27-PB", "Pre-Prohibition Lager", "Historical Beer", 1.044, 1.060, 1.010, 1.015, 25, 40, 3, 6, 4.5, 6.0],
  ["27-PP", "Pre-Prohibition Porter", "Historical Beer", 1.046, 1.060, 1.010, 1.016, 20, 30, 18, 30, 4.5, 6.0],
  ["27-LH", "Lichtenhainer", "Historical Beer", 1.032, 1.040, 1.004, 1.008, 5, 12, 3, 6, 3.5, 4.7],
  ["27-PI", "Piwo Grodziskie", "Historical Beer", 1.028, 1.032, 1.006, 1.012, 20, 35, 3, 6, 2.5, 3.3],
  ["28A", "Brett Beer", "American Wild Ale", 1.040, 1.090, 1.000, 1.010, 0, 50, 2, 40, 4.0, 10.0],
  ["28B", "Mixed-Fermentation Sour Beer", "American Wild Ale", 1.040, 1.090, 1.000, 1.010, 0, 30, 2, 40, 4.0, 10.0],
  ["29A", "Fruit Beer", "Fruit Beer", 1.030, 1.110, 1.000, 1.030, 0, 70, 2, 40, 2.5, 12.0],
  ["30A", "Spice, Herb, or Vegetable Beer", "Spiced Beer", 1.030, 1.110, 1.000, 1.030, 0, 70, 2, 40, 2.5, 12.0],
  ["30C", "Winter Seasonal Beer", "Spiced Beer", 1.050, 1.110, 1.010, 1.030, 5, 60, 6, 40, 5.0, 12.0],
  ["33B", "Specialty Wood-Aged Beer", "Wood Beer", 1.050, 1.120, 1.010, 1.030, 10, 80, 5, 40, 5.0, 14.0],
  ["34B", "Mixed-Style Beer", "Specialty Beer", 1.030, 1.110, 1.000, 1.030, 0, 100, 2, 40, 2.5, 12.0],
  ["M1A", "Dry Mead", "Traditional Mead", 1.080, 1.120, 0.990, 1.010, 0, 0, 1, 16, 7.5, 14.0],
  ["M1B", "Semi-Sweet Mead", "Traditional Mead", 1.080, 1.120, 1.010, 1.025, 0, 0, 1, 16, 7.5, 14.0],
  ["M1C", "Sweet Mead", "Traditional Mead", 1.080, 1.120, 1.025, 1.050, 0, 0, 1, 16, 7.5, 14.0],
  ["M2C", "Berry Mead (Melomel)", "Fruit Mead", 1.080, 1.130, 0.990, 1.050, 0, 0, 1, 40, 7.5, 15.0],
  ["C1A", "New World Cider", "Standard Cider", 1.045, 1.065, 0.995, 1.020, 0, 0, 1, 7, 5.0, 8.0],
  ["C1B", "English Cider", "Standard Cider", 1.050, 1.075, 0.995, 1.015, 0, 0, 1, 10, 6.0, 9.0],
  ["C2A", "New England Cider", "Specialty Cider", 1.060, 1.100, 0.995, 1.020, 0, 0, 1, 10, 7.0, 13.0],
];

export const STYLES: Style[] = ROWS.map(([id, name, cat, og1, og2, fg1, fg2, i1, i2, s1, s2, a1, a2]) =>
  ({ id, name, cat, og: [og1, og2], fg: [fg1, fg2], ibu: [i1, i2], srm: [s1, s2], abv: [a1, a2], guide: id.startsWith("M") ? "BJCP 2015 Mead" : id.startsWith("C") ? "BJCP 2015 Cider" : "BJCP 2021" }));
export const styleById = (id?: string) => STYLES.find((s) => s.id === id);

/** the style guide in its own order, grouped by category (Nick, Nov 23 2026: "organize style by BJCP catalog") */
const groupKey = (id: string) => (/^[MC]/.test(id) ? id.slice(0, 2) : id.replace(/[A-Z].*$|-.*$/, ""));
const order = (k: string) => (k[0] === "M" ? 100 : k[0] === "C" ? 200 : 0) + parseInt(k.replace(/^[MC]/, ""));
export const STYLE_GROUPS: { key: string; label: string; styles: Style[] }[] = [...new Set(STYLES.map((s) => groupKey(s.id)))]
  .sort((a, b) => order(a) - order(b))
  .map((key) => {
    const styles = STYLES.filter((s) => groupKey(s.id) === key).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    const guide = key[0] === "M" ? "Mead " : key[0] === "C" ? "Cider " : "";
    return { key, label: `${guide}${key} · ${styles[0].cat}`, styles };
  });
/** a style's name as BJCP writes it: "21B Specialty IPA: Black IPA" */
export const styleLabel = (s: Style) => (/^21B-/.test(s.id) ? `21B Specialty IPA: ${s.name}` : /^27-/.test(s.id) ? `27 Historical Beer: ${s.name}` : `${s.id} ${s.name}`);
