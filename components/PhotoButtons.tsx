"use client";
import { useEffect, useState } from "react";

/**
 * THE way to add a photo (Oct 29, Nick: "the placement photo wants me to take a photo… I can't get to it because it's on
 * my phone. I need to upload a photo from my files"). On a phone or tablet: Take a photo (the camera) and Choose a photo
 * (the phone's photos and files), side by side. On a computer: one Choose a photo button (there's no camera to open).
 * Never an input with `capture` alone, which on a phone opens only the camera.
 */
export default function PhotoButtons({ onFiles, multiple = false, take = "Take a photo", choose = "Choose a photo", className = "btn sm", chooseClass, disabled }: {
  onFiles: (files: File[]) => void; multiple?: boolean; take?: string; choose?: string; className?: string; chooseClass?: string; disabled?: boolean;
}) {
  const [touch, setTouch] = useState(false);
  useEffect(() => { try { setTouch(window.matchMedia("(pointer: coarse)").matches); } catch { /* a computer */ } }, []);
  const input = (cam: boolean) => (
    <input type="file" hidden accept="image/*" multiple={multiple} disabled={disabled} {...(cam ? { capture: "environment" as const } : {})}
      onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) onFiles(fs); }} />
  );
  return (
    <>
      {touch && <label className={className} style={{ cursor: "pointer" }} aria-disabled={disabled}>{take}{input(true)}</label>}
      <label className={chooseClass || className} style={{ cursor: "pointer" }} aria-disabled={disabled}>{choose}{input(false)}</label>
    </>
  );
}
