/**
 * Does a logo need a dark backdrop to be seen? (Oct 31: MEI's "Maroon / Off White" showed on white, its off-white words
 * invisible, because the test was the logo's AVERAGE lightness and the maroon icon pulled it down; only an all-white logo
 * got the dark backdrop.) The question is whether a real part of the art would vanish on white: a fair share of its ink
 * is near-white, and almost none of it is near-black (a black outline would vanish on the dark backdrop instead).
 *
 * One test for every place a logo's picture is shown on its own (the logo's page, the logo tiles), so they can't differ.
 * `px` is RGBA pixels; `seen(i)` says whether pixel i is part of the art (default: mostly opaque).
 */
export function needsDarkBackdrop(px: ArrayLike<number>, seen?: (i: number) => boolean, step = 1): boolean {
  let n = 0, light = 0, dark = 0;
  const count = px.length / 4;
  for (let i = 0; i < count; i += step) {
    if (seen ? !seen(i) : px[i * 4 + 3] <= 128) continue;
    const l = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    n++;
    if (l > 222) light++;
    else if (l < 60) dark++;
  }
  return n > 0 && light / n >= 0.2 && dark / n < 0.08;
}
