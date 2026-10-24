"use client";
import { createContext } from "react";

/** The search on the portal Artwork tab row, handed to the Design catalog under it (null: the catalog shows its own box). */
export const ArtSearchContext = createContext<string | null>(null);
