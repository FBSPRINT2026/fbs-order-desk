/**
 * DraftPunk's recipe shapes (Nick, Nov 23 2026: a BeerSmith-like homebrew app for him and his club). Everything is kept
 * in US brewing units: gallons, pounds, ounces, °F, specific gravity. A recipe is stored whole in dp_recipes.data; its
 * computed numbers in dp_recipes.calc.
 */

export type FermType = "grain" | "extract" | "dry_extract" | "sugar" | "adjunct" | "fruit" | "honey" | "juice";
export type HopUse = "boil" | "first_wort" | "whirlpool" | "dry_hop" | "mash";
export type HopForm = "pellet" | "leaf" | "plug" | "extract";
export type YeastForm = "liquid" | "dry" | "slant" | "culture";
export type MiscUse = "boil" | "mash" | "primary" | "secondary" | "bottling";
export type IbuMethod = "tinseth" | "rager" | "garetz";

export type Fermentable = {
  name: string; type: FermType;
  /** potential as specific gravity of 1 lb in 1 gal (1.037 = 37 points per pound per gallon) */
  potential: number;
  /** color, °Lovibond */
  color: number;
  /** most a recipe should have, % of the grain bill */
  maxPct?: number;
  /** the mash pH this malt gives alone in distilled water (worked out from type and color when missing) */
  diPh?: number;
  /** acid malt: % lactic acid by weight */
  acidPct?: number;
  origin?: string; notes?: string;
};
export type Hop = { name: string; alpha: number; beta?: number; form?: HopForm; origin?: string; use?: string; notes?: string; substitutes?: string };
export type Yeast = {
  name: string; lab?: string; code?: string; form: YeastForm; kind?: "ale" | "lager" | "wheat" | "wine" | "champagne" | "kveik" | "mixed";
  /** typical attenuation, % */
  attenuation: number; tempLow?: number; tempHigh?: number; flocculation?: "low" | "medium" | "high" | "very high";
  /** billions of cells in one pack (liquid) or per gram (dry) */
  cells?: number; notes?: string;
};
export type Misc = { name: string; type: "spice" | "fining" | "water_agent" | "herb" | "flavor" | "other"; use: MiscUse; notes?: string };
/** ppm */
export type WaterProfile = { name: string; ca: number; mg: number; na: number; so4: number; cl: number; hco3: number; ph?: number; notes?: string };

/** a line in a recipe: the ingredient plus how much and when */
export type RFerm = Fermentable & { lid: string; lb: number; late?: boolean };
export type RHop = Hop & { lid: string; oz: number; use: HopUse; min: number; tempF?: number; days?: number };
export type RYeast = Yeast & { lid: string; packs: number; starter?: boolean };
export type RMisc = Misc & { lid: string; amount: number; unit: string; min?: number };

/** grams for all the brewing water (split by volume between mash and sparge); acids in ml for the mash.
 *  smb: sodium metabisulfite, the oxygen scavenger for low-oxygen (LODO) brewing. */
export type Salts = { gypsum: number; cacl2: number; epsom: number; nacl: number; bakingSoda: number; chalk: number; smb?: number; lacticMl: number; phosphoricMl?: number };

export type MashStep = { name: string; kind: "infusion" | "temperature" | "decoction"; tempF: number; min: number; /** infusion: water added, qt (worked out when blank) */ addQt?: number; };
export type Mash = { name: string; grainTempF: number; /** qt water per lb for the first step */ ratio: number; steps: MashStep[]; spargeTempF: number; sparge: "batch" | "fly" | "none" };

export type FermStep = { name: string; days: number; tempF: number };

export type Equipment = {
  name: string;
  /** volume into the fermenter, gal */
  batchGal: number;
  boilMin: number;
  /** gal per hour */
  boilOffGal: number;
  /** left in the kettle (trub and chiller), gal */
  trubGal: number;
  /** lost in the fermenter (yeast cake), gal */
  fermLossGal: number;
  /** under the false bottom, gal */
  tunDeadGal: number;
  /** grain absorbs, gal per lb */
  absorbGalPerLb: number;
  /**
   * mash efficiency, %: how much of the grain's sugar reaches the kettle before the boil (conversion and lautering
   * together). Nick, Nov 23 2026: no brewhouse efficiency going in: mash efficiency and the volumes (boil-off, losses)
   * are the two things a brewer controls; brewhouse efficiency is only shown as a result.
   */
  mashEff: number;
  hopUtilPct: number;
  /** water lost from the mash while it recirculates, gal per hour (small for a lidded LODO mash) */
  mashEvapGalPerHr?: number;
  /** cooling shrinkage, % */
  shrinkPct: number;
  /** feet above sea level (lowers the boiling point and hop utilization) */
  elevationFt: number;
  kettleGal?: number; fermenterGal?: number; notes?: string;
  /** where this system brews (its brew-day weather comes from here, no phone location needed) */
  place?: { name: string; lat: number; lon: number };
  /** this brewer brews low oxygen: new recipes on this equipment start with LODO on */
  lodo?: boolean;
  /** each logged brew day's real boil-off with its weather, newest first (the calm-day boil-off is learned from these) */
  boilLog?: { date: string; galHr: number; weather?: Weather }[];
};

/**
 * Brew-day weather (Nick, Nov 23 2026: "we brew outside so boil off rate can be affected by cool dry weather or humid hot
 * temps"). The equipment's boil-off is for a calm 70°F, 50% humidity day; this moves it for the day's weather.
 */
export type Weather = { tempF: number; rh: number; windMph: number };

/**
 * keg: force carbonate; spund: cap the fermenter with a spunding valve near the end of fermentation (Nick and Jeff,
 * Nov 24 2026: closed transfers, spunding, force carb as needed); the rest prime bottles. tempF is the serving temp.
 */
export type Carb = { vols: number; method: "corn_sugar" | "table_sugar" | "dme" | "honey" | "keg" | "spund"; tempF: number; /** spund: cap this many gravity points above FG */ spundPts?: number };

export type RecipeType = "all_grain" | "extract" | "partial_mash" | "biab" | "mead" | "cider" | "wine";

export type Recipe = {
  version: 1;
  name: string; brewer?: string; type: RecipeType; styleId?: string; notes?: string; tasteNotes?: string;
  equipment: Equipment;
  ferms: RFerm[]; hops: RHop[]; yeasts: RYeast[]; miscs: RMisc[];
  ibuMethod: IbuMethod;
  mash: Mash;
  water: { source: WaterProfile; target?: WaterProfile; salts: Salts; spargeSalts?: boolean; spargeAcidMl?: number;
    /** low-oxygen brewing (Nick and Jeff, Nov 23 2026): sodium metabisulfite in the brewing water, mg per liter */
    lodo?: { on: boolean; smbMgL: number } };
  ferment: FermStep[];
  carb: Carb;
  /** the weather expected on brew day (moves the boil-off and the water amounts) */
  weather?: Weather;
  /** what the brewer chose for the yeast starter tool */
  starter?: { liters: number; stir: boolean; packDate?: string };
};

export type Calc = {
  og: number; fg: number; abv: number; ibu: number; srm: number; buGu: number; calories: number;
  preBoilGal: number; preBoilGravity: number; postBoilGal: number;
  totalGrainLb: number; mashWaterGal: number; spargeWaterGal: number; strikeTempF: number;
  mashPh: number; water: WaterProfile; color: string;
  hopIbus: Record<string, number>;
  fermPct: Record<string, number>;
  attenuation: number;
  /** what the brewhouse efficiency comes out to, % (a result, never an input) */
  brewhouseEff: number;
  /** the boil-off used today, after the weather, gal per hour */
  boilOffGal: number;
  /** wort into the fermenter and beer packaged, gal */
  intoFermGal: number; packagedGal: number; postBoilColdGal: number;
  /** warnings a brewer should see (grain over its max %, kettle too small…) */
  notes: string[];
};
