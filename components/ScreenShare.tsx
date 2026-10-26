"use client";
/**
 * Screen sharing for Support (Oct 26, Nick: "would it be possible to have Amanda or Claudia share their screen with me so
 * we could talk through something… be viewing it?"). Someone on the team clicks "Share my screen with Nick" in Report an
 * issue; Nick gets a card ("Amanda wants to share her screen · Join") wherever he is in the portal, and sees her screen
 * live with both mics on. The picture and the voices go straight between the two browsers (WebRTC); a screen_sessions
 * row and a Realtime channel only connect them. Nothing is recorded.
 *
 * Mounted once in the shop menu, so a share keeps going while either person moves between pages.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];
type Sig = { t: "join" | "offer" | "answer" | "ice" | "bye"; sdp?: RTCSessionDescriptionInit; c?: RTCIceCandidateInit; from: string };
type Invite = { id: string; host_email: string; host_name: string; note: string; created_at: string };

/** start sharing from anywhere (Report an issue): the dock picks it up */
export function shareMyScreen(note = "") { window.dispatchEvent(new CustomEvent("fbs:share-screen", { detail: { note } })); }
const first = (n: string) => (n || "").split(/[\s@._]+/)[0].replace(/^./, (c) => c.toUpperCase());

export default function ScreenShareDock({ email, name, owner }: { email: string; name: string; /** sees the invites */ owner: boolean }) {
  const sb = useMemo(() => createClient(), []);
  // ---- sharing (host) ----
  const [host, setHost] = useState<{ id: string; state: "waiting" | "live"; muted: boolean; err?: string } | null>(null);
  // ---- watching (viewer) ----
  const [view, setView] = useState<{ id: string; who: string; state: "connecting" | "live" | "ended"; muted: boolean } | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]), [hidden, setHidden] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const alertBox = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 8000); };
  const pc = useRef<RTCPeerConnection | null>(null);
  const chan = useRef<RealtimeChannel | null>(null), screen = useRef<MediaStream | null>(null), mic = useRef<MediaStream | null>(null);
  const vid = useRef<HTMLVideoElement | null>(null), remote = useRef<MediaStream | null>(null), audio = useRef<HTMLAudioElement | null>(null);
  const pending = useRef<RTCIceCandidateInit[]>([]);

  const send = (m: Omit<Sig, "from">) => void chan.current?.send({ type: "broadcast", event: "sig", payload: { ...m, from: email } });
  const cleanup = useCallback(() => {
    pc.current?.close(); pc.current = null;
    screen.current?.getTracks().forEach((t) => t.stop()); screen.current = null;
    mic.current?.getTracks().forEach((t) => t.stop()); mic.current = null;
    if (chan.current) { void sb.removeChannel(chan.current); chan.current = null; }
    remote.current = null; pending.current = [];
  }, [sb]);
  const newPeer = (onTrack?: (e: RTCTrackEvent) => void) => {
    pc.current?.close();
    const p = new RTCPeerConnection({ iceServers: ICE });
    p.onicecandidate = (e) => { if (e.candidate) send({ t: "ice", c: e.candidate.toJSON() }); };
    if (onTrack) p.ontrack = onTrack;
    pc.current = p; pending.current = [];
    return p;
  };
  const addIce = async (c: RTCIceCandidateInit) => { const p = pc.current; if (!p) return; if (p.remoteDescription) await p.addIceCandidate(c).catch(() => null); else pending.current.push(c); };
  const flushIce = async () => { const p = pc.current; if (!p) return; for (const c of pending.current.splice(0)) await p.addIceCandidate(c).catch(() => null); };

  // ---- host: start ----
  const start = useCallback(async (note: string) => {
    if (host) return;
    const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (o: object) => Promise<MediaStream> };
    if (!md?.getDisplayMedia) { alertBox("This browser can't share its screen. Use Chrome or Edge on a computer."); return; }
    let s: MediaStream;
    try { s = await md.getDisplayMedia({ video: { frameRate: 15 }, audio: false }); } catch { return; } // they picked Cancel
    screen.current = s;
    try { mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { mic.current = null; }
    const { data, error } = await sb.from("screen_sessions").insert({ host_email: email, host_name: name || first(email), note: note.slice(0, 300) }).select("id").single();
    if (error || !data) { cleanup(); alertBox("Couldn't start sharing: " + (error?.message || "try again")); return; }
    const id = data.id as string;
    setHost({ id, state: "waiting", muted: !mic.current });
    // the browser's own "Stop sharing" ends it too
    s.getVideoTracks()[0]?.addEventListener("ended", () => window.dispatchEvent(new Event("fbs:share-stop")));
    const c = sb.channel(`screen-${id}`, { config: { broadcast: { self: false } } });
    c.on("broadcast", { event: "sig" }, async ({ payload }) => {
      const m = payload as Sig;
      if (m.t === "join") {
        const p = newPeer((e) => { // the viewer's voice
          if (!audio.current) { audio.current = new Audio(); audio.current.autoplay = true; }
          audio.current.srcObject = e.streams[0] || new MediaStream([e.track]);
        });
        screen.current?.getTracks().forEach((t) => p.addTrack(t, screen.current!));
        mic.current?.getTracks().forEach((t) => p.addTrack(t, mic.current!));
        p.addTransceiver("audio", { direction: "recvonly" });
        const offer = await p.createOffer(); await p.setLocalDescription(offer);
        send({ t: "offer", sdp: p.localDescription!.toJSON() });
        setHost((h) => (h ? { ...h, state: "live" } : h));
      } else if (m.t === "answer" && m.sdp && pc.current) { await pc.current.setRemoteDescription(m.sdp); await flushIce(); }
      else if (m.t === "ice" && m.c) await addIce(m.c);
      else if (m.t === "bye") { pc.current?.close(); pc.current = null; setHost((h) => (h ? { ...h, state: "waiting" } : h)); }
    }).subscribe();
    chan.current = c;
  }, [host, sb, email, name, cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopHost = useCallback(async () => {
    const id = host?.id;
    send({ t: "bye" });
    cleanup(); setHost(null);
    if (id) await sb.from("screen_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", id);
  }, [host, cleanup, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const go = (e: Event) => void start(((e as CustomEvent).detail?.note as string) || "");
    const stop = () => void stopHost();
    window.addEventListener("fbs:share-screen", go); window.addEventListener("fbs:share-stop", stop);
    return () => { window.removeEventListener("fbs:share-screen", go); window.removeEventListener("fbs:share-stop", stop); };
  }, [start, stopHost]);
  // closing the tab ends the share
  useEffect(() => {
    if (!host && !view) return;
    const bye = () => { send({ t: "bye" }); };
    window.addEventListener("pagehide", bye); return () => window.removeEventListener("pagehide", bye);
  }, [host, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- viewer: invites (the owner) ----
  useEffect(() => {
    if (!owner) return;
    let on = true;
    const look = async () => {
      const since = new Date(Date.now() - 45 * 60000).toISOString();
      const { data } = await sb.from("screen_sessions").select("id, host_email, host_name, note, created_at").eq("status", "waiting").neq("host_email", email).gte("created_at", since).order("created_at", { ascending: false }).limit(5);
      if (on) setInvites((data || []) as Invite[]);
    };
    void look(); const t = setInterval(look, 8000);
    return () => { on = false; clearInterval(t); };
  }, [owner, sb, email]);

  const join = async (iv: Invite) => {
    if (view || host) return;
    setView({ id: iv.id, who: iv.host_name || first(iv.host_email), state: "connecting", muted: false });
    try { mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { mic.current = null; }
    await sb.from("screen_sessions").update({ status: "live", viewer_email: email, joined_at: new Date().toISOString() }).eq("id", iv.id);
    const c = sb.channel(`screen-${iv.id}`, { config: { broadcast: { self: false } } });
    c.on("broadcast", { event: "sig" }, async ({ payload }) => {
      const m = payload as Sig;
      if (m.t === "offer" && m.sdp) {
        const p = newPeer((e) => {
          remote.current = remote.current || new MediaStream();
          remote.current.addTrack(e.track);
          if (vid.current && vid.current.srcObject !== remote.current) vid.current.srcObject = remote.current;
          setView((v) => (v ? { ...v, state: "live" } : v));
        });
        await p.setRemoteDescription(m.sdp);
        mic.current?.getTracks().forEach((t) => p.addTrack(t, mic.current!));
        const ans = await p.createAnswer(); await p.setLocalDescription(ans);
        send({ t: "answer", sdp: p.localDescription!.toJSON() });
        await flushIce();
      } else if (m.t === "ice" && m.c) await addIce(m.c);
      else if (m.t === "bye") { setView((v) => (v ? { ...v, state: "ended" } : v)); pc.current?.close(); pc.current = null; }
    }).subscribe((st) => { if (st === "SUBSCRIBED") send({ t: "join" }); });
    chan.current = c;
  };
  const leave = async () => {
    const id = view?.id;
    send({ t: "bye" });
    cleanup(); setView(null);
    if (id) await sb.from("screen_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", id);
  };
  const muteMine = (m: boolean) => { mic.current?.getAudioTracks().forEach((t) => { t.enabled = !m; }); };
  useEffect(() => { if (vid.current && remote.current) vid.current.srcObject = remote.current; }, [view?.state]);

  const shown = invites.filter((i) => !hidden.includes(i.id) && i.id !== view?.id);
  if (typeof document === "undefined") return null;
  return createPortal(<>
    {msg && <div className="ss-pill" role="alert"><span className="ss-t">{msg}</span><button type="button" className="btn sm ghost" onClick={() => setMsg("")}>OK</button></div>}
    {host && (
      <div className="ss-pill" role="status">
        <span className={"ss-live" + (host.state === "live" ? " on" : "")} aria-hidden />
        <span className="ss-t">{host.state === "live" ? "Nick is watching your screen" : "Sharing your screen · waiting for Nick to join"}</span>
        {mic.current && <button type="button" className="btn sm" onClick={() => { const m = !host.muted; muteMine(m); setHost({ ...host, muted: m }); }}>{host.muted ? "Unmute" : "Mute"}</button>}
        <button type="button" className="btn sm" onClick={() => void stopHost()}>Stop sharing</button>
      </div>
    )}
    {!view && !host && shown.map((iv) => (
      <div key={iv.id} className="ss-invite" role="alertdialog" aria-label={`${iv.host_name || first(iv.host_email)} wants to share their screen`}>
        <span className="ss-av" aria-hidden>{(iv.host_name || iv.host_email).slice(0, 1).toUpperCase()}</span>
        <div className="ss-iv-b"><b>{iv.host_name || first(iv.host_email)} wants to share their screen</b>{iv.note && <span className="faint">{iv.note}</span>}</div>
        <button type="button" className="btn sm primary" onClick={() => void join(iv)}>Join</button>
        <button type="button" className="btn sm ghost" onClick={() => setHidden((h) => [...h, iv.id])}>Not now</button>
      </div>
    ))}
    {view && (
      <div className="ss-view" role="dialog" aria-modal="true" aria-label={`${view.who}'s screen`}>
        <div className="ss-bar">
          <span className={"ss-live" + (view.state === "live" ? " on" : "")} aria-hidden />
          <b>{view.who}&apos;s screen</b>
          <span className="faint">{view.state === "connecting" ? "Connecting…" : view.state === "ended" ? "They stopped sharing" : mic.current ? "You can talk: your mic is on" : "Live"}</span>
          <span className="spacer" />
          {mic.current && view.state !== "ended" && <button type="button" className="btn sm" onClick={() => { const m = !view.muted; muteMine(m); setView({ ...view, muted: m }); }}>{view.muted ? "Unmute" : "Mute"}</button>}
          <button type="button" className="btn sm" onClick={() => void leave()}>{view.state === "ended" ? "Close" : "Leave"}</button>
        </div>
        <div className="ss-stage">
          {/* not muted: their voice comes with the screen */}
          <video ref={vid} autoPlay playsInline />
          {view.state === "connecting" && <div className="ss-wait">Connecting to {view.who}…</div>}
        </div>
      </div>
    )}
  </>, document.body);
}

