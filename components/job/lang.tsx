"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * English / Español for the job phone menu (what opens when a work order or box label is scanned).
 *
 * The choice is remembered three ways so it follows the person: a cookie (so the page comes from the server already in
 * their language, no flash of English), this phone's copy for the time app ("fbs_lang", the same key /work uses), and,
 * for crew signed in with their PIN, their employee profile (the time app reads it too).
 *
 * Words are translated from the table below, written for a print shop, not machine translated. Anything not in the
 * table (customer names, styles, ink names, notes people typed) stays as it is. Numbers are matched as placeholders:
 * "Sent 3 labels to the printer." finds "Sent {0} labels to the printer.". Keys can carry a "|context" suffix when the
 * same English word needs different Spanish ("Ship|delivery" is "Envío", the "Ship" tool is "Enviar").
 *
 * Without a provider (the same components used on the desktop), everything stays English.
 */
export type Lang = "en" | "es";
export const LANG_COOKIE = "fbs_lang";

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "en", setLang: () => {} });

export function LangProvider({ initial, employee = false, children }: { initial: Lang; employee?: boolean; children: React.ReactNode }) {
  const [lang, set] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    set(l);
    document.documentElement.lang = l;
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    try { localStorage.setItem(LANG_COOKIE, l); } catch { /* private mode */ }
    // crew: save it on their profile too, so the time app opens in the same language
    if (employee) fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lang", lang: l }) }).catch(() => {});
  }, [employee]);
  // the page's language (screen readers, and the few labels drawn by the stylesheet)
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

const NUM = /\d+(?:[.,]\d+)?/g;
const fill = (s: string, a: (string | number)[]) => s.replace(/\{(\d+)\}/g, (m, i) => (a[+i] === undefined ? m : String(a[+i])));
const bare = (s: string) => s.replace(/\|[^|]*$/, "");

/** The translator for this screen: t("Print {0} labels", 3). Also the date locale. */
export function useT() {
  const { lang, setLang } = useContext(Ctx);
  const t = useCallback((s: string, ...a: (string | number)[]) => {
    if (!s) return s;
    if (lang === "en") return fill(bare(s), a);
    const hit = ES[s] ?? ES[s.trim()];
    if (hit !== undefined) return fill(hit, a);
    // "Sent 3 labels to the printer." → "Sent {0} labels to the printer."
    if (!a.length && /\d/.test(s)) {
      const nums: string[] = [];
      const key = s.replace(NUM, (m) => `{${nums.push(m) - 1}}`);
      if (ES[key] !== undefined) return fill(ES[key], nums);
    }
    return fill(bare(s), a);
  }, [lang]);
  return { lang, setLang, t, locale: lang === "es" ? "es-MX" : "en-US" };
}

/** The EN | ES switch in the phone menu's header. */
export function LangToggle() {
  const { lang, setLang } = useT();
  return (
    <div className="jm-lang" role="group" aria-label="Language / Idioma" data-notranslate>
      {(["en", "es"] as Lang[]).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} className={lang === l ? "on" : ""} onClick={() => setLang(l)} lang={l} title={l === "en" ? "English" : "Español"}>{l === "en" ? "EN" : "ES"}</button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ */

const ES: Record<string, string> = {
  // header, menu
  "← Job menu": "← Menú del trabajo",
  "RUSH": "URGENTE",
  "Box {0}": "Caja {0}",
  "{0} pcs": "{0} pzas",
  "pcs": "pzas",
  "Due": "Entrega",
  "Ship|delivery": "Envío",
  "Delivery|delivery": "Reparto",
  "Pickup|delivery": "Recoger",
  "No job #{0}": "No existe el trabajo #{0}",
  "This code doesn't match a job in the portal or in Printavo. Check the number on the label.": "Este código no coincide con ningún trabajo en el portal ni en Printavo. Revisa el número en la etiqueta.",
  "Take a photo of the print": "Tomar foto de la impresión",
  "Take a photo": "Tomar foto",
  "Press setup": "Configuración de prensa",
  "Notes": "Notas",
  "Photos": "Fotos",
  "Box labels": "Etiquetas de caja",
  "Ship": "Enviar",
  "Check in goods": "Recibir mercancía",
  "Log time": "Registrar tiempo",
  "Full job": "Trabajo completo",
  "1 print": "1 impresión",
  "{0} prints": "{0} impresiones",
  "screens": "pantallas",
  "1 shop note": "1 nota del taller",
  "{0} shop notes": "{0} notas del taller",
  "1 saved": "1 guardada",
  "{0} saved": "{0} guardadas",
  "Print to the Zebra": "Imprimir en la Zebra",
  "Printer not set up": "Impresora sin configurar",
  "Boxes, weights, rates": "Cajas, pesos, tarifas",
  "Counted": "Contado",
  "Problem open": "Problema abierto",
  "{0} pcs expected": "{0} pzas esperadas",
  "Start / finish": "Iniciar / terminar",
  "Open in the shop": "Abrir en el sistema",
  "Latest notes": "Últimas notas",
  "All notes": "Todas las notas",
  "Production note": "Nota de producción",
  "Production note (from the order)": "Nota de producción (del pedido)",
  "Order note": "Nota del pedido",

  // press setup
  "Print": "Impresión",
  "Prints": "Impresiones",
  "Imprint": "Impresión",
  "press not chosen": "prensa sin elegir",
  "{0} mesh": "malla {0}",
  "Flash": "Flash",
  "Roller": "Rodillo",
  "Cool down (empty)": "Enfriamiento (vacío)",
  "Head down": "Cabezal apagado",
  "Empty": "Vacío",
  "No press setup saved yet. Screens in print order:": "Aún no hay configuración de prensa guardada. Pantallas en orden de impresión:",
  "Inks": "Tintas",
  "Size": "Tamaño",
  "Drop": "Bajada",
  "No imprints entered.": "No hay impresiones capturadas.",
  "1 color": "1 color",
  "{0} colors": "{0} colores",
  "{0} color": "{0} color",
  "Screen print": "Serigrafía",
  "Embroidery": "Bordado",
  "DTF transfer": "Transfer DTF",
  "Left Chest": "Pecho izquierdo",
  "Right Chest": "Pecho derecho",
  "Full Front": "Frente completo",
  "Medium Front": "Frente mediano",
  "Center Chest": "Centro del pecho",
  "Across Chest": "A lo ancho del pecho",
  "Full Back": "Espalda completa",
  "Medium Back": "Espalda mediana",
  "Upper Back (Yoke)": "Espalda alta (canesú)",
  "Across Shoulders": "A lo ancho de los hombros",
  "Left Sleeve": "Manga izquierda",
  "Right Sleeve": "Manga derecha",
  "Left Vertical": "Vertical izquierda",
  "Right Vertical": "Vertical derecha",
  "Front Bottom Left": "Frente abajo izquierda",
  "Front Bottom Right": "Frente abajo derecha",
  "Pocket": "Bolsillo",
  "Front": "Frente",
  "Back": "Espalda",
  "Back Neck": "Nuca",

  // order statuses (portal and Printavo)
  "Order request": "Solicitud de pedido",
  "Quote": "Cotización",
  "Quote Sent": "Cotización enviada",
  "Approved": "Aprobado",
  "Art & Proofs": "Arte y pruebas",
  "Blanks Ordered": "Prendas pedidas",
  "In Production": "En producción",
  "In production": "En producción",
  "Ready for Pickup": "Listo para recoger",
  "Completed": "Terminado",
  "Job Completed": "Trabajo terminado",
  "Quote - Closed": "Cotización - cerrada",
  "SP - Ready for Production / Scheduling": "SP - Listo para producción / programar",
  "Shipping - Ready to Ship or Delivery": "Envíos - Listo para enviar o repartir",
  "Emb - Pre Production / Ready for Scheduling": "Bordado - Preproducción / listo para programar",
  "OP - Printing, Signage, or Promo": "OP - Impresión, letreros o promocionales",
  "Issue - Production on Hold": "Problema - Producción en espera",
  "Issue - Receiving": "Problema - Recepción",
  "SP - Press {0} - {1}C Sportsman": "SP - Prensa {0} - {1}C Sportsman",
  "SP - Press {0} - {1}C Gauntlet III": "SP - Prensa {0} - {1}C Gauntlet III",
  "HP - Transfers Ordered": "HP - Transfers pedidos",
  "Fulfillment - Ready for Finishing": "Surtido - Listo para acabado",
  "SP - Holder Waiting on Details": "SP - En espera de detalles",
  "Emb - Holder Waiting on Details": "Bordado - En espera de detalles",
  "Issue - Quality Control / Reprint": "Problema - Control de calidad / reimpresión",

  "As printed": "Como se imprimió",
  "Changed from the suggestion": "Cambios respecto a lo sugerido",
  "Saved for next time: the separation, the art's inks and this order use these.": "Guardado para la próxima: la separación, las tintas del arte y este pedido ya usan esto.",
  "Hide the suggested setup": "Ocultar la configuración sugerida",
  "Show the suggested setup": "Ver la configuración sugerida",
  "Suggested": "Sugerido",
  "from the inks on the job": "según las tintas del trabajo",
  "Change what we ran": "Cambiar lo que se corrió",
  "We ran it differently": "Lo corrimos diferente",
  "Press that ran it": "Prensa en la que se corrió",
  "{0} heads": "{0} cabezales",
  "{0} has {1} heads; this uses {2}.": "{0} tiene {1} cabezales; esto usa {2}.",
  "Heads, in order": "Cabezales, en orden",
  "Ink color": "Color de tinta",
  "Ink": "Tinta",
  "Mesh": "Malla",
  "Move up": "Subir",
  "Move down": "Bajar",
  "Take out": "Quitar",
  "Cool down": "Enfriamiento",
  "Empty head": "Cabezal vacío",
  "Screen": "Pantalla",
  "Why? e.g. Press 1 was down. The gold printed too light, went to a darker gold.": "¿Por qué? ej. La prensa 1 estaba parada. El dorado salió muy claro, usamos uno más oscuro.",
  "Same as the suggested setup.": "Igual que la configuración sugerida.",
  "Use this next time (updates the separation, the art's inks and this order, so a reorder starts from what really printed)": "Usar esto la próxima vez (actualiza la separación, las tintas del arte y este pedido, para que una reorden empiece con lo que realmente se imprimió)",
  "Saved on the job's production notes.": "Se guarda en las notas de producción del trabajo.",
  "Save what we ran": "Guardar lo que se corrió",
  "That print location isn't on this job any more.": "Esa ubicación ya no está en este trabajo.",
  "Add the screens that ran.": "Agrega las pantallas que se corrieron.",

  // notes and photos
  "Add a note to this job": "Agregar una nota a este trabajo",
  "Ink / colors": "Tinta / colores",
  "Print issue": "Problema de impresión",
  "Approved print": "Impresión aprobada",
  "General": "General",
  "e.g. Switched PMS 186 to the darker red, customer OK'd": "ej. Cambié el PMS 186 al rojo más oscuro, el cliente lo aprobó",
  "e.g. White on head 3, 156 mesh, flash 8 sec": "ej. Blanco en el cabezal 3, malla 156, flash 8 seg",
  "What should the next person know?": "¿Qué debe saber la siguiente persona?",
  "Saving…": "Guardando…",
  "Save note": "Guardar nota",
  "Caption (optional)": "Descripción (opcional)",
  "Cancel": "Cancelar",
  "Save to job": "Guardar en el trabajo",
  "New photo": "Foto nueva",
  "Loading…": "Cargando…",
  "No photos on this job yet.": "Este trabajo aún no tiene fotos.",
  "Offline. Try again.": "Sin conexión. Intenta de nuevo.",
  "Offline": "Sin conexión",
  "Couldn't save the note.": "No se pudo guardar la nota.",
  "Couldn't save the photo.": "No se pudo guardar la foto.",
  "Couldn't load the job's files.": "No se pudieron cargar los archivos del trabajo.",
  "Write a note first.": "Escribe una nota primero.",
  "That file is too big (12 MB most).": "El archivo es muy grande (máximo 12 MB).",
  "Pick a photo.": "Elige una foto.",

  // box labels
  "The label printer isn't set up yet (Shipping Center → Settings → Label printer).": "La impresora de etiquetas aún no está configurada (Centro de envíos → Configuración → Impresora de etiquetas).",
  "How many boxes?": "¿Cuántas cajas?",
  "One fewer box": "Una caja menos",
  "One more box": "Una caja más",
  "Boxes": "Cajas",
  "{0} pcs · about {1} per box. Each label says box 1 of {2}, 2 of {2}…": "{0} pzas · unas {1} por caja. Cada etiqueta dice caja 1 de {2}, 2 de {2}…",
  "Sending…": "Enviando…",
  "Print 1 label": "Imprimir 1 etiqueta",
  "Print {0} labels": "Imprimir {0} etiquetas",
  "Just box {0} of {1}": "Solo la caja {0} de {1}",
  "Open the printable labels instead": "Abrir las etiquetas para imprimir",
  "Done.": "Listo.",
  "Sent {0} label to the printer.": "Se envió {0} etiqueta a la impresora.",
  "Sent {0} labels to the printer.": "Se enviaron {0} etiquetas a la impresora.",
  "Queued {0} label, but the print computer isn't connected. They'll print if it's back within {1} minutes.": "Se puso {0} etiqueta en espera, pero la computadora de impresión no está conectada. Se imprimirá si vuelve en menos de {1} minutos.",
  "Queued {0} labels, but the print computer isn't connected. They'll print if it's back within {1} minutes.": "Se pusieron {0} etiquetas en espera, pero la computadora de impresión no está conectada. Se imprimirán si vuelve en menos de {1} minutos.",
  "PrintNode didn't take {0} label. Check the printer in PrintNode.": "PrintNode no aceptó {0} etiqueta. Revisa la impresora en PrintNode.",
  "PrintNode didn't take {0} labels. Check the printer in PrintNode.": "PrintNode no aceptó {0} etiquetas. Revisa la impresora en PrintNode.",
  "Set the printer's IP address first (Shipping Center → Settings → Label printer).": "Primero pon la dirección IP de la impresora (Centro de envíos → Configuración → Impresora de etiquetas).",
  "Nothing to print.": "No hay nada que imprimir.",
  "No job with that number.": "No hay ningún trabajo con ese número.",
  "That job doesn't exist.": "Ese trabajo no existe.",
  "Sign in first.": "Inicia sesión primero.",
  "Staff only.": "Solo para personal de oficina.",

  // shipping
  "Ship to": "Enviar a",
  "Edit": "Editar",
  "Done": "Listo",
  "Company": "Empresa",
  "Attention": "Atención",
  "Street": "Calle",
  "Suite": "Interior",
  "City": "Ciudad",
  "State": "Estado",
  "ZIP": "C.P.",
  "Phone": "Teléfono",
  "Remove": "Quitar",
  "L|dim": "Largo",
  "W|dim": "Ancho",
  "H|dim": "Alto",
  "Weight (lb)": "Peso (lb)",
  "Tracking #": "Núm. de rastreo",
  "+ Add a box": "+ Agregar caja",
  "Who pays": "Quién paga",
  "Our account (FBS)": "Nuestra cuenta (FBS)",
  "Customer's UPS account": "Cuenta UPS del cliente",
  "Customer's FedEx account": "Cuenta FedEx del cliente",
  "UPS account #": "Núm. de cuenta UPS",
  "FedEx account #": "Núm. de cuenta FedEx",
  "Billing ZIP": "C.P. de facturación",
  "Getting rates…": "Cotizando…",
  "Get rates again": "Cotizar de nuevo",
  "Get rates": "Cotizar envío",
  "Every box needs its size and weight.": "Cada caja necesita medidas y peso.",
  "Every box needs its size and weight, and the address has to be complete.": "Cada caja necesita medidas y peso, y la dirección tiene que estar completa.",
  "Arrives {0}": "Llega {0}",
  "1 business day": "1 día hábil",
  "{0} business days": "{0} días hábiles",
  "Save for the Shipping Center": "Guardar para el Centro de envíos",
  "Shipped already? Add tracking numbers": "¿Ya se envió? Agrega los números de rastreo",
  "Mark shipped": "Marcar como enviado",
  "Buying the carrier labels happens in the Shipping Center.": "Las guías de paquetería se compran en el Centro de envíos.",
  "Marked shipped.": "Marcado como enviado.",
  "Saved. It's ready in the Shipping Center.": "Guardado. Ya está listo en el Centro de envíos.",
  "Couldn't get rates.": "No se pudieron obtener tarifas.",

  // sign in
  "Job #{0}": "Trabajo #{0}",
  "Sign in to open this job": "Inicia sesión para abrir este trabajo",
  "Use your employee number and PIN, like the time app. This phone stays signed in.": "Usa tu número de empleado y tu PIN, igual que en la app de tiempo. Este teléfono se queda con la sesión abierta.",
  "Employee #": "Núm. de empleado",
  "PIN": "PIN",
  "Delete": "Borrar",
  "Next": "Siguiente",
  "Signing in…": "Entrando…",
  "Sign in": "Entrar",
  "Office staff: sign in with your portal login": "Personal de oficina: entra con tu usuario del portal",
  "Customer? See your order": "¿Eres cliente? Ve tu pedido",
  "Shop tools work on the FBS Wi-Fi": "Las herramientas del taller funcionan en el Wi-Fi de FBS",
  "You're signed in with your employee PIN, but this phone isn't on the shop's network. Connect to the FBS Wi-Fi and scan again.": "Entraste con tu PIN de empleado, pero este teléfono no está en la red del taller. Conéctate al Wi-Fi de FBS y vuelve a escanear.",
  "Wrong employee # or PIN.": "Número de empleado o PIN incorrecto.",
  "Too many tries. Wait 5 minutes.": "Demasiados intentos. Espera 5 minutos.",
  "You don't have a PIN yet. Ask a manager.": "Aún no tienes PIN. Pídeselo a un gerente.",
  "Couldn't sign in.": "No se pudo entrar.",

  // goods check-in
  "No sizes to count on this job.": "Este trabajo no tiene tallas que contar.",
  "Check what you counted": "Revisa lo que contaste",
  "Tap a size to change it.": "Toca una talla para cambiarla.",
  "Add more": "Agregar más",
  "Size {0} of {1}": "Talla {0} de {1}",
  "All {0} here": "Llegaron las {0}",
  "{0} short": "Faltan {0}",
  "Back|nav": "Atrás",
  "Damaged / wrong": "Dañadas / equivocadas",
  "Count them in the number above too; this says how many of them are no good.": "Cuéntalas también en el número de arriba; esto indica cuántas no sirven.",
  "Review ({0} sizes left)": "Revisar (faltan {0} tallas)",
  "Review and check in": "Revisar y recibir",
  "Checked in. Thanks!": "Recibido. ¡Gracias!",
  "Counted in": "Contado",
  "Count again": "Contar de nuevo",
  "Checking goods in needs Goods & Receiving access.": "Para recibir mercancía necesitas acceso a Mercancía y recepción.",
  "Check in #{0}": "Recibir #{0}",
  "From the {0} manifest:": "Según el manifiesto de {0}:",
  "in 1 box": "en 1 caja",
  "in {0} boxes": "en {0} cajas",
  "(the job has {0})": "(el trabajo tiene {0})",
  "From the job's line items (no manifest):": "Según las líneas del trabajo (sin manifiesto):",
  "Mixed box …{0}": "Caja mixta …{0}",
  "(box {0})": "(caja {0})",
  ": count only this job's part. The rest is for": ": cuenta solo la parte de este trabajo. El resto es para",
  "a shipment not linked yet": "un envío aún sin vincular",
  "✓ Everything's here ({0})": "✓ Llegó todo ({0})",
  "Clear": "Borrar",
  "of {0}": "de {0}",
  "Item": "Artículo",
  "✓ All": "✓ Todo",
  "Take the full amount for every size": "Tomar la cantidad completa de cada talla",
  "Other": "Otra",
  "Tap: all of them are here": "Toca: llegaron todas",
  "{0} received": "{0} recibidas",
  "One less {0}": "Una {0} menos",
  "One more {0}": "Una {0} más",
  "1 problem": "1 problema",
  "{0} problems": "{0} problemas",
  "No problems": "Sin problemas",
  "Each one is flagged in Goods & Receiving until it's resolved.": "Cada uno queda marcado en Mercancía y recepción hasta que se resuelva.",
  "Counts that don't match show up here. Damage or a wrong item on a size that counted right:": "Aquí aparecen los conteos que no cuadran. Para daño o artículo equivocado en una talla que sí cuadró:",
  "+ Damaged or wrong item": "+ Dañado o artículo equivocado",
  "Which size": "Qué talla",
  "What's wrong": "Qué pasó",
  "Short": "Faltante",
  "Extra": "Sobrante",
  "Damaged": "Dañado",
  "Wrong item": "Artículo equivocado",
  "How many": "Cuántas",
  "Add": "Agregar",
  "got {0} of {1}": "llegaron {0} de {1}",
  "{0} wrong": "{0} equivocadas",
  "{0} damaged": "{0} dañadas",
  "Reason": "Motivo",
  "Note (optional)": "Nota (opcional)",
  "Note": "Nota",
  "Anything about this delivery (boxes crushed, came on the S&S truck…)": "Algo sobre esta entrega (cajas aplastadas, llegó en el camión de S&S…)",
  "📷 Add photos": "📷 Agregar fotos",
  "1 photo added": "1 foto agregada",
  "{0} photos added": "{0} fotos agregadas",
  "1 size left to count · {0} so far": "Falta 1 talla por contar · {0} hasta ahora",
  "{0} sizes left to count · {1} so far": "Faltan {0} tallas por contar · {1} hasta ahora",
  "{0} of {1} counted": "{0} de {1} contadas",
  " · all here": " · llegó todo",
  "Check In": "Recibir",
  "Check In with 1 Problem": "Recibir con 1 problema",
  "Check In with {0} Problems": "Recibir con {0} problemas",
  "Close": "Cerrar",
  "Uploading photos…": "Subiendo fotos…",
  "Count every size first: {0} left (tap a number to take the full amount).": "Primero cuenta todas las tallas: faltan {0} (toca un número para tomar la cantidad completa).",
  "Couldn't reach the server.": "No se pudo conectar con el servidor.",
  "Couldn't save.": "No se pudo guardar.",
};
