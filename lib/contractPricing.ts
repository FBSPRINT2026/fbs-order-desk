import type { PriceList } from "@/lib/pricing";

/**
 * The FBS Contract Pricing List (2024v1r1), the wholesale price list: customer supplied goods, contract screen
 * printing and embroidery. Loaded from Settings → Wholesale → "Load the FBS contract price list" (then Save).
 * DTF isn't on the sheet: the earlier wholesale DTF prices are kept. Only White and Natural print without an
 * underbase for now (Nicholas, Oct 7).
 */
export const FBS_CONTRACT_2024: PriceList = {
  "tiers": [
    12,
    24,
    48,
    72,
    144,
    288,
    500,
    750,
    1000,
    2500
  ],
  "screen": [
    [
      3.35,
      4.85,
      6.35,
      7.85,
      9.35,
      10.85,
      12.35,
      13.85
    ],
    [
      2.25,
      3.0,
      3.75,
      4.5,
      5.25,
      6.0,
      6.75,
      7.5
    ],
    [
      1.65,
      2.0,
      2.35,
      2.7,
      3.05,
      3.4,
      3.75,
      4.1
    ],
    [
      1.35,
      1.6,
      1.85,
      2.1,
      2.35,
      2.6,
      2.85,
      3.1
    ],
    [
      1.05,
      1.3,
      1.55,
      1.8,
      2.05,
      2.3,
      2.55,
      2.8
    ],
    [
      0.95,
      1.15,
      1.35,
      1.55,
      1.75,
      1.95,
      2.15,
      2.35
    ],
    [
      0.8,
      1.0,
      1.2,
      1.4,
      1.6,
      1.8,
      2.0,
      2.2
    ],
    [
      0.75,
      0.95,
      1.15,
      1.35,
      1.55,
      1.75,
      1.95,
      2.15
    ],
    [
      0.7,
      0.85,
      1.0,
      1.15,
      1.3,
      1.45,
      1.6,
      1.75
    ],
    [
      0.6,
      0.75,
      0.9,
      1.05,
      1.2,
      1.35,
      1.5,
      1.65
    ]
  ],
  "screenFee": 20,
  "remakeFee": 15,
  "inkChangeFee": 10,
  "pmsFee": 15,
  "digitizing": 40,
  "darkAddsColor": true,
  "minQty": 12,
  "lightColors": [
    "White",
    "Natural"
  ],
  "specialLocPrice": 0.25,
  "specialLocations": [
    "Left Sleeve",
    "Right Sleeve",
    "Pocket",
    "Left Vertical",
    "Right Vertical"
  ],
  "specialtyInk": [
    0.5,
    0.5,
    0.5,
    0.5,
    0.5,
    0.5,
    0.35,
    0.35,
    0.35,
    0.35
  ],
  "dtf": [
    5.5,
    4.75,
    4,
    3.5,
    3.25,
    3,
    2.75,
    2.75,
    2.75,
    2.75
  ],
  "embTiers": [
    6,
    12,
    24,
    48,
    144,
    288,
    500
  ],
  "embroidery": [
    8,
    5,
    4,
    3.75,
    3.5,
    3.25,
    3
  ],
  "embStitches": 6000,
  "embPer1k": 0.25,
  "embSpecialty": [
    1,
    1,
    1,
    1,
    0.75,
    0.5,
    0.5
  ],
  "upcharges": {
    "2XL": 0,
    "3XL": 0,
    "4XL": 0,
    "5XL": 0
  },
  "finishing": [
    {
      "id": "fold",
      "name": "Fold",
      "price": 0.2
    },
    {
      "id": "poly_bag",
      "name": "Poly bag",
      "price": 0.2
    },
    {
      "id": "barcode",
      "name": "Barcode sticker",
      "price": 0.1
    },
    {
      "id": "relabel",
      "name": "Tag removal & custom imprint (+ 1-color screen)",
      "price": 1
    }
  ],
  "contractNotes": "FBS Contract Pricing List 2024v1r1. 9+ color and full color jobs are custom quoted. Spoilage / reject on customer supplied goods: 5% on small orders, up to 2% on large orders. Embroidery digitizing: basic $40-$60, complex / puff $80+ (set on the job). Sew-outs $15. Drop ship fee $5 per order + cost (add as an order fee). Tag removal & custom imprint also needs a 1-color screen. Standard service on all decoration methods: 7-14 business days after approvals and receipt of goods; rush available.",
  "embExtras": [
    {
      "id": "emb_thread",
      "name": "Specialty thread (embroidery)",
      "price": 0.75
    },
    {
      "id": "emb_puff",
      "name": "3D puff (embroidery)",
      "price": 1
    },
    {
      "id": "emb_personal",
      "name": "Embroidery personalization (name)",
      "price": 6
    }
  ]
};
