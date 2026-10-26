"use client";
/**
 * Screen sharing for Support (Oct 26, Nick: "would it be possible to have Amanda or Claudia share their screen with me so
 * we could talk through something… be viewing it?"). Someone on the team clicks "Share my screen" in Report an issue;
 * Nick gets a card ("Amanda wants to share her screen · Join") wherever he is in the portal, and sees her screen live
 * with both mics on. The picture and the voices go straight between the two browsers (WebRTC); a screen_sessions row
 * and a Realtime channel only connect them. Nothing is recorded.
 *
 * The call runs in its own small window (/call), not in the portal's tab (Oct 26, Nick: "when we're troubleshooting…
 * and you refresh the version, it ends the support call"): the portal can be refreshed, or moved around in, and the
 * call keeps going. If the call window itself is reloaded, the sharer clicks Resume and the viewer picks it back up.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];
type Sig = { t: "hello" | "join" | "offer" | "answer" | "ice" | "bye"; sdp?: RTCSessionDescriptionInit; c?: RTCIceCandidateInit; from: string };
type Invite = { id: string; host_email: string; host_name: string; note: string; created_at: string };
const first = (n: string) => (n || "").split(/[\s@._]+/)[0].replace(/^./, (c) => c.toUpperCase());

/** start sharing (Report an issue): the call opens in its own window */
export function shareMyScreen(note = "") {
  const w = window.open(`/call?share=1${note ? `&note=${encodeURIComponent(note.slice(0, 300))}` : ""}`, "fbs-call", "width=460,height=600");
  if (!w) window.location.href = `/call?share=1${note ? `&note=${encodeURIComponent(note.slice(0, 300))}` : ""}`;
}
function openViewer(id: string) {
  const w = window.open(`/call?watch=${id}`, "fbs-call-view", "width=1320,height=860");
  if (!w) window.location.href = `/call?watch=${id}`;
}

/** in the shop menu: the owner's "Join" cards */
export default function ScreenShareDock({ email, owner }: { email: string; name?: string; owner: boolean }) {
  const sb = useMemo(() => createClient(), []);
  const [invites, setInvites] = useState<Invite[]>([]), [hidden, setHidden] = useState<string[]>([]);
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
  const shown = invites.filter((i) => !hidden.includes(i.id));
  if (typeof document === "undefined" || !shown.length) return null;
  return createPortal(<>{shown.map((iv) => (
    <div key={iv.id} className="ss-invite" role="alertdialog" aria-label={`${iv.host_name || first(iv.host_email)} wants to share their screen`}>
      <span className="ss-av" aria-hidden>{(iv.host_name || iv.host_email).slice(0, 1).toUpperCase()}</span>
      <div className="ss-iv-b"><b>{iv.host_name || first(iv.host_email)} wants to share their screen</b>{iv.note && <span className="faint">{iv.note}</span>}</div>
      <button type="button" className="btn sm primary" onClick={() => { setHidden((h) => [...h, iv.id]); openViewer(iv.id); }}>Join</button>
      <button type="button" className="btn sm ghost" onClick={() => setHidden((h) => [...h, iv.id])}>Not now</button>
    </div>
  ))}</>, document.body);
}

/** the call itself (the /call window): sharing (share) or watching (watch=id) */
export function ScreenCall({ email, name, mode, sessionId, note }: { email: string; name: string; mode: "share" | "watch"; sessionId: string | null; note: string }) {
  const sb = useMemo(() => createClient(), []);
  const [id, setIdState] = useState<string | null>(sessionId);
  const idRef = useRef<string | null>(sessionId);
  const setId = (v: string) => { idRef.current = v; setIdState(v); };
  const [state, setState] = useState<"ready" | "waiting" | "live" | "away" | "ended">(mode === "watch" ? "waiting" : "ready");
  const [muted, setMuted] = useState(false), [hasMic, setHasMic] = useState(false), [err, setErr] = useState(""), [who, setWho] = useState(""), [soundOff, setSoundOff] = useState(false);
  const pc = useRef<RTCPeerConnection | null>(null), chan = useRef<RealtimeChannel | null>(null);
  const screen = useRef<MediaStream | null>(null), mic = useRef<MediaStream | null>(null), remote = useRef<MediaStream | null>(null);
  const vid = useRef<HTMLVideoElement | null>(null), audio = useRef<HTMLAudioElement | null>(null), pending = useRef<RTCIceCandidateInit[]>([]);

  const send = useCallback((m: Omit<Sig, "from">) => void chan.current?.send({ type: "broadcast", event: "sig", payload: { ...m, from: email } }), [email]);
  const newPeer = (onTrack: (e: RTCTrackEvent) => void) => {
    pc.current?.close();
    const p = new RTCPeerConnection({ iceServers: ICE });
    p.onicecandidate = (e) => { if (e.candidate) send({ t: "ice", c: e.candidate.toJSON() }); };
    p.ontrack = onTrack;
    pc.current = p; pending.current = [];
    return p;
  };
  const addIce = async (c: RTCIceCandidateInit) => { const p = pc.current; if (!p) return; if (p.remoteDescription) await p.addIceCandidate(c).catch(() => null); else pending.current.push(c); };
  const flushIce = async () => { const p = pc.current; if (!p) return; for (const c of pending.current.splice(0)) await p.addIceCandidate(c).catch(() => null); };
  const getMic = async () => { try { mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); setHasMic(true); } catch { mic.current = null; setHasMic(false); } };
  const stopAll = () => {
    pc.current?.close(); pc.current = null;
    screen.current?.getTracks().forEach((t) => t.stop()); screen.current = null;
    mic.current?.getTracks().forEach((t) => t.stop()); mic.current = null;
    if (chan.current) { void sb.removeChannel(chan.current); chan.current = null; }
  };

  // ---- sharing ----
  async function share() {
    setErr("");
    const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (o: object) => Promise<MediaStream> };
    if (!md?.getDisplayMedia) { setErr("This browser can't share its screen. Use Chrome or Edge on a computer."); return; }
    let s: MediaStream;
    // the whole screen only (Oct 26, Nick: "the only option be to share full screen"): the browser opens on Entire screen,
    // and a tab or a window picked anyway is turned down
    try { s = await md.getDisplayMedia({ video: { frameRate: 15, displaySurface: "monitor" }, audio: false, monitorTypeSurfaces: "include", selfBrowserSurface: "exclude", surfaceSwitching: "exclude" }); } catch { setErr("Sharing didn't start. Click Share my screen, click your screen under Entire screen, then Share."); return; }
    const surface = (s.getVideoTracks()[0]?.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
    if (surface && surface !== "monitor") { s.getTracks().forEach((t) => t.stop()); setErr("Share the whole screen: click Share my screen again, pick your screen under Entire screen, then Share."); return; }
    screen.current = s;
    s.getVideoTracks()[0]?.addEventListener("ended", () => void stop());
    await getMic();
    let sid = id;
    if (!sid) {
      const { data, error } = await sb.from("screen_sessions").insert({ host_email: email, host_name: name || first(email), note: note.slice(0, 300) }).select("id").single();
      if (error || !data) { stopAll(); setErr("Couldn't start sharing: " + (error?.message || "try again")); return; }
      sid = data.id as string; setId(sid);
      window.history.replaceState(null, "", `/call?share=1&s=${sid}`);
    } else {
      await sb.from("screen_sessions").update({ status: "waiting", ended_at: null }).eq("id", sid);
    }
    const c = sb.channel(`screen-${sid}`, { config: { broadcast: { self: false } } });
    c.on("broadcast", { event: "sig" }, async ({ payload }) => {
      const m = payload as Sig;
      if (m.t === "join") {
        setWho(first(m.from));
        const p = newPeer((e) => { // their voice
          if (!audio.current) { audio.current = new Audio(); audio.current.autoplay = true; }
          audio.current.srcObject = e.streams[0] || new MediaStream([e.track]);
        });
        screen.current?.getTracks().forEach((t) => p.addTrack(t, screen.current!));
        mic.current?.getTracks().forEach((t) => p.addTrack(t, mic.current!));
        p.addTransceiver("audio", { direction: "recvonly" });
        const offer = await p.createOffer(); await p.setLocalDescription(offer);
        send({ t: "offer", sdp: p.localDescription!.toJSON() });
        setState("live");
      } else if (m.t === "answer" && m.sdp && pc.current) { await pc.current.setRemoteDescription(m.sdp); await flushIce(); }
      else if (m.t === "ice" && m.c) await addIce(m.c);
      else if (m.t === "bye") { pc.current?.close(); pc.current = null; setState("waiting"); }
    }).subscribe((st) => { if (st === "SUBSCRIBED") send({ t: "hello" }); });
    chan.current = c;
    setState("waiting");
  }
  async function stop() {
    send({ t: "bye" });
    stopAll(); setState("ended");
    if (idRef.current) await sb.from("screen_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", idRef.current);
  }

  // ---- watching ----
  useEffect(() => {
    if (mode !== "watch" || !sessionId) return;
    let live = true;
    void (async () => {
      const { data: row } = await sb.from("screen_sessions").select("host_name, host_email, status").eq("id", sessionId).maybeSingle();
      if (!live) return;
      setWho(String(row?.host_name || first(String(row?.host_email || ""))));
      if (row?.status === "ended") { setState("ended"); return; }
      await getMic();
      await sb.from("screen_sessions").update({ status: "live", viewer_email: email, joined_at: new Date().toISOString() }).eq("id", sessionId);
      const c = sb.channel(`screen-${sessionId}`, { config: { broadcast: { self: false } } });
      c.on("broadcast", { event: "sig" }, async ({ payload }) => {
        const m = payload as Sig;
        if (m.t === "hello") { send({ t: "join" }); void sb.from("screen_sessions").update({ status: "live" }).eq("id", sessionId); } // they (re)started sharing
        else if (m.t === "offer" && m.sdp) {
          remote.current = new MediaStream();
          const p = newPeer((e) => {
            remote.current!.addTrack(e.track);
            if (vid.current) { vid.current.srcObject = remote.current; vid.current.play().catch(() => setSoundOff(true)); }
            setState("live");
          });
          await p.setRemoteDescription(m.sdp);
          mic.current?.getTracks().forEach((t) => p.addTrack(t, mic.current!));
          const ans = await p.createAnswer(); await p.setLocalDescription(ans);
          send({ t: "answer", sdp: p.localDescription!.toJSON() });
          await flushIce();
        } else if (m.t === "ice" && m.c) await addIce(m.c);
        else if (m.t === "bye") { pc.current?.close(); pc.current = null; setState("away"); }
      }).subscribe((st) => { if (st === "SUBSCRIBED") send({ t: "join" }); });
      chan.current = c;
    })();
    return () => { live = false; };
  }, [mode, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function leave() {
    send({ t: "bye" });
    stopAll(); setState("ended");
    if (sessionId) await sb.from("screen_sessions").update({ status: "waiting" }).eq("id", sessionId).eq("status", "live");
    window.close();
  }
  useEffect(() => {
    const bye = () => send({ t: "bye" });
    window.addEventListener("pagehide", bye); return () => window.removeEventListener("pagehide", bye);
  }, [send]);
  const mute = () => { const m = !muted; mic.current?.getAudioTracks().forEach((t) => { t.enabled = !m; }); setMuted(m); };

  if (mode === "watch") return (
    <div className="ss-view ss-page">
      <div className="ss-bar">
        <span className={"ss-live" + (state === "live" ? " on" : "")} aria-hidden />
        <b data-notranslate>{who ? `${who}'s screen` : "Their screen"}</b>
        <span className="faint">{state === "waiting" ? "Connecting…" : state === "away" ? "They stopped sharing. This window waits in case they come back." : state === "ended" ? "This share has ended." : hasMic ? "Live · you can talk, your mic is on" : "Live"}</span>
        <span className="spacer" />
        {soundOff && <button type="button" className="btn sm primary" onClick={() => { void vid.current?.play(); setSoundOff(false); }}>Turn on sound</button>}
        {hasMic && state !== "ended" && <button type="button" className="btn sm" onClick={mute}>{muted ? "Unmute" : "Mute"}</button>}
        <button type="button" className="btn sm" onClick={() => void leave()}>{state === "ended" ? "Close" : "Leave"}</button>
      </div>
      <div className="ss-stage">
        <video ref={vid} autoPlay playsInline />
        {state !== "live" && <div className="ss-wait">{state === "ended" ? "This share has ended. You can close this window." : state === "away" ? `Waiting for ${who || "them"} to share again…` : `Connecting to ${who || "their screen"}…`}</div>}
      </div>
    </div>
  );

  return (
    <div className="ss-host">
      <div className="ss-host-h"><span className={"ss-live" + (state === "live" ? " on" : "")} aria-hidden /><h1>Support call with Nick</h1></div>
      {state === "ready" && <>
        <p>{id ? "This window was refreshed, so the sharing stopped. Click to pick up where you left off." : "Nick will see your screen and you can talk it through together."}</p>
        <button type="button" className="btn primary ss-big" onClick={() => void share()}>{id ? "Resume sharing" : "Share my screen"}</button>
        <ol className="sup-steps">
          <li>Click <b>{id ? "Resume sharing" : "Share my screen"}</b>.</li>
          <li>Click your screen under <b>Entire screen</b>, then click <b>Share</b>.</li>
          <li>Click <b>Allow</b> for the microphone so you can talk.</li>
        </ol>
      </>}
      {(state === "waiting" || state === "live") && <>
        <p className="ss-status">{state === "live" ? <><b>{who || "Nick"} is watching.</b> You&apos;re live.</> : "Waiting for Nick to join…"}</p>
        <p className="faint">Keep this little window open. You can go back to the portal, click around and even refresh it: the call keeps going here.</p>
        <div className="row" style={{ gap: 8 }}>
          {hasMic && <button type="button" className="btn" onClick={mute}>{muted ? "Unmute" : "Mute"}</button>}
          <button type="button" className="btn" onClick={() => void stop()}>Stop sharing</button>
        </div>
      </>}
      {state === "ended" && <><p>Sharing stopped. You can close this window.</p><button type="button" className="btn" onClick={() => window.close()}>Close</button></>}
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}
