/** a sew file's name without its extension and the digitizer's stamps ("DO-5868_westwood_20261119171356_a93afc1c" → "do-5868_westwood") */
export const sewStem = (n: string) => { let x = n.replace(/\.[^.]+$/, "").toLowerCase(); for (let i = 0; i < 4; i++) x = x.replace(/[ _.-]+(?:[0-9a-f]{6,}|\d{4,})$/i, ""); return x; };
