"use client";
import { createContext, useContext } from "react";

/** staff looking at a customer's portal (Preview): the review page shows everything but answers nothing */
export const PreviewCtx = createContext(false);
export const usePreview = () => useContext(PreviewCtx);
export const PREVIEW_OFF = "This is a preview of the customer's page. Buttons are turned off.";
